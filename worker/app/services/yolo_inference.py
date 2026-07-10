import logging
import gc
import threading
import time
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path

import psutil
from PIL import Image, ImageOps

from app.config import settings
from app.models.schemas import DetectionBox, InferenceResult, JobConfig
from app.services.detection_merge import merge_detections
from app.services.label_classes import is_excluded_detection_class
from app.services.supabase_repo import resolve_project_class_id
from app.services.universal_yolo_loader import UniversalYOLOModel, clear_legacy_runtime_state
import os
import torch

# Keep CPU inference threads low on small Railway containers.///////////////////////////////
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

class MemoryLimitExceeded(Exception):
    pass

logger = logging.getLogger(__name__)

_yolo_models: dict[str, UniversalYOLOModel] = {}
_yolo_lock = threading.Lock()


@dataclass(frozen=True)
class InferenceProfile:
    max_side: int
    min_side: int
    imgsz: int
    prefer_quality: bool = True


_inference_profile: ContextVar[InferenceProfile | None] = ContextVar(
    "inference_profile", default=None
)
_keep_all_models: ContextVar[bool] = ContextVar("keep_all_models", default=False)


def set_inference_profile(profile: InferenceProfile | None) -> None:
    _inference_profile.set(profile)


def clear_inference_profile() -> None:
    _inference_profile.set(None)


def set_keep_all_models(enabled: bool) -> None:
    """When True, keep every loaded YOLO model in RAM (multi-model auto-label prep)."""
    _keep_all_models.set(enabled)


def clear_keep_all_models() -> None:
    _keep_all_models.set(False)


def _should_keep_all_models() -> bool:
    return _keep_all_models.get()


def _active_profile() -> InferenceProfile | None:
    return _inference_profile.get()


def _low_memory_mode() -> bool:
    return os.getenv("LOW_MEMORY_MODE", "true").lower() != "false"


def inference_max_side() -> int:
    """Primary auto-label resolution — separate from upload quality."""
    profile = _active_profile()
    if profile is not None:
        return profile.max_side
    raw = os.getenv("INFERENCE_MAX_IMAGE_SIZE") or os.getenv("MAX_IMAGE_SIZE")
    if raw:
        try:
            return max(128, int(raw))
        except ValueError:
            pass
    return 416 if _low_memory_mode() else int(settings.max_image_size)


def inference_min_side() -> int:
    """OOM fallback — only used when primary size exhausts Railway RAM."""
    profile = _active_profile()
    if profile is not None:
        return profile.min_side
    raw = os.getenv("INFERENCE_MIN_IMAGE_SIZE")
    if raw:
        try:
            return max(128, int(raw))
        except ValueError:
            pass
    return int(getattr(settings, "inference_min_image_size", 256) or 256)


def inference_imgsz_for(side: int) -> int:
    """Keep YOLO imgsz aligned with the prepared image side."""
    profile = _active_profile()
    if profile is not None:
        return max(128, profile.imgsz)
    raw = os.getenv("YOLO_IMGSZ")
    if raw:
        try:
            return max(128, int(raw))
        except ValueError:
            pass
    return max(128, side)


def inference_size_ladder() -> list[int]:
    """Try best quality first, fall back only if memory is tight."""
    primary = inference_max_side()
    minimum = min(inference_min_side(), primary)
    if minimum >= primary:
        return [primary]

    profile = _active_profile()
    if profile is not None and profile.prefer_quality:
        return [primary, minimum]

    soft = int(os.getenv("MEMORY_SOFT_LIMIT_MB", "700" if _low_memory_mode() else "2400"))
    rss = get_process_memory_mb()
    if rss >= soft * 0.85:
        logger.info(
            "Memory already high (%.1f MB >= %.0f MB soft) — trying %dpx before %dpx",
            rss,
            soft * 0.85,
            minimum,
            primary,
        )
        return [minimum, primary]
    return [primary, minimum]


def get_process_memory_mb() -> float:
    return psutil.Process().memory_info().rss / 1024 / 1024


def _log_memory(label: str) -> None:
    logger.info("%s: %.1f MB RSS", label, get_process_memory_mb())


