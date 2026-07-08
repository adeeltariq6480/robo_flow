import logging
import gc
import threading
import time
from pathlib import Path

import psutil
from PIL import Image, ImageOps

from app.config import settings
from app.models.schemas import DetectionBox, InferenceResult, JobConfig
from app.services.universal_yolo_loader import UniversalYOLOModel
import os
import torch

class MemoryLimitExceeded(Exception):
    pass

logger = logging.getLogger(__name__)

_yolo_models: dict[str, UniversalYOLOModel] = {}
_yolo_lock = threading.Lock()


def _low_memory_mode() -> bool:
    return os.getenv("LOW_MEMORY_MODE", "true").lower() != "false"


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
        if low_memory and _yolo_models:
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
        except Exception as exc:
            logger.exception("Model loading failed with full error: %s", model_path)
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

    _log_memory("Memory before image processing")
    prepared_image: Image.Image | None = None
    try:
        # Resize and prepare image to reduce memory
        with Image.open(image_path) as opened:
            img = ImageOps.exif_transpose(opened)
            if img.mode != "RGB":
                img = img.convert("RGB")
            low_memory = _low_memory_mode()
            default_max_side = "256" if low_memory else str(settings.max_image_size)
            max_side = int(os.getenv("MAX_IMAGE_SIZE", default_max_side))
            if img.width > max_side or img.height > max_side:
                img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            prepared_image = img.copy()

        _log_memory("Memory after image processing")

        # Memory guard before inference
        soft = int(os.getenv("MEMORY_SOFT_LIMIT_MB", "2400"))
        hard = int(os.getenv("MEMORY_HARD_LIMIT_MB", "3000"))
        rss = get_process_memory_mb()
        logger.debug("Memory check before inference: %.1f MB (soft=%d hard=%d)", rss, soft, hard)
        if rss >= hard:
            raise MemoryLimitExceeded(f"Memory above hard limit: {rss:.1f} MB >= {hard} MB")

        # Run inference using universal model (single image)
        detections_raw = model.predict(prepared_image)

    finally:
        if prepared_image is not None:
            try:
                prepared_image.close()
            except Exception:
                pass
        del prepared_image
        try:
            del img
        except Exception:
            pass
        gc.collect()
        try:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
        _log_memory("Memory after cleanup")

    elapsed_ms = (time.perf_counter() - start) * 1000

    # Convert raw detections to DetectionBox format with class mapping
    detections: list[DetectionBox] = []
    for det in detections_raw:
        class_name = det.get("class_name", str(det.get("class_id", "unknown")))
        mapped_name = config.class_name_map.get(class_name, class_name)
        lookup = (class_id_map or {}).get(mapped_name)
        if lookup is None:
            lookup = (class_id_map or {}).get(mapped_name.strip().lower())

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
