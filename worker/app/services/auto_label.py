import asyncio
import gc
import logging
import os
import shutil
from collections import Counter
from pathlib import Path
from app.config import settings

from app.core.jobs import JobCancelled, is_job_cancelled, raise_if_job_cancelled, update_job
from app.models.schemas import DetectionBox, JobConfig
from app.services import hf_storage as file_storage
from app.services.detection_merge import merge_detections
from app.services.label_classes import (
    build_model_class_name_map,
    class_maps_for_project,
    filter_saveable_detections,
    is_excluded_detection_class,
    yolo_index_for_object,
)
from app.services.supabase_repo import (
    attach_annotation_fields_to_images,
    classify_queue,
    detections_to_objects,
    get_model,
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
    infer_dataset_image_local_path,
    resolve_hf_path_for_image,
    sync_local_images_to_hf,
)
from app.services.model_errors import IncompatibleModelError
from app.services.yolo_inference import (
    InferenceProfile,
    MemoryLimitExceeded,
    clear_inference_profile,
    clear_keep_all_models,
    get_process_memory_mb,
    load_yolo_model,
    release_all_models,
    run_yolo_inference,
    set_inference_profile,
    set_keep_all_models,
    unload_model,
)

logger = logging.getLogger(__name__)

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
MODEL_DOWNLOAD_TIMEOUT_SECONDS = 600
MODEL_WARMUP_TIMEOUT_SECONDS = 900
IMAGE_PREP_TIMEOUT_SECONDS = int(os.getenv("AUTO_LABEL_IMAGE_PREP_TIMEOUT_SECONDS", "90"))
PERSIST_TIMEOUT_SECONDS = int(os.getenv("AUTO_LABEL_PERSIST_TIMEOUT_SECONDS", "60"))


async def _safe_update_model_status(project_id: str, model_id: str, status: str) -> None:
    try:
        await asyncio.to_thread(
            update_model_status,
            project_id,
            model_id,
            {"modelStatus": status},
        )
    except Exception:
        logger.debug("Could not persist model status for %s", model_id, exc_info=True)


def _model_display_name(project_id: str, model_id: str) -> str:
    row = get_model(project_id, model_id)
    if not row:
        return model_id[:8]
    return str(row.get("modelName") or row.get("model_name") or model_id[:8])


def _format_model_failures(project_id: str, model_failures: dict[str, str]) -> str:
    lines = [
        f"{_model_display_name(project_id, mid)}: {err}"
        for mid, err in model_failures.items()
    ]
    return "; ".join(lines[:5])


def _model_failure_message(exc: Exception) -> str:
    if isinstance(exc, IncompatibleModelError):
        return str(exc)
    if isinstance(exc, FileNotFoundError):
        return str(exc)
    if isinstance(exc, TimeoutError):
        return "Model load timed out — try fewer models or a smaller checkpoint."
    if isinstance(exc, MemoryLimitExceeded):
        return f"Out of memory: {exc}"
    text = str(exc).lower()
    if "can't get attribute" in text or "mp" in text or "yolov5" in text:
        return (
            "Model incompatible with worker runtime. "
            "Re-export as YOLOv8/v11 (.pt) or ONNX, then re-upload."
        )
    return str(exc)


def _get_first(row: dict, *keys: str):
    """Return first non-empty value from snake_case/camelCase aliases."""
    for key in keys:
        value = row.get(key)
        if value is not None and value != "":
            return value
    return None


def _image_id(row: dict) -> str:
    return str(_get_first(row, "id") or "")


def _image_file_name(row: dict) -> str:
    return str(_get_first(row, "fileName", "file_name", "filename", "name") or "")


def _image_hf_path(row: dict) -> str:
    return str(_get_first(row, "hfPath", "hf_path") or "")


def _image_hf_sync_status(row: dict) -> str:
    return str(_get_first(row, "hfSyncStatus", "hf_sync_status") or "")


def _image_storage_status(row: dict) -> str:
    return str(_get_first(row, "storageStatus", "storage_status") or "")


def _image_local_path(row: dict) -> str:
    return str(_get_first(row, "localPath", "local_path") or "")


def _normalise_image_row(row: dict) -> dict:
    """Keep both aliases in memory because repo rows may be camelCase while DB is snake_case."""
    filename = _image_file_name(row)
    hf_path = _image_hf_path(row)
    hf_sync_status = _image_hf_sync_status(row)
    storage_status = _image_storage_status(row)
    local_path = _image_local_path(row)

    if filename:
        row["fileName"] = filename
        row["file_name"] = filename
    if hf_path:
        row["hfPath"] = hf_path
        row["hf_path"] = hf_path
    if hf_sync_status:
        row["hfSyncStatus"] = hf_sync_status
        row["hf_sync_status"] = hf_sync_status
    if storage_status:
        row["storageStatus"] = storage_status
        row["storage_status"] = storage_status
    if local_path:
        row["localPath"] = local_path
        row["local_path"] = local_path

    return row


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
    mime = (
        file_row.get("mimeType")
        or file_row.get("mime_type")
        or ""
    )

    name = (
        file_row.get("fileName")
        or file_row.get("file_name")
        or file_row.get("filename")
        or file_row.get("name")
        or ""
    ).lower()

    return mime.startswith("image/") or any(
        name.endswith(ext) for ext in IMAGE_EXTS
    )

def _progress_interval(total: int) -> int:
    if total <= 20:
        return 1
    if total <= 100:
        return 2
    if total <= 500:
        return 5
    return 10


