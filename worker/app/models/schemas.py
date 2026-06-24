from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class JobType(str, Enum):
    TEST_RUN = "test_run"
    AUTO_LABEL = "auto_label"
    MODEL_COMPARE = "model_compare"


class JobQueue(str, Enum):
    INTERACTIVE = "interactive"
    BATCH = "batch"
    COMPARE = "compare"


class JobStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


QUEUE_FOR_JOB_TYPE: dict[JobType, JobQueue] = {
    JobType.TEST_RUN: JobQueue.INTERACTIVE,
    JobType.AUTO_LABEL: JobQueue.BATCH,
    JobType.MODEL_COMPARE: JobQueue.COMPARE,
}


class JobConfig(BaseModel):
    confidence: float = Field(default=0.25, ge=0.0, le=1.0)
    iou: float = Field(default=0.45, ge=0.0, le=1.0)
    class_name_map: dict[str, str] = Field(
        default_factory=dict,
        description="Map YOLO class names to project class names",
    )
    save_to_dataset: bool = Field(
        default=True,
        description="For auto_label: persist annotations to dataset_files",
    )


class TestRunRequest(BaseModel):
    project_id: UUID
    model_id: UUID
    image_path: str | None = None
    dataset_file_id: UUID | None = None
    config: JobConfig = Field(default_factory=JobConfig)


class AutoLabelRequest(BaseModel):
    project_id: UUID
    dataset_id: UUID
    model_id: UUID | None = None
    model_ids: list[UUID] = Field(default_factory=list, max_length=10)
    config: JobConfig = Field(default_factory=JobConfig)

    @model_validator(mode="after")
    def require_models(self) -> "AutoLabelRequest":
        if not self.resolved_model_ids():
            raise ValueError("Provide model_id or at least one entry in model_ids")
        return self

    def resolved_model_ids(self) -> list[UUID]:
        ids: list[UUID] = []
        seen: set[str] = set()
        for mid in [self.model_id, *self.model_ids]:
            if mid is None:
                continue
            key = str(mid)
            if key not in seen:
                seen.add(key)
                ids.append(mid)
        return ids


class ModelCompareRequest(BaseModel):
    project_id: UUID
    model_ids: list[UUID] = Field(min_length=2, max_length=5)
    image_path: str | None = None
    dataset_file_id: UUID | None = None
    config: JobConfig = Field(default_factory=JobConfig)


class DetectionBox(BaseModel):
    class_id: str | None = None
    class_name: str
    project_class_id: str | None = None
    confidence: float
    x: float
    y: float
    width: float
    height: float


class InferenceResult(BaseModel):
    detections: list[DetectionBox] = Field(default_factory=list)
    inference_ms: float | None = None
    model_name: str | None = None


class ModelCompareResult(BaseModel):
    models: dict[str, InferenceResult]
    winner_model_id: str | None = None
    winner_reason: str | None = None


class JobResponse(BaseModel):
    id: UUID
    project_id: UUID
    job_type: JobType
    queue_name: JobQueue
    status: JobStatus
    progress: int
    progress_message: str | None = None
    total_items: int = 0
    processed_items: int = 0
    result: dict[str, Any] | None = None
    error_message: str | None = None


class JobCreateResponse(BaseModel):
    job_id: UUID
    queue_name: JobQueue
    status: JobStatus
    message: str
