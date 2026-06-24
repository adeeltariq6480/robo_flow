import asyncio
from uuid import UUID

from app.core.jobs import update_job
from app.models.schemas import DetectionBox, JobConfig, JobStatus
from app.services.detection_merge import merge_detections
from app.services.firestore_repo import (
    classify_queue,
    list_dataset_images,
    save_image_annotations,
    update_image_queue,
)
from app.services.storage import (
    build_class_name_map,
    download_dataset_image,
    download_model,
    get_project_class_map,
)
from app.services.yolo_inference import run_yolo_inference


def _resolve_model_ids(data: dict) -> list[UUID]:
    ids: list[UUID] = []
    seen: set[str] = set()

    for raw in data.get("model_ids") or []:
        key = str(raw)
        if key not in seen:
            seen.add(key)
            ids.append(UUID(key) if isinstance(raw, str) else raw)

    if data.get("model_id"):
        key = str(data["model_id"])
        if key not in seen:
            ids.insert(0, UUID(key) if isinstance(data["model_id"], str) else data["model_id"])

    if not ids:
        raise ValueError("No model_ids on job")
    return ids


async def run_auto_label(
    job_id: UUID,
    project_id: UUID,
    data: dict,
    config: JobConfig,
    project_id_str: str,
) -> dict:
    model_ids = _resolve_model_ids(data)
    dataset_id = UUID(data["dataset_id"])

    class_id_map = get_project_class_map(project_id)
    config.class_name_map = build_class_name_map(project_id, config.class_name_map)

    file_list = list_dataset_images(project_id_str, str(dataset_id))
    total = len(file_list)

    if total == 0:
        raise ValueError("Dataset has no files to label")

    low_threshold = int(getattr(config, "low_label_threshold", 1) or 1)

    await update_job(
        job_id,
        progress=2,
        progress_message=f"Loading {len(model_ids)} model(s)…",
        processed_items=0,
        project_id=project_id_str,
    )

    model_paths: list[tuple[UUID, object]] = []
    for i, model_id in enumerate(model_ids):
        pct = int(2 + (i / max(len(model_ids), 1)) * 8)
        await update_job(
            job_id,
            progress=pct,
            progress_message=f"Downloading model {i + 1}/{len(model_ids)}…",
            project_id=project_id_str,
        )
        model_path = await asyncio.to_thread(download_model, model_id, project_id)
        model_paths.append((model_id, model_path))

    labeled = 0
    failed = 0
    all_results: list[dict] = []

    for idx, file_row in enumerate(file_list):
        file_id = UUID(file_row["id"])
        pct = int(10 + (idx / total) * 85)

        await update_job(
            job_id,
            progress=pct,
            progress_message=f"Labeling {idx + 1}/{total}: {file_row['fileName']} ({len(model_ids)} models)",
            processed_items=idx,
            project_id=project_id_str,
        )

        try:
            mime = file_row.get("mimeType") or ""
            name = file_row.get("fileName", "").lower()
            if not mime.startswith("image/") and not any(
                name.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp")
            ):
                raise ValueError("Not an image file")

            image_path = await asyncio.to_thread(
                download_dataset_image, file_row["storagePath"], file_id
            )

            combined: list[DetectionBox] = []
            per_model: dict[str, int] = {}

            for model_id, model_path in model_paths:
                inference = await asyncio.to_thread(
                    run_yolo_inference,
                    model_path,
                    image_path,
                    config,
                    model_name=str(model_id),
                    class_id_map=class_id_map,
                )
                combined.extend(inference.detections)
                per_model[str(model_id)] = len(inference.detections)

            merged = merge_detections(combined, iou_threshold=config.iou)
            annotations = [d.model_dump() for d in merged]

            if config.save_to_dataset:
                save_image_annotations(
                    project_id_str,
                    str(file_id),
                    annotations,
                    job_id=str(job_id),
                    source="auto",
                    auto_labeled=True,
                )
                queue_type, reason = classify_queue(
                    annotations,
                    confidence=config.confidence,
                    low_label_threshold=low_threshold,
                    per_model=per_model if len(model_ids) > 1 else None,
                )
                update_image_queue(project_id_str, str(file_id), queue_type, reason)

            labeled += 1
            all_results.append(
                {
                    "file_id": str(file_id),
                    "detections": len(annotations),
                    "per_model": per_model,
                }
            )

        except Exception as exc:
            failed += 1
            logger_msg = str(exc)
            all_results.append({"file_id": str(file_id), "error": logger_msg})

    await update_job(
        job_id, processed_items=total, project_id=project_id_str
    )

    return {
        "job_type": "auto_label",
        "dataset_id": str(dataset_id),
        "model_id": str(model_ids[0]),
        "model_ids": [str(m) for m in model_ids],
        "models_used": len(model_ids),
        "total_files": total,
        "labeled": labeled,
        "failed": failed,
        "files": all_results,
    }
