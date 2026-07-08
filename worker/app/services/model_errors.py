"""Shared model-loading error types."""


class IncompatibleModelError(RuntimeError):
    """Checkpoint cannot be loaded by any available runtime on this worker."""

    def __init__(self, model_path: str, reason: str):
        self.model_path = model_path
        self.reason = reason
        super().__init__(
            f"Model incompatible with worker runtime ({model_path}): {reason}. "
            "Re-export as YOLOv8/v11 (.pt) or ONNX, then re-upload."
        )
