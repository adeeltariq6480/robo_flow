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
from app.services.supabase_client import get_supabase

router = APIRouter(prefix="/jobs", tags=["jobs"])


async def verify_api_key(x_worker_key: str = Header(default="")) -> None:
    if x_worker_key != settings.worker_api_key:
        raise HTTPException(status_code=401, detail="Invalid worker API key")


@router.post("/test-run", response_model=JobCreateResponse)
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


@router.post("/auto-label", response_model=JobCreateResponse)
async def create_auto_label(
    body: AutoLabelRequest,
    _: None = Depends(verify_api_key),
):
    sb = get_supabase()
    files = (
        sb.table("dataset_files")
        .select("id", count="exact")
        .eq("dataset_id", str(body.dataset_id))
        .execute()
    )
    total = files.count or 0

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


@router.post("/model-compare", response_model=JobCreateResponse)
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


@router.get("/queues/stats")
async def queue_stats(_: None = Depends(verify_api_key)):
    return queue_manager.queue_stats()


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: UUID, _: None = Depends(verify_api_key)):
    sb = get_supabase()
    row = (
        sb.table("inference_jobs")
        .select("*")
        .eq("id", str(job_id))
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="Job not found")

    d = row.data
    return JobResponse(
        id=UUID(d["id"]),
        project_id=UUID(d["project_id"]),
        job_type=d["job_type"],
        queue_name=d["queue_name"],
        status=d["status"],
        progress=d["progress"],
        progress_message=d.get("progress_message"),
        total_items=d.get("total_items", 0),
        processed_items=d.get("processed_items", 0),
        result=d.get("result"),
        error_message=d.get("error_message"),
    )


@router.get("/{job_id}/items")
async def get_job_items(job_id: UUID, _: None = Depends(verify_api_key)):
    sb = get_supabase()
    rows = (
        sb.table("inference_job_items")
        .select("*")
        .eq("job_id", str(job_id))
        .order("created_at")
        .execute()
    )
    return {"items": rows.data or []}
