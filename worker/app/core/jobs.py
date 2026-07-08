import logging

from app.core.queue import queue_manager
from app.models.schemas import QUEUE_FOR_JOB_TYPE, JobConfig, JobQueue, JobStatus, JobType
from app.services.supabase_repo import (
    create_labelling_job,
    get_labelling_job,
    get_job_registry_project,
    update_labelling_job,
)

logger = logging.getLogger(__name__)

_job_project_map: dict[str, str] = {}


class JobCancelled(Exception):
    """Raised when a running job sees a user cancellation request."""


def register_job_project(job_id: str, project_id: str) -> None:
    _job_project_map[job_id] = project_id


def get_job_project(job_id: str) -> str | None:
    pid = _job_project_map.get(job_id)
    if pid:
        return pid

    pid = get_job_registry_project(job_id)
    if pid:
        register_job_project(job_id, pid)
    return pid


def is_job_cancelled(job_id: str, project_id: str | None = None) -> bool:
    pid = project_id or get_job_project(job_id)
    if not pid:
        return False
    job = get_labelling_job(pid, job_id)
    return bool(job and job.get("status") == JobStatus.CANCELLED.value)


async def raise_if_job_cancelled(job_id: str, project_id: str | None = None) -> None:
    import asyncio

    cancelled = await asyncio.to_thread(is_job_cancelled, job_id, project_id)
    if cancelled:
        raise JobCancelled("Job cancelled by user")


async def update_job(
    job_id: str,
    *,
    status: JobStatus | None = None,
    progress: int | None = None,
    progress_message: str | None = None,
    processed_items: int | None = None,
    result: dict | None = None,
    error_message: str | None = None,
    mark_started: bool = False,
    mark_completed: bool = False,
    project_id: str | None = None,
) -> None:
    pid = project_id or get_job_project(job_id)
    if not pid:
        return
    if status == JobStatus.RUNNING:
        import asyncio

        if await asyncio.to_thread(is_job_cancelled, job_id, pid):
            logger.info("Skip marking cancelled job %s as running", job_id)
            return

    import asyncio

    await asyncio.to_thread(
        update_labelling_job,
        pid,
        job_id,
        status=status.value if status else None,
        progress=progress,
        progress_message=progress_message,
        processed_items=processed_items,
        result=result,
        error_message=error_message,
        mark_started=mark_started,
        mark_completed=mark_completed,
    )


async def create_job_record(
    project_id: str,
    job_type: JobType,
    *,
    model_id: str | None = None,
    model_ids: list[str] | None = None,
    dataset_id: str | None = None,
    config: JobConfig | None = None,
    input_payload: dict | None = None,
    total_items: int = 0,
) -> str:
    cfg = (config or JobConfig()).model_dump()
    job_id = create_labelling_job(
        project_id,
        job_type=job_type.value,
        dataset_id=dataset_id,
        model_id=model_id,
        model_ids=model_ids or [],
        config=cfg,
        input_payload=input_payload or {},
        total_items=total_items,
    )
    return job_id


async def process_job(job_id: str) -> None:
    project_id = get_job_project(job_id)
    if not project_id:
        logger.error("Job %s missing project mapping (jobRegistry lookup failed)", job_id)
        return

    job = get_labelling_job(project_id, job_id)
    if not job:
        logger.error("Job %s not found in project %s", job_id, project_id)
        return

    job_type = JobType(job["jobType"])
    config = JobConfig(**(job.get("config") or {}))

    if job.get("status") == JobStatus.CANCELLED.value:
        logger.info("Job %s was cancelled before start", job_id)
        return

    await update_job(
        job_id,
        status=JobStatus.RUNNING,
        progress=0,
        progress_message="Starting…",
        mark_started=True,
        project_id=project_id,
    )

    if is_job_cancelled(job_id, project_id):
        logger.info("Job %s was cancelled while starting", job_id)
        return

    data = {
        "project_id": project_id,
        "model_id": job.get("modelId"),
        "model_ids": job.get("modelIds")
        or (job.get("inputPayload") or {}).get("model_ids")
        or [],
        "dataset_id": job.get("datasetId"),
        "input_payload": job.get("inputPayload") or {},
    }

    try:
        if job_type == JobType.TEST_RUN:
            from app.services.test_run import run_test_run

            result = await run_test_run(job_id, project_id, data, config)
        elif job_type == JobType.AUTO_LABEL:
            from app.services.auto_label import run_auto_label

            result = await run_auto_label(job_id, project_id, data, config)
        elif job_type == JobType.MODEL_COMPARE:
            from app.services.model_compare import run_model_compare

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
            project_id=project_id,
        )
    except JobCancelled as exc:
        logger.info("Job %s cancelled cooperatively", job_id)
        await update_job(
            job_id,
            status=JobStatus.CANCELLED,
            progress_message="Cancelled",
            error_message=str(exc),
            mark_completed=True,
            project_id=project_id,
        )
    except Exception as exc:
        logger.exception(
            "Job %s failed (type=%s, project=%s): %s",
            job_id,
            job_type.value,
            project_id,
            exc,
        )
        # Special-case memory pause so we don't mark as a hard failure
        from app.services.yolo_inference import MemoryLimitExceeded

        if isinstance(exc, MemoryLimitExceeded):
            logger.warning("Job %s paused due to memory limit: %s", job_id, exc)
            await update_job(
                job_id,
                status=JobStatus.PAUSED_MEMORY_LIMIT,
                progress_message="Paused (memory limit)",
                error_message=str(exc),
                mark_completed=True,
                project_id=project_id,
            )
            return

        await update_job(
            job_id,
            status=JobStatus.FAILED,
            progress_message="Failed",
            error_message=str(exc),
            mark_completed=True,
            project_id=project_id,
        )


async def submit_job(
    project_id: str,
    job_type: JobType,
    **kwargs,
) -> tuple[str, JobQueue, int]:
    job_id = await create_job_record(project_id, job_type, **kwargs)
    register_job_project(job_id, project_id)
    queue = QUEUE_FOR_JOB_TYPE[job_type]
    position = await queue_manager.enqueue(job_id, queue)
    return job_id, queue, position
