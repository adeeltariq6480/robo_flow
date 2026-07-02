import asyncio
from collections import defaultdict

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
from app.services.yolo_inference import run_yolo_inference, unload_model

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


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


def _is_image_row(file_row: dict) -> bool:
    mime = file_row.get("mimeType") or ""
    name = file_row.get("fileName", "").lower()
    return mime.startswith("image/") or any(name.endswith(ext) for ext in IMAGE_EXTS)


def _compact_job_result(
    *,
    dataset_id: str,
    model_ids: list[str],
    total: int,
    labeled: int,
    failed: int,
    all_results: list[dict],
) -> dict:
    """Keep Firestore job documents small (1 MB limit)."""
    error_rows = [r for r in all_results if r.get("error")]
    return {
        "job_type": "auto_label",
        "dataset_id": dataset_id,
        "model_id": model_ids[0],
        "model_ids": model_ids,
        "models_used": len(model_ids),
        "total_files": total,
        "labeled": labeled,
        "failed": failed,
        "files": error_rows[:25],
        "files_truncated": len(error_rows) > 25,
    }


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
    num_models = len(model_ids)

    await update_job(
        job_id,
        progress=2,
        progress_message=f"Preparing {total} image(s), {num_models} model(s)…",
        processed_items=0,
        project_id=project_id,
    )

    # --- Phase 1: download images once ---
    image_paths: dict[str, object] = {}
    prep_failures: dict[str, str] = {}

    for idx, file_row in enumerate(file_list):
        file_id = str(file_row["id"])
        pct = int(2 + (idx / max(total, 1)) * 8)
        if idx % 5 == 0 or idx == total - 1:
            await update_job(
                job_id,
                progress=pct,
                progress_message=f"Downloading image {idx + 1}/{total}…",
                processed_items=0,
                project_id=project_id,
            )
        if not _is_image_row(file_row):
            prep_failures[file_id] = "Not an image file"
            continue
        try:
            image_paths[file_id] = await asyncio.to_thread(
                download_image_row, file_row, file_id
            )
        except Exception as exc:
            prep_failures[file_id] = str(exc)

    # --- Phase 2: one YOLO model in RAM at a time (critical for 4+ models on Railway) ---
    per_image_dets: dict[str, list[DetectionBox]] = defaultdict(list)
    per_image_models: dict[str, dict[str, int]] = defaultdict(dict)

    for mi, model_id in enumerate(model_ids):
        await update_job(
            job_id,
            progress=int(10 + (mi / max(num_models, 1)) * 15),
            progress_message=f"Loading model {mi + 1}/{num_models}…",
            project_id=project_id,
        )
        model_path = await asyncio.to_thread(download_model, model_id, project_id)
        try:
            ready_ids = [fid for fid in image_paths if fid not in prep_failures]
            for idx, file_id in enumerate(ready_ids):
                pct = int(25 + ((mi + idx / max(len(ready_ids), 1)) / num_models) * 60)
                if idx % 3 == 0 or idx == len(ready_ids) - 1:
                    await update_job(
                        job_id,
                        progress=pct,
                        progress_message=(
                            f"Model {mi + 1}/{num_models} · "
                            f"image {idx + 1}/{len(ready_ids)}"
                        ),
                        processed_items=idx,
                        project_id=project_id,
                    )
                inference = await asyncio.to_thread(
                    run_yolo_inference,
                    model_path,
                    image_paths[file_id],
                    config,
                    model_name=model_id,
                    class_id_map=class_id_map,
                )
                per_image_dets[file_id].extend(inference.detections)
                per_image_models[file_id][model_id] = len(inference.detections)
        finally:
            await asyncio.to_thread(unload_model, model_path)

    # --- Phase 3: merge + save ---
    labeled = 0
    failed = len(prep_failures)
    all_results: list[dict] = [
        {"file_id": fid, "error": err} for fid, err in prep_failures.items()
    ]

    for idx, file_row in enumerate(file_list):
        file_id = str(file_row["id"])
        if file_id in prep_failures:
            continue

        pct = int(85 + (idx / max(total, 1)) * 14)
        await update_job(
            job_id,
            progress=pct,
            progress_message=f"Saving labels {idx + 1}/{total}…",
            processed_items=idx,
            project_id=project_id,
        )

        try:
            combined = per_image_dets.get(file_id, [])
            per_model = per_image_models.get(file_id, {})

            merged = merge_detections(combined, iou_threshold=config.iou)
            detections = [d.model_dump() for d in merged]
            objects = detections_to_objects(detections)
            class_known = (
                all(d.get("project_class_id") for d in detections) if detections else True
            )

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
                    per_model=per_model if num_models > 1 else None,
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

    await update_job(job_id, processed_items=total, project_id=project_id)

    if labeled == 0 and failed > 0:
        samples = [
            str(r.get("error", "unknown"))
            for r in all_results
            if r.get("error")
        ][:3]
        hint = "; ".join(samples) if samples else "unknown error"
        raise ValueError(
            f"All {failed} image(s) failed to label. "
            f"Check HF_TOKEN, HF_DATASET_REPO, HF_MODEL_REPO on Railway, and that "
            f"images/models have Hugging Face paths. Examples: {hint}"
        )

    return _compact_job_result(
        dataset_id=dataset_id,
        model_ids=model_ids,
        total=total,
        labeled=labeled,
        failed=failed,
        all_results=all_results,
    )
