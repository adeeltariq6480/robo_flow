import asyncio
import gc
import logging
import os
import shutil
from collections import Counter, defaultdict
from pathlib import Path
from app.config import settings

from app.core.jobs import update_job
from app.models.schemas import DetectionBox, JobConfig
from app.services import hf_storage as file_storage
from app.services.detection_merge import merge_detections
from app.services.supabase_repo import (
    classify_queue,
    detections_to_objects,
    list_dataset_images,
    save_image_annotations,
    update_image_queue,
    update_image_storage_fields,
    update_model_status,
)
from app.services.storage import (
    build_class_name_map,
    download_image_row,
    download_model,
    get_project_class_map,
    resolve_hf_path_for_image,
)
from app.services.yolo_inference import prewarm_yolo, run_yolo_inference, unload_model

logger = logging.getLogger(__name__)

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
MODEL_DOWNLOAD_TIMEOUT_SECONDS = 600
MODEL_WARMUP_TIMEOUT_SECONDS = 600


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
    name = file_row.get("file_name", "").lower()
    return mime.startswith("image/") or any(name.endswith(ext) for ext in IMAGE_EXTS)


def _progress_interval(total: int) -> int:
    if total <= 50:
        return 1
    if total <= 200:
        return 5
    return 10


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


def _no_images_message() -> str:
    if settings.is_vercel:
        return (
            "No remote Hugging Face images found for this dataset. "
            "Run HF sync or repair HF paths. Local storage is disabled on Vercel."
        )
    if _remote_image_mode():
        return (
            "No remote Hugging Face images found for this dataset. "
            "Run HF sync or repair HF paths. Local image storage is disabled for auto-label."
        )
    return "No local images found. Run repair-local-paths or HF sync."


def _status_counts(file_list: list[dict], key: str) -> dict[str, int]:
    return dict(Counter(str(f.get(key) or "missing") for f in file_list))


def _vercel_remote_ready(file_row: dict) -> bool:
    return bool(file_row.get("hfPath")) and (
        file_row.get("hfSyncStatus") == "synced"
        or file_row.get("storageStatus") == "remote_ready"
    )


def _remote_image_mode() -> bool:
    return (
        settings.is_vercel
        or not settings.local_storage_enabled
        or not settings.auto_label_use_local_images
    )


def _list_remote_image_files(project_id: str, dataset_id: str) -> tuple[set[str], dict[str, str]]:
    prefix = f"datasets/{project_id}/{dataset_id}/images/"
    try:
        files = file_storage._api().list_repo_files(
            repo_id=settings.dataset_repo_id,
            repo_type=settings.dataset_repo_type,
        )
    except Exception as exc:
        logger.warning(
            "Auto-label could not list HF dataset files repo=%s repo_type=%s prefix=%s: %s",
            settings.dataset_repo_id,
            settings.dataset_repo_type,
            prefix,
            exc,
        )
        return set(), {}

    remote_files = {path for path in files if path.startswith(prefix)}
    by_name = {Path(path).name: path for path in remote_files}
    return remote_files, by_name


