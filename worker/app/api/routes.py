from fastapi import APIRouter, Depends, HTTPException, Header
from uuid import UUID

from app.config import settings
from app.core.jobs import submit_job
from app.core.queue import queue_manager
from app.models.schemas import (
    AutoLabelRequest,
    JobCreateResponse,
    JobResponse,
    JobStatus,
    JobType,
    ModelCompareRequest,
    TestRunRequest,
)
from app.services.firestore_repo import count_dataset_images, get_labelling_job
from app.services.firebase_client import get_db

jobs_router = APIRouter(prefix="/jobs", tags=["jobs"])
api_router = APIRouter(prefix="/api", tags=["api"])


async def verify_api_key(x_worker_key: str = Header(default="")) -> None:
    if x_worker_key != settings.worker_api_key:
        raise HTTPException(status_code=401, detail="Invalid worker API key")


def _resolve_project_for_job(job_id: str) -> str | None:
    doc = get_db().collection("jobRegistry").document(job_id).get()
    if not doc.exists:
        return None
    return doc.to_dict().get("projectId")


def _job_to_response(project_id: str, job_id: str, d: dict) -> JobResponse:
    queue_map = {
        "test_run": "interactive",
        "auto_label": "batch",
        "model_compare": "compare",
    }
    return JobResponse(
        id=UUID(job_id),
        project_id=UUID(project_id),
        job_type=d.get("jobType", "auto_label"),
        queue_name=queue_map.get(d.get("jobType", ""), "batch"),
        status=d.get("status", "queued"),
        progress=d.get("progress", 0),
        progress_message=d.get("progressMessage"),
        total_items=d.get("totalItems", 0),
        processed_items=d.get("processedItems", 0),
        result=d.get("result"),
        error_message=d.get("errorMessage"),
    )


@jobs_router.post("/test-run", response_model=JobCreateResponse)
@api_router.post("/test-run", response_model=JobCreateResponse)
async def create_test_run(
    body: TestRunRequest,
    _: None = Depends(verify_api_key),
):
    if not body.image_path and not body.dataset_file_id:
        raise HTTPException(
            status_code=400,
            detail="Provide image_path or dataset_file_id",
        )

    job_id, queue, position = await submit_job(
        body.project_id,
        JobType.TEST_RUN,
        model_id=body.model_id,
        config=body.config,
        input_payload={
            "image_path": body.image_path,
            "dataset_file_id": str(body.dataset_file_id) if body.dataset_file_id else None,
        },
    )

    return JobCreateResponse(
        job_id=job_id,
        queue_name=queue,
        status=JobStatus.QUEUED,
        message=f"Test run queued (position {position} on {queue.value} queue)",
    )


@jobs_router.post("/auto-label", response_model=JobCreateResponse)
@api_router.post("/auto-label", response_model=JobCreateResponse)
async def create_auto_label(
    body: AutoLabelRequest,
    _: None = Depends(verify_api_key),
):
    total = count_dataset_images(str(body.project_id), str(body.dataset_id))
    model_ids = body.resolved_model_ids()

    job_id, queue, position = await submit_job(
        body.project_id,
        JobType.AUTO_LABEL,
        model_id=model_ids[0],
        model_ids=model_ids,
        dataset_id=body.dataset_id,
        config=body.config,
        total_items=total,
        input_payload={"model_ids": [str(m) for m in model_ids]},
    )

    return JobCreateResponse(
        job_id=job_id,
        queue_name=queue,
        status=JobStatus.QUEUED,
        message=f"Auto-label queued for {total} files with {len(model_ids)} model(s) (position {position})",
    )


@jobs_router.post("/model-compare", response_model=JobCreateResponse)
async def create_model_compare(
    body: ModelCompareRequest,
    _: None = Depends(verify_api_key),
):
    if not body.image_path and not body.dataset_file_id:
        raise HTTPException(
            status_code=400,
            detail="Provide image_path or dataset_file_id",
        )

    job_id, queue, position = await submit_job(
        body.project_id,
        JobType.MODEL_COMPARE,
        model_ids=body.model_ids,
        config=body.config,
        input_payload={
            "image_path": body.image_path,
            "dataset_file_id": str(body.dataset_file_id) if body.dataset_file_id else None,
        },
    )

    return JobCreateResponse(
        job_id=job_id,
        queue_name=queue,
        status=JobStatus.QUEUED,
        message=f"Model compare queued (position {position} on {queue.value} queue)",
    )


@jobs_router.get("/queues/stats")
async def queue_stats(_: None = Depends(verify_api_key)):
    return queue_manager.queue_stats()


@jobs_router.get("/{job_id}", response_model=JobResponse)
@api_router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: UUID, _: None = Depends(verify_api_key)):
    project_id = _resolve_project_for_job(str(job_id))
    if not project_id:
        raise HTTPException(status_code=404, detail="Job not found")

    d = get_labelling_job(project_id, str(job_id))
    if not d:
        raise HTTPException(status_code=404, detail="Job not found")

    return _job_to_response(project_id, str(job_id), d)
