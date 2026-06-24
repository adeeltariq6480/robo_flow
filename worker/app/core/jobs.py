import logging
from datetime import datetime, timezone
from uuid import UUID

from app.core.queue import queue_manager
from app.models.schemas import QUEUE_FOR_JOB_TYPE, JobConfig, JobQueue, JobStatus, JobType
from app.services.auto_label import run_auto_label
from app.services.model_compare import run_model_compare
from app.services.supabase_client import get_supabase
from app.services.test_run import run_test_run

logger = logging.getLogger(__name__)


async def update_job(
    job_id: UUID,
    *,
    status: JobStatus | None = None,
    progress: int | None = None,
    progress_message: str | None = None,
    processed_items: int | None = None,
    result: dict | None = None,
    error_message: str | None = None,
    mark_started: bool = False,
    mark_completed: bool = False,
) -> None:
    sb = get_supabase()
    payload: dict = {}
    if status is not None:
        payload["status"] = status.value
    if progress is not None:
        payload["progress"] = progress
    if progress_message is not None:
        payload["progress_message"] = progress_message
    if processed_items is not None:
        payload["processed_items"] = processed_items
    if result is not None:
        payload["result"] = result
    if error_message is not None:
        payload["error_message"] = error_message
    if mark_started:
        payload["started_at"] = datetime.now(timezone.utc).isoformat()
    if mark_completed:
        payload["completed_at"] = datetime.now(timezone.utc).isoformat()

    if payload:
        sb.table("inference_jobs").update(payload).eq("id", str(job_id)).execute()


async def create_job_record(
    project_id: UUID,
    job_type: JobType,
    *,
    model_id: UUID | None = None,
    model_ids: list[UUID] | None = None,
    dataset_id: UUID | None = None,
    config: JobConfig | None = None,
    input_payload: dict | None = None,
    total_items: int = 0,
) -> UUID:
    queue = QUEUE_FOR_JOB_TYPE[job_type]
    sb = get_supabase()
    row = {
        "project_id": str(project_id),
        "job_type": job_type.value,
        "queue_name": queue.value,
        "status": JobStatus.QUEUED.value,
        "model_id": str(model_id) if model_id else None,
        "model_ids": [str(m) for m in (model_ids or [])],
        "dataset_id": str(dataset_id) if dataset_id else None,
        "config": (config or JobConfig()).model_dump(),
        "input_payload": input_payload or {},
        "total_items": total_items,
        "progress_message": f"Queued on {queue.value} queue",
    }
    result = sb.table("inference_jobs").insert(row).execute()
    return UUID(result.data[0]["id"])


async def process_job(job_id: UUID) -> None:
    sb = get_supabase()
    job = (
        sb.table("inference_jobs")
        .select("*")
        .eq("id", str(job_id))
        .single()
        .execute()
    )
    if not job.data:
        logger.error("Job %s not found", job_id)
        return

    data = job.data
    job_type = JobType(data["job_type"])
    project_id = UUID(data["project_id"])
    config = JobConfig(**(data.get("config") or {}))

    await update_job(
        job_id,
        status=JobStatus.RUNNING,
        progress=0,
        progress_message="Starting…",
        mark_started=True,
    )

    try:
        if job_type == JobType.TEST_RUN:
            result = await run_test_run(job_id, project_id, data, config)
        elif job_type == JobType.AUTO_LABEL:
            result = await run_auto_label(job_id, project_id, data, config)
        elif job_type == JobType.MODEL_COMPARE:
            result = await run_model_compare(job_id, project_id, data, config)
        else:
            raise ValueError(f"Unknown job type: {job_type}")

        await update_job(
            job_id,
            status=JobStatus.COMPLETED,
            progress=100,
            progress_message="Completed",
            result=result,
            mark_completed=True,
        )
    except Exception as exc:
        logger.exception("Job %s failed", job_id)
        await update_job(
            job_id,
            status=JobStatus.FAILED,
            progress_message="Failed",
            error_message=str(exc),
            mark_completed=True,
        )


async def submit_job(
    project_id: UUID,
    job_type: JobType,
    **kwargs,
) -> tuple[UUID, JobQueue, int]:
    job_id = await create_job_record(project_id, job_type, **kwargs)
    queue = QUEUE_FOR_JOB_TYPE[job_type]
    position = await queue_manager.enqueue(job_id, queue)
    return job_id, queue, position
