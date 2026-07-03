"""Universal YOLO model loader supporting multiple model types and runtimes."""

import gc
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from app.config import settings
from app.services.model_validator import detect_model_type

logger = logging.getLogger(__name__)

# Enable/disable optional runtimes via environment
ENABLE_YOLOV5_RUNTIME = os.getenv("ENABLE_YOLOV5_RUNTIME", "false").lower() == "true"
ENABLE_ONNX_RUNTIME = os.getenv("ENABLE_ONNX_RUNTIME", "true").lower() == "true"


class UniversalYOLOModel:
    """Load and run inference with any supported YOLO model format."""

    def __init__(self, model_path: str):
        self.model_path = str(model_path)
        self.model_type_info = detect_model_type(self.model_path)
        self.model = None
        self.model_type = self.model_type_info.get("model_type", "invalid")
        self.loader_type = self.model_type_info.get("loader", "none")
        logger.info(
            "Universal model initialized: path=%s type=%s loader=%s",
            self.model_path,
            self.model_type,
            self.loader_type,
        )

    def load(self) -> None:
        """Load the model using the appropriate runtime."""
        if not self.model_type_info.get("can_process"):
            raise RuntimeError(
                f"Model cannot be processed: {self.model_type_info.get('message', 'Unknown error')}"
            )

        if self.model is not None:
            logger.info("Model already loaded")
            return

        logger.info(
            "Loading model: type=%s loader=%s path=%s",
            self.model_type,
            self.loader_type,
            self.model_path,
        )

        try:
            if self.loader_type == "ultralytics":
                self._load_ultralytics()
            elif self.loader_type == "yolov5":
                self._load_yolov5()
            elif self.loader_type == "onnxruntime":
                self._load_onnx()
            else:
                raise RuntimeError(f"Unknown loader type: {self.loader_type}")

            logger.info(
                "Model loaded successfully: type=%s loader=%s", self.model_type, self.loader_type
            )
        except Exception as exc:
            logger.exception("Failed to load model: %s", exc)
            self.model = None
            raise RuntimeError(f"Model load failed: {exc}") from exc

    def _load_ultralytics(self) -> None:
        """Load YOLOv8/v11 model using ultralytics."""
        try:
            from ultralytics import YOLO

            logger.info("Ultralytics runtime loading for model: %s", self.model_path)
            self.model = YOLO(self.model_path)
            self.model.to("cpu")
            logger.info("Ultralytics model loaded successfully")
        except Exception as exc:
            logger.exception("Ultralytics load failed")
            raise

    def _load_yolov5(self) -> None:
        """Load YOLOv5 legacy model using torch.hub."""
        if not ENABLE_YOLOV5_RUNTIME:
            raise RuntimeError(
                "YOLOv5 runtime is disabled. Set ENABLE_YOLOV5_RUNTIME=true to enable."
            )

        try:
            import torch

            logger.info("YOLOv5 runtime loading for model: %s", self.model_path)

            if settings.torch_home_dir:
                os.environ["TORCH_HOME"] = str(settings.torch_home_dir)

            repo = os.getenv("YOLOV5_REPO", "ultralytics/yolov5")
            ref = os.getenv("YOLOV5_REPO_REF", "v5.0")
            repo_spec = f"{repo}:{ref}"
            logger.info("YOLOv5 repo ref used: %s", repo_spec)

            versions = [ref, "v5.0", "v6.0", "v6.2", "v7.0"]
            if "mp" in str(self.model_path).lower() or "can't get attribute 'mp'" in str(self.model_path).lower():
                versions = ["v5.0", "v6.0", *versions]
            for attempt_ref in versions:
                if attempt_ref == ref:
                    repo_spec = f"{repo}:{attempt_ref}"
                else:
                    repo_spec = f"{repo}:{attempt_ref}"
                try:
                    self.model = torch.hub.load(
                        repo_spec,
                        "custom",
                        path=self.model_path,
                        force_reload=False,
                        trust_repo=True,
                        device="cpu",
                    )
                    break
                except Exception as exc:
                    error_msg = str(exc).lower()
                    if "urlopen" in error_msg or "connection" in error_msg or "internet" in error_msg:
                        raise RuntimeError(
                            "YOLOv5 runtime not available. Add local YOLOv5 runtime or enable internet during first startup."
                        ) from exc
                    if attempt_ref != versions[-1]:
                        logger.warning("YOLOv5 load attempt failed for %s: %s", repo_spec, exc)
                        continue
                    raise

            if self.model is None:
                raise RuntimeError("YOLOv5 model did not load")

            self.model.to("cpu")
            self.model.eval()
            logger.info("YOLOv5 model loaded successfully")
        except Exception as exc:
            logger.exception("YOLOv5 load failed")
            raise

    def _load_onnx(self) -> None:
        """Load ONNX model using onnxruntime."""
        if not ENABLE_ONNX_RUNTIME:
            raise RuntimeError(
                "ONNX runtime is disabled. Set ENABLE_ONNX_RUNTIME=true to enable."
            )

        try:
            import onnxruntime as ort

            logger.info("ONNX runtime loading for model: %s", self.model_path)
            self.model = ort.InferenceSession(
                self.model_path, providers=["CPUExecutionProvider"]
            )
            logger.info("ONNX model loaded successfully")
        except Exception as exc:
            logger.exception("ONNX load failed")
            raise

    def predict(self, image: Image.Image | str) -> list[dict]:
        """
        Run inference and return normalized detections.
        
        Args:
            image: PIL Image or path to image file
            
        Returns:
            List of detections in normalized format:
            [
              {
                "class_id": int,
                "class_name": str,
                "confidence": float,
                "bbox": [x1, y1, x2, y2]  # normalized 0-1
              }
            ]
        """
        if self.model is None:
            raise RuntimeError("Model not loaded. Call load() first.")

        if isinstance(image, str):
            image = Image.open(image)

        logger.info("Running inference with model type: %s", self.model_type)

        try:
            if self.loader_type == "ultralytics":
                return self._predict_ultralytics(image)
            elif self.loader_type == "yolov5":
                return self._predict_yolov5(image)
            elif self.loader_type == "onnxruntime":
                return self._predict_onnx(image)
            else:
                raise RuntimeError(f"Unknown loader type: {self.loader_type}")
        except Exception as exc:
            logger.exception("Inference failed: %s", exc)
            raise RuntimeError(f"Inference failed: {exc}") from exc

    def _predict_ultralytics(self, image: Image.Image) -> list[dict]:
        """Run inference with ultralytics model."""
        results = self.model.predict(source=image, device="cpu", verbose=False)

        detections = []
        if results and len(results) > 0:
            result = results[0]
            names = result.names or {}
            boxes = result.boxes

            if boxes is not None:
                for box in boxes:
                    cls_idx = int(box.cls[0])
                    class_name = names.get(cls_idx, str(cls_idx))
                    xywhn = box.xywhn[0].tolist()

                    detections.append(
                        {
                            "class_id": cls_idx,
                            "class_name": class_name,
                            "confidence": round(float(box.conf[0]), 4),
                            "bbox": [
                                round(float(xywhn[0] - xywhn[2] / 2), 6),
                                round(float(xywhn[1] - xywhn[3] / 2), 6),
                                round(float(xywhn[0] + xywhn[2] / 2), 6),
                                round(float(xywhn[1] + xywhn[3] / 2), 6),
                            ],
                        }
                    )

        logger.info("Ultralytics inference completed: %d detections", len(detections))
        return detections

    def _predict_yolov5(self, image: Image.Image) -> list[dict]:
        """Run inference with YOLOv5 model."""
        results = self.model(image)

        detections = []
        # YOLOv5 returns predictions as tensor: [x_min, y_min, x_max, y_max, conf, class_id]
        predictions = results.pred[0]  # Get predictions from first image

        if predictions is not None and len(predictions) > 0:
            # Normalize by image dimensions
            h, w = image.size[1], image.size[0]

            for pred in predictions:
                x_min, y_min, x_max, y_max, conf, class_id = pred.tolist()
                class_id = int(class_id)
                class_name = results.names.get(class_id, str(class_id))

                # Normalize coordinates
                detections.append(
                    {
                        "class_id": class_id,
                        "class_name": class_name,
                        "confidence": round(float(conf), 4),
                        "bbox": [
                            round(float(x_min / w), 6),
                            round(float(y_min / h), 6),
                            round(float(x_max / w), 6),
                            round(float(y_max / h), 6),
                        ],
                    }
                )

        logger.info("YOLOv5 inference completed: %d detections", len(detections))
        return detections

    def _predict_onnx(self, image: Image.Image) -> list[dict]:
        """Run inference with ONNX model."""
        import cv2

        # Preprocess image
        img_array = np.array(image.convert("RGB"))
        img_resized = cv2.resize(img_array, (640, 640))
        img_normalized = img_resized.astype(np.float32) / 255.0
        img_transposed = np.transpose(img_normalized, (2, 0, 1))
        img_batched = np.expand_dims(img_transposed, 0)

        # Run inference
        input_name = self.model.get_inputs()[0].name
        output_name = self.model.get_outputs()[0].name
        predictions = self.model.run([output_name], {input_name: img_batched})[0]

        # Parse predictions
        detections = []
        # Assuming output shape is [batch, num_predictions, 6] or similar
        # Adjust based on actual ONNX model output format
        if len(predictions) > 0:
            for pred in predictions[0]:
                if len(pred) >= 6:
                    x_min, y_min, x_max, y_max, conf, class_id = pred[:6]
                    if conf > 0.5:  # Filter by confidence
                        detections.append(
                            {
                                "class_id": int(class_id),
                                "class_name": f"class_{int(class_id)}",
                                "confidence": round(float(conf), 4),
                                "bbox": [
                                    round(float(x_min), 6),
                                    round(float(y_min), 6),
                                    round(float(x_max), 6),
                                    round(float(y_max), 6),
                                ],
                            }
                        )

        logger.info("ONNX inference completed: %d detections", len(detections))
        return detections

    def unload(self) -> None:
        """Unload the model and free memory."""
        if self.model is not None:
            logger.info("Unloading model: type=%s loader=%s", self.model_type, self.loader_type)
            try:
                del self.model
                self.model = None
                gc.collect()
                logger.info("Model unloaded from memory")
            except Exception as exc:
                logger.warning("Error during model unload: %s", exc)

    def is_loaded(self) -> bool:
        """Check if model is loaded."""
        return self.model is not None

    def get_model_info(self) -> dict:
        """Get model information."""
        return {
            "path": self.model_path,
            "type": self.model_type,
            "loader": self.loader_type,
            "loaded": self.is_loaded(),
            "valid": self.model_type_info.get("valid", False),
            "can_process": self.model_type_info.get("can_process", False),
            "message": self.model_type_info.get("message", ""),
        }
