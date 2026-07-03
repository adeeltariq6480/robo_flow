"""Model type detection and validation."""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

MIN_MODEL_SIZE_MB = 1


def detect_model_type(model_path: str) -> dict:
    """
    Detect model type and loader.
    
    Returns dict with:
    - valid (bool): Whether the model is valid
    - model_type (str): "ultralytics_latest" | "yolov5_legacy" | "onnx" | "invalid"
    - loader (str): "ultralytics" | "yolov5" | "onnxruntime" | "none"
    - can_process (bool): Whether the model can be processed
    - message (str): Clear message about the detection result
    """
    model_path_obj = Path(model_path)
    
    # Check if file exists
    if not model_path_obj.exists():
        logger.warning("Model file not found: %s", model_path)
        return {
            "valid": False,
            "model_type": "invalid",
            "loader": "none",
            "can_process": False,
            "message": f"Model file not found: {model_path}",
        }
    
    # Check file size
    try:
        file_size_mb = model_path_obj.stat().st_size / (1024 * 1024)
        if file_size_mb < MIN_MODEL_SIZE_MB:
            logger.warning("Model file too small: %.2f MB", file_size_mb)
            return {
                "valid": False,
                "model_type": "invalid",
                "loader": "none",
                "can_process": False,
                "message": f"Model file too small: {file_size_mb:.2f} MB (minimum {MIN_MODEL_SIZE_MB} MB)",
            }
    except Exception as exc:
        logger.warning("Could not check file size: %s", exc)
        return {
            "valid": False,
            "model_type": "invalid",
            "loader": "none",
            "can_process": False,
            "message": f"Could not check file size: {exc}",
        }
    
    # Check file extension
    suffix = model_path_obj.suffix.lower()
    
    if suffix == ".onnx":
        logger.info("Model detected as ONNX: %s", model_path)
        return {
            "valid": True,
            "model_type": "onnx",
            "loader": "onnxruntime",
            "can_process": True,
            "message": "ONNX model detected. Use onnxruntime loader.",
        }
    
    if suffix != ".pt":
        logger.warning("Unsupported model extension: %s", suffix)
        return {
            "valid": False,
            "model_type": "invalid",
            "loader": "none",
            "can_process": False,
            "message": f"Unsupported model format: {suffix}. Supported: .pt, .onnx",
        }
    
    # Try to load with ultralytics first
    logger.info("Attempting to load model as ultralytics: %s", model_path)
    try:
        from ultralytics import YOLO
        
        model = YOLO(model_path)
        logger.info("Model loaded successfully as ultralytics: %s", model_path)
        del model
        return {
            "valid": True,
            "model_type": "ultralytics_latest",
            "loader": "ultralytics",
            "can_process": True,
            "message": "YOLOv8/v11 model detected. Use ultralytics loader.",
        }
    except Exception as exc:
        error_str = str(exc).lower()
        if any(
            phrase in error_str
            for phrase in ["yolov5", "not forwards compatible", "ultralytics/yolov5"]
        ):
            logger.info("Model detected as YOLOv5 legacy: %s", model_path)
            return {
                "valid": True,
                "model_type": "yolov5_legacy",
                "loader": "yolov5",
                "can_process": True,
                "message": "YOLOv5 legacy model detected. Requires torch.hub loader.",
            }
        else:
            logger.warning("Model load failed for %s: %s", model_path, exc)
            return {
                "valid": False,
                "model_type": "invalid",
                "loader": "none",
                "can_process": False,
                "message": f"Model load failed: {exc}",
            }


def validate_model_file(model_path: str) -> dict:
    """Alias for detect_model_type for API endpoints."""
    return detect_model_type(model_path)