def _should_emit_detail(idx: int, step: int, total: int) -> bool:
    """Whether to push granular progress for this image index."""
    return idx < 5 or idx % step == 0 or idx == total - 1


def _should_emit_model_substep(idx: int, step: int, total: int, num_models: int) -> bool:
    """Per-model inference updates — always for small batches or step boundaries."""
    return num_models <= 4 or _should_emit_detail(idx, step, total)


def _multi_model_image_progress(
    idx: int,
    total: int,
    model_idx: int,
    model_count: int,
    *,
    floor: int = 25,
    ceiling: int = 95,
) -> int:
    """Map image index + model index to overall job progress (any N models)."""
    work_units = max(total, 1) * max(model_count, 1)
    done = idx * model_count + model_idx + 1
    ratio = min(max(done / work_units, 0.0), 1.0)
    return min(ceiling, max(floor, int(floor + ratio * (ceiling - floor))))


async def _persist_labels_async(**kwargs) -> int:
    return await asyncio.wait_for(
        asyncio.to_thread(_persist_image_labels, **kwargs),
        timeout=PERSIST_TIMEOUT_SECONDS,
    )


def _compact_job_result(
    *,
    project_id: str,
    dataset_id: str,
    model_ids: list[str],
    selected_model_ids: list[str] | None = None,
    total: int,
    labeled: int,
    failed: int,
    all_results: list[dict],
    model_failures: dict[str, str] | None = None,
    db_total: int | None = None,
    skipped_not_eligible: int = 0,
    skipped_not_remote_ready: int = 0,
    skipped_already_labeled: int = 0,
    relabel_all: bool = False,
) -> dict:
    error_rows = [r for r in all_results if r.get("error")]
    selected = selected_model_ids or model_ids
    loaded_count = len(model_ids)
    selected_count = len(selected)
    failed_count = len(model_failures or {})
    result = {
        "job_type": "auto_label",
        "dataset_id": dataset_id,
        "model_id": model_ids[0] if model_ids else None,
        "model_ids": model_ids,
        "selected_model_ids": selected,
        "models_selected": selected_count,
        "models_loaded": loaded_count,
        "models_failed": failed_count,
        "models_used": loaded_count,
        "total_files": total,
        "labeled": labeled,
        "failed": failed,
        "files": error_rows[:25],
        "files_truncated": len(error_rows) > 25,
    }
    if db_total is not None:
        result["db_total"] = db_total
    if skipped_not_eligible:
        result["skipped_not_eligible"] = skipped_not_eligible
    if skipped_not_remote_ready:
        result["skipped_not_remote_ready"] = skipped_not_remote_ready
    if skipped_already_labeled:
        result["skipped_already_labeled"] = skipped_already_labeled
    if relabel_all:
        result["relabel_all"] = True
    if model_failures:
        result["model_failures"] = [
            {
                "model_id": mid,
                "model_name": _model_display_name(project_id, mid),
                "error": err,
            }
            for mid, err in list(model_failures.items())[:10]
        ]
    return result


