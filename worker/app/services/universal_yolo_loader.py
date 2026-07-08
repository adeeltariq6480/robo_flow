"""Universal YOLO model loader supporting multiple model types and runtimes."""

import gc
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from app.config import settings
from app.services.model_errors import IncompatibleModelError
from app.services.model_validator import detect_model_type

logger = logging.getLogger(__name__)

# Enable/disable optional runtimes via environment
ENABLE_YOLOV5_RUNTIME = os.getenv("ENABLE_YOLOV5_RUNTIME", "false").lower() == "true"
ENABLE_YOLOV7_RUNTIME = os.getenv("ENABLE_YOLOV7_RUNTIME", "true").lower() == "true"
ENABLE_ONNX_RUNTIME = os.getenv("ENABLE_ONNX_RUNTIME", "true").lower() == "true"


def _low_memory_mode() -> bool:
    return os.getenv("LOW_MEMORY_MODE", "true").lower() != "false"


def _clear_runtime_memory() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        logger.debug("Torch memory cleanup skipped", exc_info=True)


def _is_incompatible_runtime_error(exc: Exception) -> bool:
    return _looks_like_yolov7_error(exc) or any(
        marker in str(exc).lower()
        for marker in (
            "autoshape",
            "auto shape",
            "can't get attribute",
            "cant get attribute",
            "could not load this yolov5 checkpoint",
            "unsupported/unknown old yolov5",
        )
    )


def _raise_if_incompatible(model_path: str, exc: Exception) -> None:
    if _is_incompatible_runtime_error(exc):
        raise IncompatibleModelError(model_path, str(exc)) from exc