def get_model(model_path: Path) -> UniversalYOLOModel:
    """Load and cache a YOLO model by path (supports multiple formats)."""
    key = str(model_path.resolve())
    low_memory = _low_memory_mode()
    if key in _yolo_models:
        model = _yolo_models[key]
        if not model.is_loaded():
            model.load()
        return model

    with _yolo_lock:
        if low_memory and _yolo_models and not _should_keep_all_models():
            logger.info("LOW_MEMORY_MODE: clearing %d cached model(s) before loading %s", len(_yolo_models), model_path)
            for cached in list(_yolo_models.values()):
                try:
                    cached.unload()
                except Exception:
                    logger.debug("Failed to unload cached model", exc_info=True)
            _yolo_models.clear()
            gc.collect()
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

        if key in _yolo_models:
            model = _yolo_models[key]
            if not model.is_loaded():
                model.load()
            return model

        logger.info("Model loading started: %s", model_path)
        _log_memory("Memory before model load")
        started = time.perf_counter()
        try:
            model = UniversalYOLOModel(str(model_path))
            model.load()
        except IncompatibleModelError:
            raise
        except Exception as exc:
            logger.exception("Model loading failed with full error: %s", model_path)
            if "model load failed" in str(exc).lower():
                raise
            raise RuntimeError(f"Model loading failed for {model_path}: {exc}") from exc

        _yolo_models[key] = model
        logger.info("Model loaded successfully in %.1fs: %s", time.perf_counter() - started, model_path)
        _log_memory("Memory after model load")
    return _yolo_models[key]


def prewarm_yolo(model_path: Path) -> None:
    """Load model into memory so the UI can show progress before the first image."""
    # Allow disabling prewarm (useful on memory-constrained hosts)
    if os.getenv("DISABLE_MODEL_PREWARM", "true").lower() == "true":
        logger.info("Model prewarm is disabled by DISABLE_MODEL_PREWARM")
        return
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")
    model = get_model(model_path)
    if not model.is_loaded():
        model.load()


def load_yolo_model(model_path: Path) -> None:
    """Load the model once, regardless of optional prewarm settings."""
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")
    get_model(model_path)


