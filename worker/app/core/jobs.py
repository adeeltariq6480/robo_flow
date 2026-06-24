import logging
from uuid import UUID

from app.core.queue import queue_manager
from app.models.schemas import QUEUE_FOR_JOB_TYPE, JobConfig, JobQueue, JobStatus, JobType
from app.services.auto_label import run_auto_label
from app.services.model_compare import run_model_compare
from app.services.firestore_repo import (
    create_labelling_job,
    get_labelling_job,
    update_labelling_job,
)
from app.services.test_run import run_test_run

logger = logging.getLogger(__name__)

_job_project_map: dict[str, str] = {}


def register_job_project(job_id: UUID, project_id: UUID) -> None:
    _job_project_map[str(job_id)] = str(project_id)


def get_job_project(job_id: UUID) -> str | None:
    return _job_project_map.get(str(job_id))


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
    project_id: str | None = None,
) -> None:
    pid = project_id or get_job_project(job_id)
    if not pid:
        return

    import asyncio

    await asyncio.to_thread(
        update_labelling_job,
        pid,
        str(job_id),
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
    cfg = (config or JobConfig()).model_dump()
    job_id = create_labelling_job(
        str(project_id),
        job_type=job_type.value,
        dataset_id=str(dataset_id) if dataset_id else None,
        model_id=str(model_id) if model_id else None,
        model_ids=[str(m) for m in (model_ids or [])],
        config=cfg,
        input_payload=input_payload or {},
        total_items=total_items,
    )
    return UUID(job_id)


async def process_job(job_id: UUID) -> None:
    project_id = get_job_project(job_id)
    if not project_id:
        logger.error("Job %s missing project mapping", job_id)
        return

    job = get_labelling_job(project_id, str(job_id))
    if not job:
        logger.error("Job %s not found in project %s", job_id, project_id)
        return

    job_type = JobType(job["jobType"])
    pid = UUID(project_id)
    config = JobConfig(**(job.get("config") or {}))

    await update_job(
        job_id,
        status=JobStatus.RUNNING,
        progress=0,
        progress_message="Starting…",
        mark_started=True,
        project_id=project_id,
    )

    data = {
        "project_id": project_id,
        "model_id": job.get("modelId"),
        "model_ids": job.get("modelIds") or [],
        "dataset_id": job.get("datasetId"),
        "input_payload": job.get("inputPayload") or {},
    }

    try:
        if job_type == JobType.TEST_RUN:
            result = await run_test_run(job_id, pid, data, config, project_id)
        elif job_type == JobType.AUTO_LABEL:
            result = await run_auto_label(job_id, pid, data, config, project_id)
        elif job_type == JobType.MODEL_COMPARE:
            result = await run_model_compare(job_id, pid, data, config, project_id)
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
    except Exception as exc:
        logger.exception("Job %s failed", job_id)
        await update_job(
            job_id,
            status=JobStatus.FAILED,
            progress_message="Failed",
            error_message=str(exc),
            mark_completed=True,
            project_id=project_id,
        )


async def submit_job(
    project_id: UUID,
    job_type: JobType,
    **kwargs,
) -> tuple[UUID, JobQueue, int]:
    job_id = await create_job_record(project_id, job_type, **kwargs)
    register_job_project(job_id, project_id)
    queue = QUEUE_FOR_JOB_TYPE[job_type]
    position = await queue_manager.enqueue(job_id, queue)
    return job_id, queue, position