def _persist_image_labels(
    *,
    project_id: str,
    dataset_id: str,
    job_id: str,
    file_row: dict,
    file_id: str,
    combined: list[DetectionBox],
    per_model: dict[str, int],
    config: JobConfig,
    low_threshold: int,
    num_models: int,
) -> int:
    """Merge detections from all models, save annotations + YOLO label file."""
    combined = filter_saveable_detections(combined)
    merged = merge_detections(combined, iou_threshold=config.iou)
    merged = merge_detections(
        merged,
        iou_threshold=config.iou,
        class_agnostic=True,
    )
    merged = filter_saveable_detections(merged)
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

    try:
        by_name, by_id = class_maps_for_project(project_id)
        stem = (_image_file_name(file_row) or str(file_row.get("id"))).rsplit(".", 1)[0]
        labels_dir = settings.dataset_files_dir / str(project_id) / str(dataset_id) / "labels"
        labels_dir.mkdir(parents=True, exist_ok=True)
        lines = []
        for o in objects:
            cls_idx = yolo_index_for_object(o, by_name=by_name, by_id=by_id)
            if cls_idx is None:
                continue
            xc = (o["xMin"] + o["xMax"]) / 2
            yc = (o["yMin"] + o["yMax"]) / 2
            w = (o["xMax"] - o["xMin"])
            h = (o["yMax"] - o["yMin"])
            lines.append(f"{cls_idx} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")
        (labels_dir / f"{stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""))
    except Exception:
        logger.exception("Failed to write label file for image %s", file_id)

    return len(objects)


def _config_for_model(config: JobConfig, project_id: str, model_id: str) -> JobConfig:
    model_map = build_model_class_name_map(project_id, model_id, config.class_name_map)
    return config.model_copy(update={"class_name_map": model_map})


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
    aliases = {
        "hfSyncStatus": ("hfSyncStatus", "hf_sync_status"),
        "hf_sync_status": ("hfSyncStatus", "hf_sync_status"),
        "storageStatus": ("storageStatus", "storage_status"),
        "storage_status": ("storageStatus", "storage_status"),
        "hfPath": ("hfPath", "hf_path"),
        "hf_path": ("hfPath", "hf_path"),
    }
    keys = aliases.get(key, (key,))
    return dict(Counter(str(_get_first(_normalise_image_row(f), *keys) or "missing") for f in file_list))


def _vercel_remote_ready(file_row: dict) -> bool:
    hf_path = file_row.get("hfPath") or file_row.get("hf_path")
    hf_status = file_row.get("hfSyncStatus") or file_row.get("hf_sync_status")
    storage_status = file_row.get("storageStatus") or file_row.get("storage_status")

    return bool(hf_path) and (
        hf_status == "synced"
        or storage_status == "remote_ready"
    )


_SKIP_IMAGE_STATUS = frozenset({
    "reviewed",
    "approved",
    "rejected",
})
_SKIP_REVIEW_STATUS = frozenset({"approved", "rejected", "reviewed"})
_SKIP_ANNOTATION_STATUS = frozenset({"completed"})
_GOOD_QUEUE_TYPES = frozenset({"good"})


def _norm_status(value: object) -> str:
    if value is None or value == "":
        return ""
    return str(value).strip().lower().replace("-", "_")


def _truthy_flag(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "on"}
    return bool(value)


def _needs_auto_label(row: dict) -> bool:
    """Return True when an image should be included in a default auto-label run."""
    row = _normalise_image_row(row)

    review_status = _norm_status(_get_first(row, "reviewStatus", "review_status"))
    if review_status in _SKIP_REVIEW_STATUS:
        return False

    image_status = _norm_status(_get_first(row, "status"))
    if image_status in _SKIP_IMAGE_STATUS:
        return False

    annotation_status = _norm_status(
        _get_first(row, "annotationStatus", "annotation_status")
    )
    if annotation_status in _SKIP_ANNOTATION_STATUS:
        return False

    queue_type = _norm_status(_get_first(row, "queueType", "queue_type"))
    if queue_type in _GOOD_QUEUE_TYPES and _get_first(row, "autoLabeledAt", "auto_labeled_at"):
        return False

    object_count = int(
        _get_first(row, "annotationObjectCount", "annotation_object_count") or 0
    )
    # Empty auto-label (tilted/missed detections) — include again by default.
    if _get_first(row, "autoLabeledAt", "auto_labeled_at") and object_count == 0:
        return True
    if queue_type in {"no_label", "low_label", "low_confidence", "class_missing", "conflict"}:
        return True

    if _get_first(row, "autoLabeledAt", "auto_labeled_at"):
        return False

    return True


def resolve_dataset_label_plan(
    project_id: str,
    dataset_id: str,
    db_file_list: list[dict],
    *,
    relabel_all: bool,
) -> dict:
    """Compute which images will be labeled for default vs relabel mode."""
    db_total = len(db_file_list)
    eligible_list, skipped_not_eligible, _remote_by_name = _build_label_file_list(
        project_id, dataset_id, db_file_list
    )
    remote_image_mode = _remote_image_mode()
    if remote_image_mode:
        ready_list = [f for f in eligible_list if _vercel_remote_ready(f)]
    else:
        ready_list = list(eligible_list)

    skipped_not_remote_ready = (
        len(eligible_list) - len(ready_list) if remote_image_mode else 0
    )
    unlabeled_list = [f for f in ready_list if _needs_auto_label(f)]
    already_labeled_list = [f for f in ready_list if not _needs_auto_label(f)]

    if relabel_all:
        file_list = already_labeled_list
        skipped_already_labeled = 0
    else:
        file_list = unlabeled_list
        skipped_already_labeled = len(already_labeled_list)

    return {
        "db_total": db_total,
        "eligible": len(eligible_list),
        "ready": len(ready_list),
        "unlabeled": len(unlabeled_list),
        "already_labeled": len(already_labeled_list),
        "skipped_not_eligible": skipped_not_eligible,
        "skipped_not_remote_ready": skipped_not_remote_ready,
        "skipped_already_labeled": skipped_already_labeled,
        "file_list": file_list,
        "total": len(file_list),
    }


def get_dataset_label_stats(project_id: str, dataset_id: str) -> dict:
    """Preview counts for auto-label UI (unlabeled vs already labeled)."""
    db_file_list = [
        _normalise_image_row(row)
        for row in list_dataset_images(project_id, dataset_id)
    ]
    attach_annotation_fields_to_images(project_id, db_file_list)
    default_plan = resolve_dataset_label_plan(
        project_id, dataset_id, db_file_list, relabel_all=False
    )
    relabel_plan = resolve_dataset_label_plan(
        project_id, dataset_id, db_file_list, relabel_all=True
    )
    return {
        "total": default_plan["db_total"],
        "eligible": default_plan["eligible"],
        "ready": default_plan["ready"],
        "unlabeled": default_plan["unlabeled"],
        "already_labeled": relabel_plan["already_labeled"],
        "skipped_not_eligible": default_plan["skipped_not_eligible"],
        "skipped_not_remote_ready": default_plan["skipped_not_remote_ready"],
    }


def _relabel_all_enabled(data: dict, config: JobConfig) -> bool:
    payload = data.get("input_payload") or {}
    if _truthy_flag(payload.get("relabel_all")):
        return True

    raw_config = data.get("config")
    if isinstance(raw_config, dict) and _truthy_flag(raw_config.get("relabel_all")):
        return True

    if _truthy_flag(getattr(config, "relabel_all", False)):
        return True

    return False


def _local_image_exists(file_row: dict) -> bool:
    row = _normalise_image_row(file_row)
    local_path = _image_local_path(row)
    if local_path and os.path.exists(local_path):
        return True
    inferred = infer_dataset_image_local_path(row)
    return inferred is not None


def _image_eligible_for_label(
    file_row: dict,
    *,
    remote_by_name: dict[str, str] | None = None,
) -> bool:
    """Include images we can realistically fetch (local disk, HF path, or HF filename match)."""
    row = _normalise_image_row(file_row)
    if not _is_image_row(row):
        return False
    if _local_image_exists(row):
        return True
    if _image_hf_path(row):
        return True
    filename = _image_file_name(row)
    if filename and remote_by_name and filename in remote_by_name:
        return True
    return False


def _build_label_file_list(
    project_id: str,
    dataset_id: str,
    db_file_list: list[dict],
) -> tuple[list[dict], int, dict[str, str]]:
    """Repair HF metadata, then return every image that can be labeled."""
    remote_image_mode = _remote_image_mode()
    remote_by_name: dict[str, str] = {}

    if remote_image_mode:
        _repair_remote_image_rows(project_id, dataset_id, db_file_list)
        _, remote_by_name = _list_remote_image_files(project_id, dataset_id)
        for row in db_file_list:
            row = _normalise_image_row(row)
            image_id = _image_id(row)
            hf_path = resolve_hf_path_for_image(row, image_id)
            if hf_path and not _image_hf_path(row):
                row["hfPath"] = hf_path
                row["hf_path"] = hf_path
                row["hfSyncStatus"] = "synced"
                row["hf_sync_status"] = "synced"
                row["storageStatus"] = "remote_ready"
                row["storage_status"] = "remote_ready"
    elif settings.local_storage_enabled:
        _, remote_by_name = _list_remote_image_files(project_id, dataset_id)

    eligible = [
        row
        for row in db_file_list
        if _image_eligible_for_label(row, remote_by_name=remote_by_name or None)
    ]

    # Attach resolved HF path from filename map when DB path is missing.
    for row in eligible:
        row = _normalise_image_row(row)
        if _image_hf_path(row):
            continue
        filename = _image_file_name(row)
        if filename and remote_by_name and filename in remote_by_name:
            resolved = remote_by_name[filename]
            row["hfPath"] = resolved
            row["hf_path"] = resolved
            row["hfSyncStatus"] = "synced"
            row["hf_sync_status"] = "synced"
            row["storageStatus"] = "remote_ready"
            row["storage_status"] = "remote_ready"

    skipped = len(db_file_list) - len(eligible)
    if skipped:
        logger.warning(
            "Auto-label skipping %d/%d images with no local file, HF path, or HF filename match",
            skipped,
            len(db_file_list),
        )
    return eligible, skipped, remote_by_name


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
        logger.warning(
            "Auto-label HF repo scan found 0 files for project=%s dataset=%s",
            project_id,
            dataset_id,
        )
        return 0

    repaired = 0
    for row in file_list:
        row = _normalise_image_row(row)

        image_id = _image_id(row)
        filename = _image_file_name(row)
        existing_hf_path = _image_hf_path(row)
        resolved_hf_path = None

        if existing_hf_path and existing_hf_path in remote_files:
            resolved_hf_path = existing_hf_path
        elif filename:
            expected_path = file_storage.dataset_image_path(project_id, dataset_id, filename)
            resolved_hf_path = (
                expected_path
                if expected_path in remote_files
                else remote_by_name.get(filename)
            )

        if not image_id or not resolved_hf_path:
            continue

        needs_update = (
            _image_hf_path(row) != resolved_hf_path
            or _image_hf_sync_status(row) != "synced"
            or _image_storage_status(row) != "remote_ready"
        )

        row["hfPath"] = resolved_hf_path
        row["hf_path"] = resolved_hf_path
        row["hfSyncStatus"] = "synced"
        row["hf_sync_status"] = "synced"
        row["storageStatus"] = "remote_ready"
        row["storage_status"] = "remote_ready"

        if not needs_update:
            continue

        try:
            update_image_storage_fields(
                project_id,
                image_id,
                {
                    "hf_path": resolved_hf_path,
                    "hf_sync_status": "synced",
                    "storage_status": "remote_ready",
                    "last_error": None,
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
    selected_model_ids = list(model_ids)
    dataset_id = str(data["dataset_id"])
    await raise_if_job_cancelled(job_id, project_id)

    try:
        from app.services.model_resolver import sync_project_models_from_hf

        repairs = await asyncio.to_thread(sync_project_models_from_hf, project_id)
        if repairs:
            logger.info(
                "Auto-label repaired %d model HF path(s) before start project=%s",
                len(repairs),
                project_id,
            )
    except Exception as exc:
        logger.warning("Model HF path sync skipped project=%s: %s", project_id, exc)

    class_id_map = get_project_class_map(project_id)
    config.class_name_map = build_class_name_map(project_id, config.class_name_map)

    db_file_list = [_normalise_image_row(row) for row in list_dataset_images(project_id, dataset_id)]
    attach_annotation_fields_to_images(project_id, db_file_list)
    db_total = len(db_file_list)

    logger.info(
        "AUTO_LABEL_DEBUG job_id=%s project_id=%s dataset_id=%s db_count=%d first_row=%s",
        job_id,
        project_id,
        dataset_id,
        db_total,
        db_file_list[0] if db_file_list else None,
    )

    if db_total == 0:
        raise ValueError("Dataset has no files to label")

    # Free RAM from any prior jobs before touching images or models.
    await asyncio.to_thread(release_all_models)
    gc.collect()

    sync_hf_before = os.getenv("AUTO_LABEL_SYNC_HF_BEFORE_START", "false").lower() == "true"
    if sync_hf_before:
        synced = await asyncio.to_thread(
            sync_local_images_to_hf, project_id, dataset_id, db_file_list
        )
        if synced:
            logger.info(
                "Auto-label uploaded %d local image(s) to HF before labeling project=%s dataset=%s",
                synced,
                project_id,
                dataset_id,
            )
            db_file_list = [
                _normalise_image_row(row)
                for row in list_dataset_images(project_id, dataset_id)
            ]
            attach_annotation_fields_to_images(project_id, db_file_list)
        gc.collect()

    relabel_all = _relabel_all_enabled(data, config)

    label_plan = resolve_dataset_label_plan(
        project_id,
        dataset_id,
        db_file_list,
        relabel_all=relabel_all,
    )
    file_list = label_plan["file_list"]
    skipped_not_eligible = label_plan["skipped_not_eligible"]
    skipped_not_remote_ready = label_plan["skipped_not_remote_ready"]
    skipped_already_labeled = label_plan["skipped_already_labeled"]
    total = label_plan["total"]
    remote_image_mode = _remote_image_mode()

    logger.info(
        "Auto-label filtering: db_total=%d eligible=%d skipped_not_eligible=%d skipped_not_remote_ready=%d skipped_already_labeled=%d final_total=%d relabel_all=%s unlabeled=%d already_labeled=%d",
        db_total,
        label_plan["eligible"],
        skipped_not_eligible,
        skipped_not_remote_ready,
        skipped_already_labeled,
        total,
        relabel_all,
        label_plan["unlabeled"],
        label_plan["already_labeled"],
    )

    logger.info(
        "Auto-label deployment config: DEPLOY_TARGET=%s LOCAL_STORAGE_ENABLED=%s AUTO_LABEL_USE_LOCAL_IMAGES=%s",
        settings.deploy_target or "",
        settings.local_storage_enabled,
        settings.auto_label_use_local_images,
    )
    logger.info(
        "Auto-label DB image state: db_images_count=%d eligible_images=%d skipped_not_eligible=%d images_with_hf_path=%d hf_sync_status_counts=%s storage_status_counts=%s hf_path_examples=%s",
        db_total,
        total,
        skipped_not_eligible,
        sum(1 for f in db_file_list if _image_hf_path(f)),
        _status_counts(db_file_list, "hfSyncStatus"),
        _status_counts(db_file_list, "storageStatus"),
        [_image_hf_path(f) for f in db_file_list if _image_hf_path(f)][:5],
    )

    if total == 0:
        if relabel_all:
            return _compact_job_result(
                project_id=project_id,
                dataset_id=dataset_id,
                model_ids=model_ids,
                selected_model_ids=selected_model_ids,
                total=0,
                labeled=0,
                failed=0,
                all_results=[],
                db_total=db_total,
                skipped_not_eligible=skipped_not_eligible,
                skipped_not_remote_ready=skipped_not_remote_ready,
                skipped_already_labeled=label_plan["already_labeled"],
                relabel_all=relabel_all,
            )
        if skipped_already_labeled > 0 and not relabel_all:
            return _compact_job_result(
                project_id=project_id,
                dataset_id=dataset_id,
                model_ids=model_ids,
                selected_model_ids=selected_model_ids,
                total=0,
                labeled=0,
                failed=0,
                all_results=[],
                db_total=db_total,
                skipped_not_eligible=skipped_not_eligible,
                skipped_not_remote_ready=skipped_not_remote_ready,
                skipped_already_labeled=skipped_already_labeled,
                relabel_all=relabel_all,
            )
        if (data.get("input_payload") or {}).get("resumed_from_job_id"):
            return _compact_job_result(
                project_id=project_id,
                dataset_id=dataset_id,
                model_ids=model_ids,
                selected_model_ids=selected_model_ids,
                total=0,
                labeled=0,
                failed=0,
                all_results=[],
            )
        raise ValueError(_no_images_message())

    # If we require local images and some images are still queued/not saved,
    # refuse to start auto-label so the client can finish uploads first.
    if settings.use_local_images_for_auto_label:
        any_not_ready = False
        for f in file_list:
            if not _local_image_exists(f):
                status = f.get("status") or _image_storage_status(f)
                if status in {"queued", "uploading", "processing", "pending"}:
                    any_not_ready = True
                    break
        if any_not_ready:
            raise ValueError("Dataset local files are not ready yet.")

    low_threshold = int(getattr(config, "low_label_threshold", 1) or 1)
    num_models = len(model_ids)
    progress_step = _progress_interval(total)

    if num_models == 1 and total <= settings.auto_label_quality_max_images:
        set_inference_profile(
            InferenceProfile(
                max_side=settings.auto_label_quality_inference_max,
                min_side=settings.auto_label_quality_inference_min,
                imgsz=settings.auto_label_quality_yolo_imgsz,
                prefer_quality=True,
            )
        )
        logger.info(
            "Quality inference: %dpx (fallback %dpx, imgsz=%d) for %d images with 1 model",
            settings.auto_label_quality_inference_max,
            settings.auto_label_quality_inference_min,
            settings.auto_label_quality_yolo_imgsz,
            total,
        )
    else:
        clear_inference_profile()

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
        if _local_image_exists(f):
            local_found += 1
        if _image_hf_path(f):
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
        total_items=total,
        project_id=project_id,
    )

    # Download one image at a time. Keeping many temp image paths/files around can
    # push small Railway containers into OOM when model runtimes are also loaded.
    prep_failures: dict[str, str] = {}
    model_failures: dict[str, str] = {}
    file_by_id: dict[str, dict] = {str(f["id"]): f for f in file_list}

    def _work_progress(done: int, total_work: int, *, floor: int = 5, ceiling: int = 99) -> int:
        if total_work <= 0:
            return floor
        ratio = min(max(done / total_work, 0.0), 1.0)
        return min(ceiling, max(floor, int(floor + ratio * (ceiling - floor))))

    async def _report_progress(
        *,
        idx: int,
        message: str,
        processed: int | None = None,
        model_idx: int | None = None,
        model_count: int | None = None,
        floor: int = 25,
        ceiling: int = 95,
    ) -> None:
        if model_idx is not None and model_count is not None:
            pct = _multi_model_image_progress(
                idx, total, model_idx, model_count, floor=floor, ceiling=ceiling
            )
        else:
            pct = _work_progress(idx + 1, total, floor=floor, ceiling=ceiling)
        await update_job(
            job_id,
            progress=pct,
            progress_message=message,
            processed_items=processed if processed is not None else labeled,
            project_id=project_id,
        )

    async def _save_labeled_image(
        *,
        file_row: dict,
        file_id: str,
        combined: list[DetectionBox],
        per_model: dict[str, int],
    ) -> bool:
        """Persist merged labels; return True on success."""
        nonlocal labeled, failed
        try:
            det_count = await _persist_labels_async(
                project_id=project_id,
                dataset_id=dataset_id,
                job_id=job_id,
                file_row=file_row,
                file_id=file_id,
                combined=combined,
                per_model=per_model,
                config=config,
                low_threshold=low_threshold,
                num_models=num_models,
            )
            labeled += 1
            all_results.append(
                {
                    "file_id": file_id,
                    "detections": det_count,
                    "per_model": per_model,
                }
            )
            return True
        except asyncio.TimeoutError:
            failed += 1
            all_results.append(
                {
                    "file_id": file_id,
                    "error": f"Save timed out after {PERSIST_TIMEOUT_SECONDS}s",
                }
            )
            return False
        except Exception as exc:
            failed += 1
            all_results.append({"file_id": file_id, "error": str(exc)})
            return False

    def _cleanup_image_path(path: object) -> None:
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

    async def prepare_image(file_id: str) -> Path | None:
        if file_id in prep_failures:
            return None
        row = file_by_id.get(file_id)
        if not row:
            prep_failures[file_id] = "Image record missing"
            return None
        if not _is_image_row(row):
            prep_failures[file_id] = "Not an image file"
            return None
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(download_image_row, row, file_id),
                timeout=IMAGE_PREP_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Image download timed out after %ss image=%s",
                IMAGE_PREP_TIMEOUT_SECONDS,
                file_id,
            )
            prep_failures[file_id] = (
                f"Image download timed out after {IMAGE_PREP_TIMEOUT_SECONDS}s"
            )
            return None
        except Exception as exc:
            logger.warning("Image preparation failed %s: %s", file_id, exc)
            if _image_hf_path(row) and ("404" in str(exc) or "not found" in str(exc).lower()):
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
            return None

    cancelled_requested = False
    progress_items = 0
    low_memory_mode = os.getenv("LOW_MEMORY_MODE", "true").lower() != "false"
    hard = int(os.getenv("MEMORY_HARD_LIMIT_MB", "900" if low_memory_mode else "3000"))

    # --- Download model weights once (paths cached for per-image merged labeling) ---
    await update_job(
        job_id,
        progress=8,
        progress_message=f"Preparing {num_models} model(s) for merged labeling…",
        processed_items=0,
        project_id=project_id,
    )
    model_paths: dict[str, Path] = {}
    for mi, model_id in enumerate(model_ids):
        await raise_if_job_cancelled(job_id, project_id)
        try:
            model_paths[model_id] = await asyncio.wait_for(
                asyncio.to_thread(download_model, model_id, project_id),
                timeout=MODEL_DOWNLOAD_TIMEOUT_SECONDS,
            )
            logger.info(
                "Job %s: model %d/%d ready at %s",
                job_id,
                mi + 1,
                num_models,
                model_paths[model_id],
            )
        except FileNotFoundError as exc:
            logger.warning("model skipped %s: %s", model_id, exc)
            model_failures[model_id] = _model_failure_message(exc)
        except Exception as exc:
            logger.exception("Model download failed %s", model_id)
            model_failures[model_id] = _model_failure_message(exc)

    if prep_failures:
        logger.info(
            "Auto-label first HF/image preparation errors: %s",
            [f"{fid}: {err}" for fid, err in list(prep_failures.items())[:5]],
        )

    if len(prep_failures) == total:
        samples = [
            f"{fid}: {err}"
            for fid, err in list(prep_failures.items())[:5]
        ]
        all_oom = all(
            "out of memory" in err.lower() for err in prep_failures.values()
        )
        if all_oom:
            raise ValueError(
                "All images failed due to worker out-of-memory during inference. "
                f"Examples: {'; '.join(samples)}. "
                "pepsi.pt-style legacy YOLOv5/v7 models can exhaust Railway RAM even when skipped. "
                "Fix: deselect incompatible models, set MEMORY_HARD_LIMIT_MB=1200, "
                "INFERENCE_MAX_IMAGE_SIZE=320, INFERENCE_MIN_IMAGE_SIZE=256, "
                "ENABLE_YOLOV5_RUNTIME=false, ENABLE_YOLOV7_RUNTIME=false, then redeploy."
            )
        raise ValueError(
            "All images failed during preparation. "
            f"Examples: {'; '.join(samples)}. "
            f"Configured HF dataset repo: {settings.dataset_repo_id or '(not set)'} "
            f"(type={settings.dataset_repo_type}). "
            "Images are in the database but the actual files are missing on disk and Hugging Face. "
            "Fix: set HF_DATASET_REPO to a Hugging Face *dataset* repo (not HF_MODEL_REPO), "
            "re-upload images, or run POST /api/datasets/{project}/{dataset}/finalize-upload "
            "if files still exist on the Railway volume."
        )

    loaded_model_ids = [mid for mid in model_ids if mid in model_paths]

    if not loaded_model_ids:
        hint = _format_model_failures(project_id, model_failures)
        raise ValueError(
            "No models could be loaded — auto-label needs at least one compatible model. "
            f"Failed: {hint}. "
            "Use YOLOv8/v11 (.pt), .pth, or ONNX. Universal loader tries every compatible "
            "runtime per model. Models missing on Hugging Face must be uploaded once from "
            "the Models page. Very old YOLOv5/v7 may be slow on Railway."
        )

    # --- Phase 1: load all models into memory, then start labeling ---
    labeled = 0
    failed = len(prep_failures)
    all_results: list[dict] = [
        {"file_id": fid, "error": err} for fid, err in prep_failures.items()
    ]
    inference_timeout = int(os.getenv("AUTO_LABEL_INFERENCE_TIMEOUT_SECONDS", "120"))
    keep_all_enabled = os.getenv("AUTO_LABEL_KEEP_ALL_MODELS", "true").lower() != "false"
    gc_every_raw = os.getenv("AUTO_LABEL_GC_EVERY_IMAGES", "5" if low_memory_mode else "0")
    try:
        gc_every_value = int(gc_every_raw)
    except ValueError:
        gc_every_value = 5 if low_memory_mode else 0
    gc_every = gc_every_value if gc_every_value > 0 else None

    ready_model_ids: list[str] = []
    models_pinned = False
    model_count = len(loaded_model_ids)

    logger.info(
        "Job %s: phase 1 — preparing %d model(s) for merge before labeling %d images",
        job_id,
        model_count,
        total,
    )

    await update_job(
        job_id,
        progress=10,
        progress_message=f"Preparing {model_count} model(s) for merge…",
        processed_items=0,
        project_id=project_id,
    )

    models_pinned = keep_all_enabled and model_count >= 1
    if models_pinned:
        set_keep_all_models(True)

    try:
        await asyncio.to_thread(release_all_models)
        gc.collect()
        est_mb = int(os.getenv("AUTO_LABEL_MODEL_MEMORY_MB", "180"))

        for mi, model_id in enumerate(loaded_model_ids):
            if cancelled_requested:
                break
            await raise_if_job_cancelled(job_id, project_id)
            model_path = model_paths[model_id]

            if models_pinned and get_process_memory_mb() + est_mb >= hard * 0.88:
                logger.warning(
                    "Job %s: RAM too low to keep all models — per-image load after merge prep",
                    job_id,
                )
                for prev_id in ready_model_ids:
                    await asyncio.to_thread(unload_model, model_paths[prev_id])
                models_pinned = False

            await update_job(
                job_id,
                progress=_work_progress(mi + 1, model_count, floor=10, ceiling=22),
                progress_message=f"Preparing model {mi + 1}/{model_count} for merge…",
                processed_items=0,
                project_id=project_id,
            )

            try:
                await asyncio.wait_for(
                    asyncio.to_thread(load_yolo_model, model_path),
                    timeout=MODEL_WARMUP_TIMEOUT_SECONDS,
                )
                if model_id not in ready_model_ids:
                    ready_model_ids.append(model_id)
                if not models_pinned:
                    await asyncio.to_thread(unload_model, model_path)
                    gc.collect()
                else:
                    logger.info(
                        "Job %s: model %d/%d prepared in RAM: %s",
                        job_id,
                        mi + 1,
                        model_count,
                        model_id,
                    )
            except IncompatibleModelError as exc:
                await _safe_update_model_status(project_id, model_id, "incompatible_runtime")
                model_failures[model_id] = _model_failure_message(exc)
            except asyncio.TimeoutError:
                model_failures[model_id] = "Model load timed out"
            except MemoryLimitExceeded as exc:
                model_failures[model_id] = str(exc)
                if models_pinned:
                    for prev_id in ready_model_ids:
                        await asyncio.to_thread(unload_model, model_paths[prev_id])
                    models_pinned = False
            except Exception as exc:
                model_failures[model_id] = _model_failure_message(exc)
                logger.warning("model prep failed %s: %s", model_id, exc)

        if models_pinned and len(ready_model_ids) != model_count:
            await asyncio.to_thread(release_all_models)
            gc.collect()
            models_pinned = False

        if not ready_model_ids:
            raise ValueError(
                "No models could be prepared for merge. "
                + "; ".join(
                    f"{k}: {v}" for k, v in list(model_failures.items())[:3]
                )
            )

        n_ready = len(ready_model_ids)
        merge_msg = (
            f"All {n_ready} model(s) merged — starting labels on {total} image(s)…"
        )
        if models_pinned:
            merge_msg = (
                f"All {n_ready} models merged in memory — "
                f"starting labels on {total} image(s)…"
            )

        await update_job(
            job_id,
            progress=24,
            progress_message=merge_msg,
            processed_items=0,
            project_id=project_id,
        )
        logger.info(
            "Job %s: phase 2 — %d model(s) merged, pinned=%s",
            job_id,
            n_ready,
            models_pinned,
        )

        for idx, file_row in enumerate(file_list):
            if await asyncio.to_thread(is_job_cancelled, job_id, project_id):
                cancelled_requested = True
                break

            file_id = str(file_row["id"])
            if file_id in prep_failures:
                continue

            detail = _should_emit_detail(idx, progress_step, total)

            if detail:
                await _report_progress(
                    idx=idx,
                    message=(
                        f"Labeling image {idx + 1}/{total} · "
                        f"all {n_ready} model(s) merged…"
                    ),
                    processed=labeled,
                    model_idx=0,
                    model_count=n_ready,
                )

            image_path = await prepare_image(file_id)
            if image_path is None:
                continue

            combined_dets: list[DetectionBox] = []
            per_model: dict[str, int] = {}
            image_failed = False

            try:
                for mi, model_id in enumerate(ready_model_ids):
                    model_path = model_paths[model_id]
                    if not models_pinned:
                        try:
                            await asyncio.wait_for(
                                asyncio.to_thread(load_yolo_model, model_path),
                                timeout=MODEL_WARMUP_TIMEOUT_SECONDS,
                            )
                        except Exception as exc:
                            per_model[model_id] = 0
                            logger.warning(
                                "Job %s: per-image load failed model %s image %s: %s",
                                job_id,
                                model_id,
                                file_id,
                                exc,
                            )
                            continue

                    if _should_emit_model_substep(idx, progress_step, total, n_ready):
                        await _report_progress(
                            idx=idx,
                            message=(
                                f"Image {idx + 1}/{total} · model {mi + 1}/"
                                f"{n_ready} inferencing…"
                            ),
                            processed=labeled,
                            model_idx=mi,
                            model_count=n_ready,
                        )

                    model_config = _config_for_model(config, project_id, model_id)
                    try:
                        inference = await asyncio.wait_for(
                            asyncio.to_thread(
                                run_yolo_inference,
                                model_path,
                                image_path,
                                model_config,
                                model_name=model_id,
                                class_id_map=class_id_map,
                            ),
                            timeout=inference_timeout,
                        )
                        combined_dets.extend(inference.detections)
                        per_model[model_id] = len(inference.detections)
                    except asyncio.TimeoutError:
                        logger.warning(
                            "Inference timeout job=%s model=%s image=%s",
                            job_id,
                            model_id,
                            file_id,
                        )
                        per_model[model_id] = 0
                    except MemoryLimitExceeded as mem_exc:
                        prep_failures[file_id] = f"Out of memory: {mem_exc}"
                        image_failed = True
                        break
                    except Exception as exc:
                        logger.warning(
                            "Inference failed job=%s model=%s image=%s: %s",
                            job_id,
                            model_id,
                            file_id,
                            exc,
                        )
                        per_model[model_id] = 0
                    finally:
                        if not models_pinned:
                            await asyncio.to_thread(unload_model, model_path)
                            gc.collect()
            finally:
                _cleanup_image_path(image_path)

            if image_failed or file_id in prep_failures:
                continue

            if detail:
                await _report_progress(
                    idx=idx,
                    message=(
                        f"Saving image {idx + 1}/{total} · "
                        f"{n_ready} model(s) merged…"
                    ),
                    processed=labeled,
                )

            await _save_labeled_image(
                file_row=file_row,
                file_id=file_id,
                combined=combined_dets,
                per_model=per_model,
            )

            if detail:
                await _report_progress(
                    idx=idx,
                    message=(
                        f"Image {idx + 1}/{total} done "
                        f"({labeled}/{total} saved)"
                    ),
                    processed=labeled,
                )

            if gc_every and (idx + 1) % gc_every == 0:
                gc.collect()

    finally:
        clear_keep_all_models()
        await asyncio.to_thread(release_all_models)
        gc.collect()

    loaded_model_ids = [
        mid for mid in model_ids if mid in model_paths and mid not in model_failures
    ]
    if not loaded_model_ids and not labeled:
        hint = _format_model_failures(project_id, model_failures)
        raise ValueError(
            "No models could be loaded — auto-label needs at least one compatible model. "
            f"Failed: {hint}."
        )

    await update_job(
        job_id,
        processed_items=total,
        progress=99,
        progress_message=f"Saving complete — {total} image(s)…",
        project_id=project_id,
    )
    logger.info("Job %s done: labeled=%d failed=%d", job_id, labeled, failed)

    if cancelled_requested:
        raise JobCancelled("Job cancelled by user; partial labels were saved")

    if settings.auto_commit_after_labels:
        await raise_if_job_cancelled(job_id, project_id)
        labels_dir = settings.dataset_files_dir / str(project_id) / str(dataset_id) / "labels"
        if labels_dir.exists():
            try:
                file_count = sum(
                    1 for p in labels_dir.iterdir() if p.is_file()
                )
                label_commit = await asyncio.to_thread(
                    file_storage.upload_labels_from_folder,
                    project_id,
                    dataset_id,
                    str(labels_dir),
                    file_count,
                )
                logger.info(
                    "Auto-label labels uploaded to HF in one commit project=%s dataset=%s count=%s",
                    project_id,
                    dataset_id,
                    label_commit.get("count"),
                )
            except Exception as exc:
                logger.exception("Failed to upload auto-label label files to HF for %s/%s: %s", project_id, dataset_id, exc)

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

    clear_inference_profile()
    clear_keep_all_models()
    return _compact_job_result(
        project_id=project_id,
        dataset_id=dataset_id,
        model_ids=loaded_model_ids,
        selected_model_ids=selected_model_ids,
        total=total,
        labeled=labeled,
        failed=failed,
        all_results=all_results,
        model_failures=model_failures or None,
        db_total=db_total,
        skipped_not_eligible=skipped_not_eligible,
        skipped_not_remote_ready=skipped_not_remote_ready,
        skipped_already_labeled=skipped_already_labeled,
        relabel_all=relabel_all,
    )