def run_yolo_inference(
    model_path: Path,
    image_path: Path,
    config: JobConfig,
    model_name: str | None = None,
    class_id_map: dict[str, str] | None = None,
) -> InferenceResult:
    """Run YOLO on a single image and return normalized detections."""
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    model = get_model(model_path)
    start = time.perf_counter()
    soft = int(os.getenv("MEMORY_SOFT_LIMIT_MB", "700" if _low_memory_mode() else "2400"))
    hard = int(os.getenv("MEMORY_HARD_LIMIT_MB", "900" if _low_memory_mode() else "3000"))

    last_memory_error: MemoryLimitExceeded | None = None
    detections_raw: list[dict] = []

    for max_side in inference_size_ladder():
        prepared_image: Image.Image | None = None
        _log_memory(f"Memory before image processing ({max_side}px)")
        try:
            prepared_image = _prepare_inference_image(image_path, max_side)
            _log_memory("Memory after image processing")

            rss = get_process_memory_mb()
            if rss >= soft:
                logger.warning(
                    "Memory above soft limit (%.1f MB >= %d MB) — running gc before inference",
                    rss,
                    soft,
                )
                gc.collect()
                clear_legacy_runtime_state()
                try:
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except Exception:
                    pass
                rss = get_process_memory_mb()
            headroom = max(20, hard - rss)
            if headroom < 40 and max_side > inference_min_side():
                logger.warning(
                    "Only %.0f MB headroom before hard limit — skipping %dpx, trying smaller size",
                    headroom,
                    max_side,
                )
                raise MemoryLimitExceeded(
                    f"Memory headroom too low for {max_side}px: {rss:.1f} MB RSS, hard {hard} MB"
                )
            if rss >= hard:
                raise MemoryLimitExceeded(
                    f"Memory above hard limit: {rss:.1f} MB >= {hard} MB"
                )

            imgsz = inference_imgsz_for(max_side)
            detections_raw = model.predict(
                prepared_image,
                imgsz=imgsz,
                conf=config.confidence,
                iou=config.iou,
            )
            if max_side != inference_max_side():
                logger.info(
                    "Inference used fallback resolution %dpx (primary=%dpx)",
                    max_side,
                    inference_max_side(),
                )
            break
        except MemoryLimitExceeded as exc:
            last_memory_error = exc
            logger.warning(
                "OOM at %dpx for %s — %s",
                max_side,
                image_path.name,
                exc,
            )
            if max_side == inference_size_ladder()[-1]:
                raise
            continue
        finally:
            if prepared_image is not None:
                try:
                    prepared_image.close()
                except Exception:
                    pass
            del prepared_image
            gc.collect()
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
            _log_memory("Memory after cleanup")

    if last_memory_error and not detections_raw:
        raise last_memory_error

    elapsed_ms = (time.perf_counter() - start) * 1000

    # Convert raw detections to DetectionBox format with class mapping
    detections: list[DetectionBox] = []
    for det in detections_raw:
        class_name = det.get("class_name", str(det.get("class_id", "unknown")))
        mapped_name = config.class_name_map.get(class_name, class_name)
        lookup = resolve_project_class_id(class_id_map or {}, mapped_name)
        if not lookup or is_excluded_detection_class(mapped_name):
            continue

        bbox = det.get("bbox", [0, 0, 1, 1])
        detections.append(
            DetectionBox(
                class_name=mapped_name,
                project_class_id=lookup,
                confidence=det.get("confidence", 0.0),
                x=round((bbox[0] + bbox[2]) / 2, 6),
                y=round((bbox[1] + bbox[3]) / 2, 6),
                width=round(bbox[2] - bbox[0], 6),
                height=round(bbox[3] - bbox[1], 6),
            )
        )

    detections = merge_detections(detections, iou_threshold=config.iou)
    detections = merge_detections(
        detections,
        iou_threshold=config.iou,
        class_agnostic=True,
    )

    logger.info("Inference completed: %d detections in %.1f ms", len(detections), elapsed_ms)
    return InferenceResult(
        detections=detections,
        inference_ms=round(elapsed_ms, 2),
        model_name=model_name,
    )


def unload_model(model_path: Path) -> None:
    key = str(model_path.resolve())
    if key in _yolo_models:
        model = _yolo_models[key]
        logger.info("Unloading YOLO model %s", model_path.name)
        model.unload()
    _yolo_models.pop(key, None)


def release_all_models() -> None:
    """Drop every cached YOLO runtime — use before auto-label on small hosts."""
    with _yolo_lock:
        if not _yolo_models:
            clear_legacy_runtime_state()
            return
        logger.info("Releasing %d cached YOLO model(s) from memory", len(_yolo_models))
        for cached in list(_yolo_models.values()):
            try:
                cached.unload()
            except Exception:
                logger.debug("Failed to unload cached model", exc_info=True)
        _yolo_models.clear()
    clear_legacy_runtime_state()
    clear_inference_profile()


def _prepare_inference_image(image_path: Path, max_side: int) -> Image.Image:
    """Decode images — EXIF upright + optional portrait fix for tilted shelf photos."""
    with Image.open(image_path) as opened:
        try:
            opened.draft("RGB", (max_side, max_side))
        except Exception:
            pass
        img = ImageOps.exif_transpose(opened)
        if img.mode != "RGB":
            img = img.convert("RGB")
        # Same portrait fix as upload — helps angled/landscape shelf photos at inference.
        if settings.upload_auto_portrait and img.width > img.height:
            img = img.transpose(Image.ROTATE_90)
        if img.width > max_side or img.height > max_side:
            img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        return img.copy()


def is_model_loaded(model_path: Path) -> bool:
    key = str(model_path.resolve())
    if key not in _yolo_models:
        return False
    return _yolo_models[key].is_loaded()


def describe_model_status(model_path: Path) -> dict:
    key = str(model_path.resolve())
    model_loaded = False
    if key in _yolo_models:
        model_loaded = _yolo_models[key].is_loaded()

    return {
        "model_loaded": model_loaded,
        "model_file_exists": model_path.exists(),
        "model_path": str(model_path),
    }
