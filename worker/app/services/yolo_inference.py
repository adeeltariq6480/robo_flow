import logging
import threading
import time
from pathlib import Path

from app.config import settings
from app.models.schemas import DetectionBox, InferenceResult, JobConfig

logger = logging.getLogger(__name__)

_yolo_models: dict[str, object] = {}
_yolo_lock = threading.Lock()


def get_model(model_path: Path):
    """Load and cache a YOLO model by path."""
    key = str(model_path.resolve())
    if key in _yolo_models:
        return _yolo_models[key]

    with _yolo_lock:
        if key in _yolo_models:
            return _yolo_models[key]

        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError(
                "ultralytics is not installed. Run: pip install ultralytics"
            ) from exc

        logger.info("Model loading started: %s", model_path)
        started = time.perf_counter()
        try:
            model = YOLO(str(model_path))
        except Exception as exc:
            logger.exception("Model loading failed with full error: %s", model_path)
            raise RuntimeError(f"Model loading failed for {model_path}: {exc}") from exc

        _yolo_models[key] = model
        logger.info("Model loaded successfully in %.1fs: %s", time.perf_counter() - started, model_path)
    return _yolo_models[key]


def prewarm_yolo(model_path: Path) -> None:
    """Load model into memory so the UI can show progress before the first image."""
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

    results = model.predict(
        source=str(image_path),
        conf=config.confidence,
        iou=config.iou,
        imgsz=getattr(config, "image_size", 640),
        device="cpu",
        verbose=False,
    )

    elapsed_ms = (time.perf_counter() - start) * 1000
    detections: list[DetectionBox] = []

    if results:
        result = results[0]
        names = result.names or {}
        boxes = result.boxes

        if boxes is not None:
            for box in boxes:
                cls_idx = int(box.cls[0])
                class_name = names.get(cls_idx, str(cls_idx))
                mapped_name = config.class_name_map.get(class_name, class_name)
                lookup = (class_id_map or {}).get(mapped_name)
                if lookup is None:
                    lookup = (class_id_map or {}).get(mapped_name.strip().lower())
                project_class_id = lookup

                xywhn = box.xywhn[0].tolist()
                detections.append(
                    DetectionBox(
                        class_name=mapped_name,
                        project_class_id=project_class_id,
                        confidence=round(float(box.conf[0]), 4),
                        x=round(xywhn[0], 6),
                        y=round(xywhn[1], 6),
                        width=round(xywhn[2], 6),
                        height=round(xywhn[3], 6),
                    )
                )

    return InferenceResult(
        detections=detections,
        inference_ms=round(elapsed_ms, 2),
        model_name=model_name,
    )


def unload_model(model_path: Path) -> None:
    key = str(model_path.resolve())
    if key in _yolo_models:
        logger.info("Unloading YOLO model %s", model_path.name)
    _yolo_models.pop(key, None)


def is_model_loaded(model_path: Path) -> bool:
    return str(model_path.resolve()) in _yolo_models


def describe_model_status(model_path: Path) -> dict:
    model_file_exists = model_path.exists()
    return {
        "model_loaded": is_model_loaded(model_path),
        "model_file_exists": model_file_exists,
        "model_path": str(model_path),
    }
