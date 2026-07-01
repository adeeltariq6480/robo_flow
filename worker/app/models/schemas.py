from enum import Enum
from typing import Any

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
    image_size: int = Field(default=640, ge=64, le=4096)
    low_label_threshold: int = Field(default=1, ge=0)
    class_name_map: dict[str, str] = Field(
        default_factory=dict,
        description="Map YOLO class names to project class names",
    )
    save_to_dataset: bool = Field(
        default=True,
        description="For auto_label: persist annotations to dataset_files",
    )


class TestRunRequest(BaseModel):
    project_id: str
    model_id: str
    image_path: str | None = None
    dataset_file_id: str | None = None
    config: JobConfig = Field(default_factory=JobConfig)


class AutoLabelRequest(BaseModel):
    project_id: str
    dataset_id: str
    model_id: str | None = None
    model_ids: list[str] = Field(default_factory=list, max_length=10)
    config: JobConfig = Field(default_factory=JobConfig)

    @model_validator(mode="after")
    def require_models(self) -> "AutoLabelRequest":
        if not self.resolved_model_ids():
            raise ValueError("Provide model_id or at least one entry in model_ids")
        return self

    def resolved_model_ids(self) -> list[str]:
        ids: list[str] = []
        seen: set[str] = set()
        for mid in [self.model_id, *self.model_ids]:
            if mid is None:
                continue
            if mid not in seen:
                seen.add(mid)
                ids.append(mid)
        return ids


class ModelCompareRequest(BaseModel):
    project_id: str
    model_ids: list[str] = Field(min_length=2, max_length=5)
    image_path: str | None = None
    dataset_file_id: str | None = None
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
    id: str
    project_id: str
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
    job_id: str
    queue_name: JobQueue
    status: JobStatus
    message: str


# ---------------------------------------------------------------------------
# REST request bodies (project / class / dataset CRUD)
# ---------------------------------------------------------------------------

class ProjectCreate(BaseModel):
    name: str
    description: str | None = None
    annotation_type: str = Field(default="bounding_box", alias="annotationType")

    model_config = {"populate_by_name": True}


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    annotation_type: str | None = Field(default=None, alias="annotationType")

    model_config = {"populate_by_name": True}


class ClassItem(BaseModel):
    class_name: str = Field(alias="className")
    class_index: int | None = Field(default=None, alias="classIndex")
    color: str | None = None
    description: str | None = None

    model_config = {"populate_by_name": True}


class ClassesSave(BaseModel):
    project_id: str = Field(alias="projectId")
    classes: list[ClassItem]

    model_config = {"populate_by_name": True}


class DatasetCreate(BaseModel):
    project_id: str = Field(alias="projectId")
    name: str

    model_config = {"populate_by_name": True}


class AnnotationObjectIn(BaseModel):
    class_id: str | None = Field(default=None, alias="classId")
    class_index: int = Field(default=0, alias="classIndex")
    class_name: str = Field(alias="className")
    x_min: float = Field(alias="xMin")
    y_min: float = Field(alias="yMin")
    x_max: float = Field(alias="xMax")
    y_max: float = Field(alias="yMax")
    confidence: float = 1.0

    model_config = {"populate_by_name": True}


class AnnotationsSave(BaseModel):
    objects: list[AnnotationObjectIn] = Field(default_factory=list)


class ReviewAction(BaseModel):
    project_id: str = Field(alias="projectId")
    image_id: str = Field(alias="imageId")

    model_config = {"populate_by_name": True}


class ExportRequest(BaseModel):
    project_id: str = Field(alias="projectId")
    export_format: str = Field(alias="exportFormat")

    model_config = {"populate_by_name": True}