def _repair_remote_image_rows(project_id: str, dataset_id: str, file_list: list[dict]) -> int:
    remote_files, remote_by_name = _list_remote_image_files(project_id, dataset_id)
    if not remote_files:
        return 0

    repaired = 0
    for row in file_list:
        image_id = str(row.get("id") or "")
        filename = row.get("file_name") or row.get("file_name")
        existing_hf_path = row.get("hf_path") or row.get("hf_path")
        resolved_hf_path = None

        if existing_hf_path and existing_hf_path in remote_files:
            resolved_hf_path = existing_hf_path
        elif filename:
            expected_path = file_storage.dataset_image_path(project_id, dataset_id, filename)
            resolved_hf_path = expected_path if expected_path in remote_files else remote_by_name.get(filename)

        if not image_id or not resolved_hf_path:
            continue

        needs_update = (
            row.get("hfPath") != resolved_hf_path
            or row.get("hfSyncStatus") != "synced"
            or row.get("storageStatus") != "remote_ready"
        )
        row["hfPath"] = resolved_hf_path
        row["hfSyncStatus"] = "synced"
        row["storageStatus"] = "remote_ready"

        if not needs_update:
            continue

        try:
            update_image_storage_fields(
                project_id,
                image_id,
                {
                    "hfPath": resolved_hf_path,
                    "hfSyncStatus": "synced",
                    "storageStatus": "remote_ready",
                },
            )
            repaired += 1
        except Exception:
            logger.exception("Auto-label failed to repair HF path/status for image %s", image_id)

    logger.info(
        "Auto-label HF repo scan project=%s dataset=%s hf_files_found=%d matched_or_repaired=%d examples=%s",
        project_id,
        dataset_id,
        len(remote_files),
        repaired,
        list(remote_files)[:5],
    )
    return repaired


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

    db_file_list = list_dataset_images(project_id, dataset_id)
    db_total = len(db_file_list)

    if db_total == 0:
        raise ValueError("Dataset has no files to label")

    remote_image_mode = _remote_image_mode()
    if remote_image_mode:
        repaired = _repair_remote_image_rows(project_id, dataset_id, db_file_list)
        for f in db_file_list:
            image_id = str(f.get("id"))
            hf_path = resolve_hf_path_for_image(f, image_id)
            if hf_path and not f.get("hfPath"):
                f["hfPath"] = hf_path
                f["hfSyncStatus"] = "synced"
                f["storageStatus"] = "remote_ready"
                repaired += 1
        if repaired:
            logger.info("Auto-label repaired %d missing HF path(s) before filtering", repaired)
        file_list = [f for f in db_file_list if _vercel_remote_ready(f)]
    else:
        file_list = db_file_list

    total = len(file_list)

    logger.info(
        "Auto-label deployment config: DEPLOY_TARGET=%s LOCAL_STORAGE_ENABLED=%s AUTO_LABEL_USE_LOCAL_IMAGES=%s",
        settings.deploy_target or "",
        settings.local_storage_enabled,
        settings.auto_label_use_local_images,
    )
    logger.info(
        "Auto-label DB image state: db_images_count=%d eligible_images=%d images_with_hf_path=%d hf_sync_status_counts=%s storage_status_counts=%s hf_path_examples=%s",
        db_total,
        total,
        sum(1 for f in db_file_list if f.get("hfPath")),
        _status_counts(db_file_list, "hfSyncStatus"),
        _status_counts(db_file_list, "storageStatus"),
        [f.get("hfPath") for f in db_file_list if f.get("hfPath")][:5],
    )

    if total == 0:
        raise ValueError(_no_images_message())

    # If we require local images and some images are still queued/not saved,
    # refuse to start auto-label so the client can finish uploads first.
    if settings.use_local_images_for_auto_label:
        any_not_ready = False
        for f in file_list:
            lp = f.get("localPath") or f.get("local_path")
            status = f.get("status") or f.get("storageStatus") or f.get("storage_status")
            if not lp or not os.path.exists(lp):
                # If image is queued (upload session not flushed) or local file missing, mark not ready
                if status in {"queued", "uploading", "processing", "pending"} or not lp:
                    any_not_ready = True
                    break
        if any_not_ready:
            raise ValueError("Dataset local files are not ready yet.")

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

    # Diagnostic counts: local vs HF availability
    local_found = 0
    hf_available = 0
    for f in file_list:
        lp = f.get("localPath") or f.get("local_path")
        if lp and os.path.exists(lp):
            local_found += 1
        if f.get("hfPath"):
            hf_available += 1
    local_missing = total - local_found
    logger.info(
        "Auto-label sources: total_db=%d local_found=%d local_missing=%d hf_available=%d",
        total,
        local_found,
        local_missing,
        hf_available,
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

    def _prep_progress(step_index: int) -> int:
        if num_models <= 0:
            return 35
        return int(10 + (step_index / num_models) * 25)

    def _inference_progress(step_index: int, step_total: int, base: int = 35) -> int:
        if step_total <= 0:
            return base
        return int(base + (step_index / step_total) * 55)

    async def _run_with_heartbeat(label: str, coro, *, start_progress: int, end_progress: int):
        task = asyncio.create_task(coro)
        pulse = start_progress
        while not task.done():
            await update_job(
                job_id,
                progress=min(pulse, end_progress),
                progress_message=label,
                processed_items=done_units,
                project_id=project_id,
            )
            pulse = min(pulse + 1, end_progress)
            await asyncio.sleep(20)
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
            logger.warning("Image preparation failed %s: %s", file_id, exc)
            if row.get("hfPath") and ("404" in str(exc) or "not found" in str(exc).lower()):
                update_image_storage_fields(
                    project_id,
                    file_id,
                    {
                        "status": "missing_remote",
                        "storage_status": "missing_remote",
                        "hf_sync_status": "missing_remote",
                        "last_error": str(exc),
                    },
                )
            prep_failures[file_id] = str(exc)
            return False

    ready_ids = [str(f["id"]) for f in file_list if str(f["id"]) not in prep_failures]
    work_units = max(len(ready_ids) * num_models, 1)
    done_units = 0
    model_phase_progress = 10

    # --- Run each model end-to-end before moving to the next one ---
    for mi, model_id in enumerate(model_ids):
        phase_start = max(model_phase_progress, 10)
        download_end = min(phase_start + 5, 35)
        load_end = min(phase_start + 25, 60)
        inference_start = max(load_end, 35)
        inference_end = min(inference_start + 20, 85)

        logger.info("Job %s: model %d/%d id=%s — using local model path if available", job_id, mi + 1, num_models, model_id)
        await update_job(
            job_id,
            progress=phase_start,
            progress_message=f"Model {mi + 1}/{num_models}: downloading weights from Hugging Face…",
            processed_items=done_units,
            project_id=project_id,
        )

        try:
            model_path = await asyncio.wait_for(
                _run_with_heartbeat(
                    f"Model {mi + 1}/{num_models}: downloading weights from Hugging Face…",
                    asyncio.to_thread(download_model, model_id, project_id),
                    start_progress=phase_start,
                    end_progress=download_end,
                ),
                timeout=MODEL_DOWNLOAD_TIMEOUT_SECONDS,
            )
        except FileNotFoundError as exc:
            logger.warning("model skipped %s: %s", model_id, exc)
            model_failures[model_id] = str(exc)
            logger.info("continuing with next model")
            continue
        except Exception as exc:
            logger.exception("Model download failed %s", model_id)
            if isinstance(exc, TimeoutError):
                model_failures[model_id] = (
                    f"download timed out after {MODEL_DOWNLOAD_TIMEOUT_SECONDS}s"
                )
            else:
                model_failures[model_id] = f"download failed: {exc}"
            logger.info("continuing with next model")
            continue

        logger.info("Job %s: model %s file ready at %s", job_id, model_id, model_path)
        await update_job(
            job_id,
            progress=download_end,
            progress_message=(
                f"Model {mi + 1}/{num_models}: loading YOLO into memory "
                f"(first time can take 1–3 min on CPU)…"
            ),
            processed_items=done_units,
            project_id=project_id,
        )

        try:
            await asyncio.wait_for(
                _run_with_heartbeat(
                    f"Model {mi + 1}/{num_models}: loading YOLO into memory (CPU warmup)…",
                    asyncio.to_thread(prewarm_yolo, model_path),
                    start_progress=download_end,
                    end_progress=load_end,
                ),
                timeout=MODEL_WARMUP_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            logger.exception("YOLO load failed for model %s", model_id)
            await asyncio.to_thread(unload_model, model_path)
            try:
                # Mark model as incompatible runtime when the loader reports that
                msg = str(exc).lower()
                if "unsupported/unknown old yolov5" in msg or "old yolov5" in msg or "autoshape" in msg or "can't get attribute" in msg or "mp" in msg:
                    try:
                        await asyncio.to_thread(update_model_status, project_id, model_id, {"modelStatus": "incompatible_yolov5_runtime"})
                        logger.info("Marked model %s as incompatible_yolov5_runtime", model_id)
                    except Exception:
                        logger.exception("Failed to update model status for %s", model_id)
            except Exception:
                logger.debug("Error inspecting YOLO load exception")
            if isinstance(exc, TimeoutError):
                model_failures[model_id] = (
                    f"load timed out after {MODEL_WARMUP_TIMEOUT_SECONDS}s"
                )
            else:
                model_failures[model_id] = f"load failed: {exc}"
            logger.warning("model skipped %s", model_id)
            logger.info("continuing with next model")
            continue

        logger.info("Job %s: model %s loaded, starting inference", job_id, model_id)
        await update_job(
            job_id,
            progress=inference_start,
            progress_message=f"Model {mi + 1}/{num_models}: labeling image 1/{total}…",
            processed_items=done_units,
            project_id=project_id,
        )
        model_phase_progress = inference_start
        low_memory_mode = os.getenv("LOW_MEMORY_MODE", "false").lower() == "true"
        unload_every = 20 if low_memory_mode else None

        try:
            for idx, file_row in enumerate(file_list):
                file_id = str(file_row["id"])
                if file_id in prep_failures:
                    continue
                if idx % progress_step == 0 or idx == total - 1:
                    pct = _inference_progress(done_units, work_units, inference_start)
                    await update_job(
                        job_id,
                        progress=pct,
                        progress_message=(
                            f"Model {mi + 1}/{num_models} · image {idx + 1}/{total}"
                        ),
                        processed_items=done_units,
                        project_id=project_id,
                    )

                try:
                    if not await ensure_image(file_id):
                        continue
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
                if unload_every is not None and done_units > 0 and done_units % unload_every == 0:
                    logger.info("LOW_MEMORY_MODE active: unloading model after %d images", done_units)
                    await asyncio.to_thread(unload_model, model_path)
                    gc.collect()
                    try:
                        import torch as _torch
                        if _torch.cuda.is_available():
                            _torch.cuda.empty_cache()
                    except Exception:
                        pass
                    model_path = await asyncio.to_thread(download_model, model_id, project_id)
                    logger.info("LOW_MEMORY_MODE: reloaded model after unload for continued inference")

        finally:
            await asyncio.to_thread(unload_model, model_path)
            gc.collect()

        model_phase_progress = max(model_phase_progress, inference_end)
        await update_job(
            job_id,
            progress=model_phase_progress,
            progress_message=f"Model {mi + 1}/{num_models}: complete",
            processed_items=done_units,
            project_id=project_id,
        )

    if prep_failures:
        logger.info(
            "Auto-label first HF/image preparation errors: %s",
            [f"{fid}: {err}" for fid, err in list(prep_failures.items())[:5]],
        )

    if len(prep_failures) == total:
        raise ValueError(_no_images_message())

    loaded_model_ids = [mid for mid in model_ids if mid not in model_failures]

    if not loaded_model_ids:
        samples = [f"{mid}: {err}" for mid, err in list(model_failures.items())[:3]]
        hint = "; ".join(samples) if samples else "unknown model error"
        raise ValueError(f"No models could be loaded. Examples: {hint}")

    # --- Merge detections and save to Firestore ---
    labeled = 0
    failed = len(prep_failures)
    all_results: list[dict] = [
        {"file_id": fid, "error": err} for fid, err in prep_failures.items()
    ]

    logger.info("Job %s: saving annotations for %d images", job_id, total - failed)

    for idx, file_row in enumerate(file_list):
        file_id = str(file_row["id"])
        if file_id in prep_failures:
            continue

        if idx % progress_step == 0 or idx == total - 1:
            await update_job(
                job_id,
                progress=int(85 + (idx / max(total, 1)) * 14),
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

            # Save YOLO-format label file locally for this image
            try:
                from app.services.export_builder import _class_index_map

                class_index = _class_index_map(project_id)
                stem = (file_row.get("file_name") or str(file_row.get("id"))).rsplit(".", 1)[0]
                labels_dir = settings.dataset_files_dir / str(project_id) / str(dataset_id) / "labels"
                labels_dir.mkdir(parents=True, exist_ok=True)
                lines = []
                for o in objects:
                    idx = class_index.get(o.get("className"), 0)
                    xc = (o["xMin"] + o["xMax"]) / 2
                    yc = (o["yMin"] + o["yMax"]) / 2
                    w = (o["xMax"] - o["xMin"])
                    h = (o["yMax"] - o["yMin"])
                    lines.append(f"{idx} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")
                (labels_dir / f"{stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""))
            except Exception:
                logger.exception("Failed to write label file for image %s", file_id)

            labeled += 1
            all_results.append(
                {"file_id": file_id, "detections": len(objects), "per_model": per_model}
            )
        except Exception as exc:
            failed += 1
            all_results.append({"file_id": file_id, "error": str(exc)})

    await update_job(job_id, processed_items=total, project_id=project_id)
    logger.info("Job %s done: labeled=%d failed=%d", job_id, labeled, failed)

    if settings.auto_commit_after_labels:
        labels_dir = settings.dataset_files_dir / str(project_id) / str(dataset_id) / "labels"
        if labels_dir.exists():
            try:
                batch_size = int(os.getenv("LABEL_UPLOAD_BATCH_SIZE", os.getenv("UPLOAD_BATCH_SIZE", "50")))
                label_commit = await asyncio.to_thread(
                    file_storage.upload_labels_from_folder_batched,
                    project_id,
                    dataset_id,
                    str(labels_dir),
                    batch_size=batch_size,
                )
                logger.info(
                    "Auto-label labels uploaded to HF project=%s dataset=%s count=%s batches=%s",
                    project_id,
                    dataset_id,
                    label_commit.get("count"),
                    label_commit.get("batches"),
                )
            except Exception as exc:
                logger.exception("Failed to upload auto-label label files to HF for %s/%s: %s", project_id, dataset_id, exc)

    for path in image_paths.values():
        try:
            image_path = Path(path)
            if _remote_image_mode() or str(image_path).startswith(str(settings.storage_base_path)):
                if image_path.exists():
                    image_path.unlink()
                parent = image_path.parent
                if parent.name.startswith("hf-temp-"):
                    shutil.rmtree(parent, ignore_errors=True)
        except Exception:
            logger.debug("Failed to delete temporary auto-label image %s", path)

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
        if _remote_image_mode():
            raise ValueError(
                f"All {failed} image(s) failed. Check HF_TOKEN, HF_MODEL_REPO, HF_DATASET_REPO "
                f"and run repair HF paths if needed. Examples: {hint}"
            )
        raise ValueError(
            f"All {failed} image(s) failed. Check HF_TOKEN, HF_MODEL_REPO, HF_DATASET_REPO "
            f"on Railway/VPS and that classes match your YOLO model. Examples: {hint}"
        )

    return _compact_job_result(
        dataset_id=dataset_id,
        model_ids=loaded_model_ids,
        total=total,
        labeled=labeled,
        failed=failed,
        all_results=all_results,
    )
