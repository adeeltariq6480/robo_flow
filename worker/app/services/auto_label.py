import asyncio
import gc
import logging
from collections import defaultdict

from app.core.jobs import update_job
from app.models.schemas import DetectionBox, JobConfig
from app.services.detection_merge import merge_detections
from app.services.supabase_repo import (
    classify_queue,
    detections_to_objects,
    list_dataset_images,
    save_auto_label_results,
)
from app.services.storage import (
    build_class_name_map,
    download_image_row,
    download_model,
    get_project_class_map,
)
from app.services.yolo_inference import prewarm_yolo, run_yolo_inference, unload_model

logger = logging.getLogger(__name__)

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


def _resolve_model_ids(data: dict) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()

    payload = data.get("input_payload") or {}
    raw_ids = data.get("model_ids") or payload.get("model_ids") or []

    for raw in raw_ids:
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


def _progress_interval(total: int) -> int:
    if total <= 50:
        return 5
    if total <= 200:
        return 20
    return 50


def _compact_job_result(
    *,
    dataset_id: str,
    model_ids: list[str],
    total: int,
    labeled: int,
    failed: int,
    all_results: list[dict],
) -> dict:
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
    progress_step = _progress_interval(total)

    logger.info(
        "Auto-label job %s: %d images, %d models, project=%s dataset=%s",
        job_id,
        total,
        num_models,
        project_id,
        dataset_id,
    )

    await update_job(
        job_id,
        progress=5,
        progress_message=f"Starting — {total} image(s), {num_models} model(s)…",
        processed_items=0,
        project_id=project_id,
    )

    # Lazy image paths — download each image once when first needed (no bulk pre-download).
    image_paths: dict[str, object] = {}
    prep_failures: dict[str, str] = {}
    model_failures: dict[str, str] = {}
    file_by_id: dict[str, dict] = {str(f["id"]): f for f in file_list}

    per_image_dets: dict[str, list[DetectionBox]] = defaultdict(list)
    per_image_models: dict[str, dict[str, int]] = defaultdict(dict)

    loaded_models: list[tuple[str, object]] = []

    def _prep_progress(step_index: int) -> int:
        if num_models <= 0:
            return 35
        return int(10 + (step_index / num_models) * 25)

    def _inference_progress(step_index: int, step_total: int, base: int = 35) -> int:
        if step_total <= 0:
            return base
        return int(base + (step_index / step_total) * 55)

    async def run_with_heartbeat(
        func,
        *args,
        progress: int,
        message: str,
    ):
        task = asyncio.create_task(asyncio.to_thread(func, *args))
        elapsed = 0
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=60)
            if done:
                break
            elapsed += 60
            heartbeat_progress = min(progress + max(1, elapsed // 60), 84)
            await update_job(
                job_id,
                progress=heartbeat_progress,
                progress_message=f"{message} ({elapsed}s)",
                processed_items=done_units,
                project_id=project_id,
            )
        return await task

    async def ensure_image(file_id: str) -> bool:
        if file_id in image_paths:
            return True
        if file_id in prep_failures:
            return False
        row = file_by_id.get(file_id)
        if not row:
            prep_failures[file_id] = "Image record missing"
            return False
        if not _is_image_row(row):
            prep_failures[file_id] = "Not an image file"
            return False
        try:
            image_paths[file_id] = await asyncio.to_thread(
                download_image_row, row, file_id
            )
            return True
        except Exception as exc:
            logger.warning("Image download failed %s: %s", file_id, exc)
            prep_failures[file_id] = str(exc)
            return False

    ready_ids = [str(f["id"]) for f in file_list if str(f["id"]) not in prep_failures]
    work_units = max(len(ready_ids) * num_models, 1)
    done_units = 0

    # --- Run each model across all images (one model in RAM at a time) ---
    for mi, model_id in enumerate(model_ids):
        logger.info("Job %s: model %d/%d id=%s — downloading from HF", job_id, mi + 1, num_models, model_id)
        await update_job(
            job_id,
            progress=_prep_progress(mi),
            progress_message=f"Model {mi + 1}/{num_models}: downloading weights from Hugging Face…",
            processed_items=done_units,
            project_id=project_id,
        )

        try:
            model_path = await run_with_heartbeat(
                download_model,
                model_id,
                project_id,
                progress=_prep_progress(mi),
                message=f"Model {mi + 1}/{num_models}: downloading weights from Hugging Face",
            )
        except Exception as exc:
            logger.exception("Model download failed %s", model_id)
            model_failures[model_id] = f"download failed: {exc}"
            continue

        logger.info("Job %s: model %s file ready at %s", job_id, model_id, model_path)
        await update_job(
            job_id,
            progress=_prep_progress(mi) + 5,
            progress_message=(
                f"Model {mi + 1}/{num_models}: loading YOLO into memory "
                f"(first time can take 1–3 min on CPU)…"
            ),
            processed_items=done_units,
            project_id=project_id,
        )

        try:
            await run_with_heartbeat(
                prewarm_yolo,
                model_path,
                progress=_prep_progress(mi) + 5,
                message=f"Model {mi + 1}/{num_models}: loading YOLO into memory",
            )
        except Exception as exc:
            logger.exception("YOLO load failed for model %s", model_id)
            await asyncio.to_thread(unload_model, model_path)
            model_failures[model_id] = f"load failed: {exc}"
            continue

        loaded_models.append((model_id, model_path))

        logger.info("Job %s: model %s loaded, starting inference", job_id, model_id)
        await update_job(
            job_id,
            progress=_prep_progress(mi + 1),
            progress_message=f"Model {mi + 1}/{num_models}: labeling image 1/{total}…",
            processed_items=done_units,
            project_id=project_id,
        )

    if not loaded_models:
        samples = [f"{mid}: {err}" for mid, err in list(model_failures.items())[:3]]
        hint = "; ".join(samples) if samples else "unknown model error"
        raise ValueError(f"No models could be loaded. Examples: {hint}")

    work_units = max(len(ready_ids) * len(loaded_models), 1)

    try:
        for mi, (model_id, model_path) in enumerate(loaded_models):
            for idx, file_row in enumerate(file_list):
                file_id = str(file_row["id"])
                if file_id in prep_failures:
                    continue

                if not await ensure_image(file_id):
                    continue

                if idx % progress_step == 0 or idx == total - 1:
                    pct = _inference_progress(done_units, work_units)
                    await update_job(
                        job_id,
                        progress=pct,
                        progress_message=(
                            f"Model {mi + 1}/{len(loaded_models)} · "
                            f"image {idx + 1}/{total}"
                        ),
                        processed_items=done_units,
                        project_id=project_id,
                    )

                try:
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
                except Exception as exc:
                    logger.warning(
                        "Inference failed job=%s model=%s image=%s: %s",
                        job_id,
                        model_id,
                        file_id,
                        exc,
                    )
                    if file_id not in prep_failures:
                        prep_failures[file_id] = f"Inference error: {exc}"

                done_units += 1
    finally:
        for _, model_path in loaded_models:
            await asyncio.to_thread(unload_model, model_path)
        gc.collect()

    # --- Merge detections and save to Firestore ---
    labeled = 0
    failed = len(prep_failures)
    all_results: list[dict] = [
        {"file_id": fid, "error": err} for fid, err in prep_failures.items()
    ]

    logger.info("Job %s: saving annotations for %d images", job_id, total - failed)
    await update_job(
        job_id,
        progress=90,
        progress_message=f"Preparing labels for {total - failed} image(s)...",
        processed_items=done_units,
        project_id=project_id,
    )

    batched_results: list[dict] = []
    for file_row in file_list:
        file_id = str(file_row["id"])
        if file_id in prep_failures:
            continue

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
                queue_type, reason = classify_queue(
                    objects,
                    confidence=config.confidence,
                    low_label_threshold=low_threshold,
                    class_id_known=class_known,
                    per_model=per_model if num_models > 1 else None,
                )
                batched_results.append(
                    {
                        "image_id": file_id,
                        "objects": objects,
                        "queue_type": queue_type,
                        "reason": reason,
                    }
                )

            labeled += 1
            all_results.append(
                {"file_id": file_id, "detections": len(objects), "per_model": per_model}
            )
        except Exception as exc:
            failed += 1
            all_results.append({"file_id": file_id, "error": str(exc)})

    if config.save_to_dataset and batched_results:
        await update_job(
            job_id,
            progress=96,
            progress_message=f"Saving {len(batched_results)} labels in bulk...",
            processed_items=done_units,
            project_id=project_id,
        )
        await asyncio.to_thread(save_auto_label_results, project_id, job_id, batched_results)

    await update_job(job_id, processed_items=done_units, project_id=project_id)
    logger.info("Job %s done: labeled=%d failed=%d", job_id, labeled, failed)

    if model_failures:
        logger.warning(
            "Job %s completed with %d model failure(s): %s",
            job_id,
            len(model_failures),
            "; ".join(f"{mid}: {err}" for mid, err in model_failures.items()),
        )

    if labeled == 0 and failed > 0:
        samples = [str(r.get("error", "unknown")) for r in all_results if r.get("error")][:3]
        hint = "; ".join(samples) if samples else "unknown error"
        raise ValueError(
            f"All {failed} image(s) failed. Check HF_TOKEN, HF_MODEL_REPO, HF_DATASET_REPO "
            f"on Railway and that classes match your YOLO model. Examples: {hint}"
        )

    return _compact_job_result(
        dataset_id=dataset_id,
        model_ids=[model_id for model_id, _ in loaded_models],
        total=total,
        labeled=labeled,
        failed=failed,
        all_results=all_results,
    )