def _looks_like_yolov7_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        marker in text
        for marker in (
            "can't get attribute 'mp'",
            "cant get attribute 'mp'",
            "attribute 'mp'",
            "sppcspc",
            "repconv",
            "yolov7",
        )
    )


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
                try:
                    self._load_ultralytics()
                except Exception as exc:
                    if _is_incompatible_runtime_error(exc):
                        if ENABLE_YOLOV7_RUNTIME:
                            logger.warning(
                                "Ultralytics load failed with legacy checkpoint markers, trying YOLOv7: %s",
                                exc,
                            )
                            self.model = None
                            _clear_runtime_memory()
                            try:
                                self._load_yolov7()
                                self.loader_type = "yolov7"
                                self.model_type = "yolov7_legacy"
                            except Exception as yolov7_exc:
                                _raise_if_incompatible(self.model_path, yolov7_exc)
                                raise
                        else:
                            _raise_if_incompatible(self.model_path, exc)
                    elif ENABLE_YOLOV5_RUNTIME and not _low_memory_mode():
                        logger.warning("Ultralytics primary load failed, trying YOLOv5 fallback: %s", exc)
                        self.model = None
                        _clear_runtime_memory()
                        try:
                            self._load_yolov5()
                            self.loader_type = "yolov5"
                            self.model_type = "yolov5_legacy"
                        except Exception as yolov5_exc:
                            if ENABLE_YOLOV7_RUNTIME and (
                                _looks_like_yolov7_error(exc) or _looks_like_yolov7_error(yolov5_exc)
                            ):
                                logger.warning(
                                    "YOLOv5 fallback looks like YOLOv7 mismatch, trying YOLOv7: %s",
                                    yolov5_exc,
                                )
                                self.model = None
                                _clear_runtime_memory()
                                self._load_yolov7()
                                self.loader_type = "yolov7"
                                self.model_type = "yolov7_legacy"
                            else:
                                _raise_if_incompatible(self.model_path, yolov5_exc)
                                raise
                    else:
                        raise
            elif self.loader_type == "yolov5":
                try:
                    self._load_yolov5()
                except Exception as exc:
                    if _looks_like_yolov7_error(exc):
                        logger.warning("YOLOv5 load looks like YOLOv7 checkpoint, trying YOLOv7 fallback: %s", exc)
                        self.model = None
                        _clear_runtime_memory()
                        self._load_yolov7()
                        self.loader_type = "yolov7"
                        self.model_type = "yolov7_legacy"
                    else:
                        logger.warning("YOLOv5 primary load failed, trying Ultralytics fallback: %s", exc)
                        self.model = None
                        _clear_runtime_memory()
                        self._load_ultralytics()
                        self.loader_type = "ultralytics"
                        self.model_type = "ultralytics_fallback"
            elif self.loader_type == "yolov7":
                try:
                    self._load_yolov7()
                except Exception as exc:
                    logger.warning("YOLOv7 primary load failed, trying YOLOv5 fallback: %s", exc)
                    self.model = None
                    _clear_runtime_memory()
                    self._load_yolov5()
                    self.loader_type = "yolov5"
                    self.model_type = "yolov5_legacy"
            elif self.loader_type == "onnxruntime":
                self._load_onnx()
            else:
                raise RuntimeError(f"Unknown loader type: {self.loader_type}")

            logger.info(
                "Model loaded successfully: type=%s loader=%s", self.model_type, self.loader_type
            )
        except IncompatibleModelError:
            self.model = None
            raise
        except Exception as exc:
            logger.exception("Failed to load model: %s", exc)
            self.model = None
            if isinstance(exc, IncompatibleModelError):
                raise
            if _is_incompatible_runtime_error(exc):
                _raise_if_incompatible(self.model_path, exc)
            raise RuntimeError(f"Model load failed: {exc}") from exc

    def _load_ultralytics(self) -> None:
        """Load YOLOv8/v11 model using ultralytics."""
        try:
            from ultralytics import YOLO
            import os

            logger.info("Ultralytics runtime loading for model: %s", self.model_path)
            # Do not prewarm heavy internals here; loading is deferred to predict
            self.model = YOLO(self.model_path)
            logger.info("Ultralytics model object created (weights not moved).")
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
            self._patch_legacy_runtime_compat(torch)

            if settings.torch_home_dir:
                os.environ["TORCH_HOME"] = str(settings.torch_home_dir)

            repo = os.getenv("YOLOV5_REPO", "ultralytics/yolov5")
            default_ref = os.getenv("YOLOV5_REPO_REF", "v6.2")
            preferred_order = ["v7.0", "v6.2", "v6.1", "v6.0", "v5.0", "v4.0", "v3.1", "master"]
            try_all_refs = os.getenv("YOLOV5_TRY_ALL_REFS", "false" if _low_memory_mode() else "true").lower() == "true"
            extra_refs = [ref.strip() for ref in os.getenv("YOLOV5_EXTRA_REFS", "").split(",") if ref.strip()]
            if not try_all_refs:
                versions = [default_ref, *extra_refs]
            elif default_ref and default_ref not in preferred_order:
                versions = [default_ref] + preferred_order
            else:
                versions = [default_ref] + [v for v in preferred_order if v != default_ref]
            versions = [ref for idx, ref in enumerate(versions) if ref and ref not in versions[:idx]]

            logger.info("YOLOv5 loader will try refs: %s", ",".join(versions))

            tried = []
            last_exc: Exception | None = None
            for attempt_ref in versions:
                repo_spec = f"{repo}:{attempt_ref}"
                logger.info("Trying YOLOv5 ref %s for model %s", repo_spec, self.model_path)
                try:
                    self.model = self._torch_hub_custom_load(torch, repo_spec, device="cpu")
                    logger.info("Loaded YOLOv5 model with ref %s", repo_spec)
                    break
                except Exception as exc:
                    self.model = None
                    _clear_runtime_memory()
                    last_exc = exc
                    err_str = str(exc)
                    lower = err_str.lower()
                    logger.warning("YOLOv5 ref %s failed: %s", repo_spec, err_str)
                    # If error indicates missing internet/connection, surface immediately
                    if any(k in lower for k in ("urlopen", "connection", "internet")):
                        raise RuntimeError(
                            "YOLOv5 runtime not available. Add local YOLOv5 runtime or enable internet during first startup."
                        ) from exc

                    # Errors that indicate incompatible old runtime should try next ref
                    incompatible_markers = ["autoshape", "auto shape", "mp", "can't get attribute", "cant get attribute"]
                    if any(m in lower for m in incompatible_markers):
                        logger.info("Ref %s appears incompatible, trying next ref", attempt_ref)
                        tried.append(attempt_ref)
                        continue
                    # For other errors, also try next ref but log
                    tried.append(attempt_ref)
                    continue

            if self.model is None:
                logger.error("All YOLOv5 refs failed: tried=%s last_error=%s", tried, last_exc)
                _raise_if_incompatible(self.model_path, last_exc or RuntimeError("YOLOv5 load failed"))
                raise RuntimeError(
                    "Could not load this YOLOv5 checkpoint with available YOLOv5/Ultralytics runtimes. "
                    "Try setting YOLOV5_REPO_REF to the exact training version, or re-export as ONNX/latest Ultralytics."
                ) from last_exc

            self.model.to("cpu")
            # Some legacy YOLOv5 models may not have eval(), but call if present
            try:
                if hasattr(self.model, "eval"):
                    self.model.eval()
            except Exception:
                logger.debug("Model eval() failed but continuing")
            logger.info("YOLOv5 model loaded successfully")
        except Exception as exc:
            logger.exception("YOLOv5 load failed")
            raise

    def _load_yolov7(self) -> None:
        """Load YOLOv7-style checkpoints that contain layers like MP/SPPCSPC."""
        if not ENABLE_YOLOV7_RUNTIME:
            raise RuntimeError("YOLOv7 runtime is disabled. Set ENABLE_YOLOV7_RUNTIME=true to enable.")

        try:
            import torch

            self._patch_legacy_runtime_compat(torch)
            if settings.torch_home_dir:
                os.environ["TORCH_HOME"] = str(settings.torch_home_dir)

            repo = os.getenv("YOLOV7_REPO", "WongKinYiu/yolov7")
            ref = os.getenv("YOLOV7_REPO_REF", "main")
            repo_spec = f"{repo}:{ref}" if ref else repo
            logger.info("YOLOv7 runtime loading repo=%s model=%s", repo_spec, self.model_path)
            self.model = self._torch_hub_custom_load(torch, repo_spec, device="cpu")
            try:
                if hasattr(self.model, "to"):
                    self.model.to("cpu")
                if hasattr(self.model, "eval"):
                    self.model.eval()
            except Exception:
                logger.debug("YOLOv7 model CPU/eval setup failed but continuing", exc_info=True)
            logger.info("YOLOv7 model loaded successfully")
        except Exception:
            logger.exception("YOLOv7 load failed")
            raise

    def _torch_hub_custom_load(self, torch_module: Any, repo_spec: str, *, device: str = "cpu") -> Any:
        """Handle old hubconf signatures: some use path=, others positional path_or_model."""
        common_kwargs = {
            "trust_repo": True,
            "force_reload": False,
            "device": device,
        }
        try:
            return torch_module.hub.load(
                repo_spec,
                "custom",
                path=self.model_path,
                **common_kwargs,
            )
        except TypeError as exc:
            if "unexpected keyword argument 'path'" not in str(exc):
                raise
            logger.info("Hub custom loader does not accept path=; retrying with positional weights")
            return torch_module.hub.load(
                repo_spec,
                "custom",
                self.model_path,
                **common_kwargs,
            )

    def _patch_legacy_runtime_compat(self, torch_module: Any) -> None:
        """Patch common old YOLOv5 assumptions for modern Python/NumPy/PyTorch."""
        for alias, target in {
            "int": int,
            "float": float,
            "bool": bool,
            "object": object,
        }.items():
            if not hasattr(np, alias):
                try:
                    setattr(np, alias, target)
                except Exception:
                    logger.debug("Could not patch numpy.%s", alias)

        original_load = getattr(torch_module, "load", None)
        if original_load is None or getattr(original_load, "_robo_flow_legacy_patch", False):
            return

        def patched_load(*args, **kwargs):
            kwargs.setdefault("weights_only", False)
            return original_load(*args, **kwargs)

        patched_load._robo_flow_legacy_patch = True
        torch_module.load = patched_load
        logger.info("Patched torch.load(weights_only=False) for legacy YOLO checkpoints")

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
            elif self.loader_type == "yolov7":
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
        import os
        import torch

        low_memory = _low_memory_mode()
        imgsz = int(os.getenv("YOLO_IMGSZ", "256" if low_memory else "416"))
        conf = float(os.getenv("YOLO_CONF", "0.25"))

        # Force CPU inference mode and controlled options to reduce memory
        try:
            with torch.inference_mode():
                results = self.model.predict(
                    image,
                    device="cpu",
                    imgsz=imgsz,
                    conf=conf,
                    verbose=False,
                    save=False,
                    save_txt=False,
                    save_conf=False,
                    stream=False,
                )
        except Exception:
            # Fallback to older call signature
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
