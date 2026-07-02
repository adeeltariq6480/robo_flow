import logging
import time
from pathlib import Path

from app.config import settings
from app.models.schemas import DetectionBox, InferenceResult, JobConfig

logger = logging.getLogger(__name__)

_yolo_models: dict[str, object] = {}


def _get_yolo(model_path: Path):
    """Load and cache a YOLO model by path."""
    key = str(model_path.resolve())
    if key not in _yolo_models:
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError(
                "ultralytics is not installed. Run: pip install ultralytics"
            ) from exc
        logger.info("Loading YOLO weights from %s (CPU — may take 1–3 min)…", model_path)
        started = time.perf_counter()
        _yolo_models[key] = YOLO(str(model_path))
        logger.info("YOLO loaded in %.1fs", time.perf_counter() - started)
    return _yolo_models[key]


def prewarm_yolo(model_path: Path) -> None:
    """Load model into memory so the UI can show progress before the first image."""
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")
    _get_yolo(model_path)


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

    model = _get_yolo(model_path)
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
