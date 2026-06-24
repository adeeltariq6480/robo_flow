import asyncio
from pathlib import Path
from uuid import UUID

from app.core.jobs import update_job
from app.models.schemas import JobConfig
from app.services.storage import (
    build_class_name_map,
    download_dataset_image,
    download_model,
    get_project_class_map,
)
from app.services.yolo_inference import run_yolo_inference


async def _resolve_image(
    project_id: UUID,
    data: dict,
) -> tuple[Path, str | None]:
    input_payload = data.get("input_payload") or {}

    if input_payload.get("dataset_file_id"):
        file_id = UUID(input_payload["dataset_file_id"])
        from app.services.supabase_client import get_supabase

        sb = get_supabase()
        row = (
            sb.table("dataset_files")
            .select("file_path")
            .eq("id", str(file_id))
            .single()
            .execute()
        )
        if not row.data:
            raise ValueError(f"Dataset file {file_id} not found")
        path = await asyncio.to_thread(
            download_dataset_image, row.data["file_path"], file_id
        )
        return path, str(file_id)

    if input_payload.get("image_path"):
        return Path(input_payload["image_path"]), None

    raise ValueError("test_run requires dataset_file_id or image_path")


async def run_test_run(
    job_id: UUID,
    project_id: UUID,
    data: dict,
    config: JobConfig,
) -> dict:
    model_id = UUID(data["model_id"])
    class_id_map = get_project_class_map(project_id)
    config.class_name_map = build_class_name_map(project_id, config.class_name_map)

    await update_job(
        job_id, progress=10, progress_message="Downloading model…"
    )

    model_path = await asyncio.to_thread(download_model, model_id, project_id)
    image_path, file_id = await _resolve_image(project_id, data)

    await update_job(job_id, progress=40, progress_message="Running YOLO inference…")

    result = await asyncio.to_thread(
        run_yolo_inference,
        model_path,
        image_path,
        config,
        model_name=str(model_id),
        class_id_map=class_id_map,
    )

    await update_job(job_id, progress=90, progress_message="Finalizing…")

    return {
        "job_type": "test_run",
        "model_id": str(model_id),
        "dataset_file_id": file_id,
        "inference": result.model_dump(),
    }
