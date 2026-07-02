import asyncio
from pathlib import Path

from app.core.jobs import update_job
from app.models.schemas import JobConfig
from app.services.supabase_repo import get_image
from app.services.storage import (
    build_class_name_map,
    download_image_row,
    download_model,
    get_project_class_map,
)
from app.services.yolo_inference import run_yolo_inference


async def _resolve_image(
    project_id: str,
    data: dict,
) -> tuple[Path, str | None]:
    input_payload = data.get("input_payload") or {}

    if input_payload.get("dataset_file_id"):
        file_id = str(input_payload["dataset_file_id"])
        row = get_image(project_id, file_id)
        if not row:
            raise ValueError(f"Image {file_id} not found")
        path = await asyncio.to_thread(download_image_row, row, file_id)
        return path, file_id

    if input_payload.get("image_path"):
        return Path(input_payload["image_path"]), None

    raise ValueError("test_run requires dataset_file_id or image_path")


async def run_test_run(
    job_id: str,
    project_id: str,
    data: dict,
    config: JobConfig,
) -> dict:
    model_id = str(data["model_id"])
    class_id_map = get_project_class_map(project_id)
    config.class_name_map = build_class_name_map(project_id, config.class_name_map)

    await update_job(
        job_id, progress=10, progress_message="Downloading model…", project_id=project_id
    )

    model_path = await asyncio.to_thread(download_model, model_id, project_id)
    image_path, file_id = await _resolve_image(project_id, data)

    await update_job(
        job_id, progress=40, progress_message="Running YOLO inference…", project_id=project_id
    )

    result = await asyncio.to_thread(
        run_yolo_inference,
        model_path,
        image_path,
        config,
        model_name=model_id,
        class_id_map=class_id_map,
    )

    await update_job(
        job_id, progress=90, progress_message="Finalizing…", project_id=project_id
    )

    return {
        "job_type": "test_run",
        "model_id": model_id,
        "dataset_file_id": file_id,
        "inference": result.model_dump(),
    }
