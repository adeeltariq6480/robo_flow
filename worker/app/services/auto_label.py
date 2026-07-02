import asyncio

from app.core.jobs import update_job
from app.models.schemas import DetectionBox, JobConfig
from app.services.detection_merge import merge_detections
from app.services.firestore_repo import (
    classify_queue,
    detections_to_objects,
    list_dataset_images,
    save_image_annotations,
    update_image_queue,
)
from app.services.storage import (
    build_class_name_map,
    download_image_row,
    download_model,
    get_project_class_map,
)
from app.services.yolo_inference import run_yolo_inference


def _resolve_model_ids(data: dict) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()

    for raw in data.get("model_ids") or []:
        key = str(raw)
        if key not in seen:
            seen.add(key)
            ids.append(key)

    if data.get("model_id"):
        key = str(data["model_id"])
        if key not in seen:
            ids.insert(0, key)

    if not ids:
        raise ValueError("No model_ids on job")
    return ids


async def run_auto_label(
    job_id: str,
    project_id: str,
    data: dict,
    config: JobConfig,
) -> dict:
    model_ids = _resolve_model_ids(data)
    dataset_id = str(data["dataset_id"])

    class_id_map = get_project_class_map(project_id)
    config.class_name_map = build_class_name_map(project_id, config.class_name_map)

    file_list = list_dataset_images(project_id, dataset_id)
    total = len(file_list)

    if total == 0:
        raise ValueError("Dataset has no files to label")

    low_threshold = int(getattr(config, "low_label_threshold", 1) or 1)

    await update_job(
        job_id,
        progress=2,
        progress_message=f"Loading {len(model_ids)} model(s)…",
        processed_items=0,
        project_id=project_id,
    )

    model_paths: list[tuple[str, object]] = []
    for i, model_id in enumerate(model_ids):
        pct = int(2 + (i / max(len(model_ids), 1)) * 8)
        await update_job(
            job_id,
            progress=pct,
            progress_message=f"Downloading model {i + 1}/{len(model_ids)}…",
            project_id=project_id,
        )
        model_path = await asyncio.to_thread(download_model, model_id, project_id)
        model_paths.append((model_id, model_path))

    labeled = 0
    failed = 0
    all_results: list[dict] = []

    for idx, file_row in enumerate(file_list):
        file_id = str(file_row["id"])
        pct = int(10 + (idx / total) * 85)

        await update_job(
            job_id,
            progress=pct,
            progress_message=f"Labeling {idx + 1}/{total}: {file_row['fileName']} ({len(model_ids)} models)",
            processed_items=idx,
            project_id=project_id,
        )

        try:
            mime = file_row.get("mimeType") or ""
            name = file_row.get("fileName", "").lower()
            if not mime.startswith("image/") and not any(
                name.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp")
            ):
                raise ValueError("Not an image file")

            image_path = await asyncio.to_thread(
                download_image_row, file_row, file_id
            )

            combined: list[DetectionBox] = []
            per_model: dict[str, int] = {}

            for model_id, model_path in model_paths:
                inference = await asyncio.to_thread(
                    run_yolo_inference,
                    model_path,
                    image_path,
                    config,
                    model_name=model_id,
                    class_id_map=class_id_map,
                )
                combined.extend(inference.detections)
                per_model[model_id] = len(inference.detections)

            merged = merge_detections(combined, iou_threshold=config.iou)
            detections = [d.model_dump() for d in merged]
            objects = detections_to_objects(detections)
            class_known = all(d.get("project_class_id") for d in detections) if detections else True

            if config.save_to_dataset:
                save_image_annotations(
                    project_id,
                    file_id,
                    objects,
                    job_id=job_id,
                    source="auto",
                    auto_labeled=True,
                )
                queue_type, reason = classify_queue(
                    objects,
                    confidence=config.confidence,
                    low_label_threshold=low_threshold,
                    class_id_known=class_known,
                    per_model=per_model if len(model_ids) > 1 else None,
                )
                update_image_queue(project_id, file_id, queue_type, reason)

            labeled += 1
            all_results.append(
                {
                    "file_id": file_id,
                    "detections": len(objects),
                    "per_model": per_model,
                }
            )

        except Exception as exc:
            failed += 1
            all_results.append({"file_id": file_id, "error": str(exc)})

    await update_job(
        job_id, processed_items=total, project_id=project_id
    )

    if labeled == 0 and failed > 0:
        samples = [
            str(r.get("error", "unknown"))
            for r in all_results
            if r.get("error")
        ][:3]
        hint = "; ".join(samples) if samples else "unknown error"
        raise ValueError(
            f"All {failed} image(s) failed to label. Common causes: missing Hugging Face "
            f"path on images, HF_TOKEN/HF_MODEL_REPO not set on Railway, or YOLO model error. "
            f"Examples: {hint}"
        )

    return {
        "job_type": "auto_label",
        "dataset_id": dataset_id,
        "model_id": model_ids[0],
        "model_ids": model_ids,
        "models_used": len(model_ids),
        "total_files": total,
        "labeled": labeled,
        "failed": failed,
        "files": all_results,
    }
