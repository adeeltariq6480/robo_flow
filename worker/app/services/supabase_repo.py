"""Supabase Postgres data access — drop-in replacement for firestore_repo."""

import logging
from datetime import datetime, timezone

from app.services import hf_storage as file_storage

from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sb():
    return get_supabase()


def _ts(value) -> str:
    if value is None:
        return now_iso()
    return str(value)


# ---------------------------------------------------------------------------
# Row mappers (DB snake_case → API camelCase)
# ---------------------------------------------------------------------------

def _project_row(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "description": row.get("description"),
        "annotationType": row.get("annotation_type", "bounding_box"),
        "createdAt": _ts(row.get("created_at")),
        "updatedAt": _ts(row.get("updated_at")),
    }


def _class_row(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "className": row.get("class_name", ""),
        "classIndex": row.get("class_index", 0),
        "color": row.get("color"),
        "description": row.get("description"),
        "createdAt": _ts(row.get("created_at")),
        "updatedAt": _ts(row.get("updated_at")),
    }


def _dataset_row(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "description": row.get("description"),
        "totalImages": row.get("total_images", 0),
        "totalSizeBytes": row.get("total_size_bytes", 0),
        "hfRepo": "datasets",
        "hfFolderPath": row.get("storage_folder_path"),
        "createdAt": _ts(row.get("created_at")),
        "updatedAt": _ts(row.get("updated_at")),
    }


def _image_row(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "datasetId": str(row["dataset_id"]),
        "fileName": row["file_name"],
        "hfRepo": row.get("hf_repo", "datasets"),
        "hfPath": row["hf_path"],
        "localPath": row.get("local_path"),
        "storageStatus": row.get("storage_status", "local_ready" if row.get("local_path") else "pending"),
        "hfSyncStatus": row.get("hf_sync_status", "pending"),
        "mimeType": row.get("mime_type"),
        "fileSize": row.get("file_size", 0),
        "width": row.get("width"),
        "height": row.get("height"),
        "status": row.get("status", "uploaded"),
        "queueType": row.get("queue_type", "unassigned"),
        "createdAt": _ts(row.get("created_at")),
        "updatedAt": _ts(row.get("updated_at")),
    }


def _model_row(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "modelName": row["model_name"],
        "modelVersion": row.get("model_version", "1.0.0"),
        "modelType": row.get("model_type", "pytorch"),
        "hfRepo": row.get("hf_repo", "models"),
        "hfPath": row["hf_path"],
        "classMapping": row.get("class_mapping") or {},
        "fileSize": row.get("file_size"),
        "description": row.get("description"),
        "createdAt": _ts(row.get("created_at")),
        "updatedAt": _ts(row.get("updated_at")),
    }


def _annotation_row(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "imageId": str(row["image_id"]),
        "jobId": str(row["job_id"]) if row.get("job_id") else None,
        "status": row.get("status", "active"),
        "source": row.get("source", "auto"),
        "reviewStatus": row.get("review_status"),
        "reviewedAt": row.get("reviewed_at"),
        "autoLabeledAt": row.get("auto_labeled_at"),
        "createdAt": _ts(row.get("created_at")),
        "updatedAt": _ts(row.get("updated_at")),
    }


def _object_row(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "annotationId": str(row["annotation_id"]),
        "imageId": str(row["image_id"]),
        "classId": str(row["class_id"]) if row.get("class_id") else None,
        "classIndex": row.get("class_index", 0),
        "className": row.get("class_name", "unknown"),
        "xMin": row["x_min"],
        "yMin": row["y_min"],
        "xMax": row["x_max"],
        "yMax": row["y_max"],
        "confidence": row.get("confidence", 1.0),
        "source": row.get("source", "auto"),
        "createdAt": _ts(row.get("created_at")),
        "updatedAt": _ts(row.get("updated_at")),
    }


def _job_row(row: dict) -> dict:
    model_ids = row.get("model_ids") or []
    return {
        "id": str(row["id"]),
        "datasetId": str(row["dataset_id"]) if row.get("dataset_id") else None,
        "modelId": str(row["model_id"]) if row.get("model_id") else None,
        "modelIds": [str(m) for m in model_ids],
        "jobType": row.get("job_type"),
        "confidenceThreshold": row.get("confidence_threshold", 0.25),
        "iouThreshold": row.get("iou_threshold", 0.45),
        "imageSize": row.get("image_size", 640),
        "lowLabelThreshold": row.get("low_label_threshold", 1),
        "config": row.get("config") or {},
        "inputPayload": row.get("input_payload") or {},
        "status": row.get("status", "queued"),
        "progress": row.get("progress", 0),
        "progressMessage": row.get("progress_message"),
        "totalItems": row.get("total_items", 0),
        "processedItems": row.get("processed_items", 0),
        "result": row.get("result"),
        "errorMessage": row.get("error_message"),
        "createdAt": _ts(row.get("created_at")),
        "startedAt": row.get("started_at"),
        "completedAt": row.get("completed_at"),
    }


def _coerce_str(value, *, fallback: str = "") -> str:
    if value is None:
        return fallback
    if isinstance(value, list):
        parts = [str(v).strip() for v in value if str(v).strip()]
        return ", ".join(parts) if parts else fallback
    return str(value).strip() or fallback


def _coerce_int(value, *, fallback: int = 0) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, list) and value:
        return _coerce_int(value[0], fallback=fallback)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _normalize_class_record(doc: dict) -> dict:
    name = _coerce_str(
        doc.get("className") or doc.get("name") or doc.get("class_name"),
        fallback="unknown",
    )
    idx = _coerce_int(doc.get("classIndex", doc.get("class_index")), fallback=0)
    return {
        "class_name": name,
        "class_index": idx,
        "color": doc.get("color"),
        "description": doc.get("description"),
    }


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

def create_project(name: str, description: str | None, annotation_type: str) -> dict:
    res = (
        _sb()
        .table("projects")
        .insert(
            {
                "name": name,
                "description": description,
                "annotation_type": annotation_type,
            }
        )
        .execute()
    )
    return _project_row(res.data[0])


def list_projects() -> list[dict]:
    res = (
        _sb()
        .table("projects")
        .select("*")
        .order("updated_at", desc=True)
        .execute()
    )
    return [_project_row(r) for r in res.data or []]


def get_project(project_id: str) -> dict | None:
    res = _sb().table("projects").select("*").eq("id", project_id).limit(1).execute()
    rows = res.data or []
    return _project_row(rows[0]) if rows else None


def update_project(project_id: str, fields: dict) -> dict | None:
    payload: dict = {}
    if fields.get("name") is not None:
        payload["name"] = fields["name"]
    if "description" in fields:
        payload["description"] = fields["description"]
    if fields.get("annotationType") is not None:
        payload["annotation_type"] = fields["annotationType"]
    if payload:
        _sb().table("projects").update(payload).eq("id", project_id).execute()
    return get_project(project_id)


def delete_project(project_id: str) -> None:
    _sb().table("projects").delete().eq("id", project_id).execute()


def get_project_stats(project_id: str) -> dict:
    if not get_project(project_id):
        raise ValueError(f"Project {project_id} not found")

    def count(table: str) -> int:
        res = (
            _sb()
            .table(table)
            .select("id", count="exact")
            .eq("project_id", project_id)
            .execute()
        )
        return res.count or 0

    return {
        "classCount": count("classes"),
        "datasetCount": count("datasets"),
        "modelCount": count("models"),
        "imageCount": count("images"),
    }


# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------

def list_classes(project_id: str) -> list[dict]:
    res = (
        _sb()
        .table("classes")
        .select("*")
        .eq("project_id", project_id)
        .order("class_index")
        .execute()
    )
    return [_class_row(r) for r in res.data or []]


def save_classes(project_id: str, classes: list[dict]) -> list[dict]:
    _sb().table("classes").delete().eq("project_id", project_id).execute()
    rows = []
    for idx, c in enumerate(classes):
        norm = _normalize_class_record(
            {
                "className": c.get("className") or c.get("name") or c.get("class_name"),
                "classIndex": c.get("classIndex", c.get("class_index", idx)),
                "color": c.get("color"),
                "description": c.get("description"),
            }
        )
        rows.append({"project_id": project_id, **norm})

    if not rows:
        return []

    res = _sb().table("classes").insert(rows).execute()
    return [_class_row(r) for r in res.data or []]


def get_project_class_map(project_id: str) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for c in list_classes(project_id):
        name = _coerce_str(c.get("className"), fallback="")
        if not name:
            continue
        mapping[name] = c["id"]
        mapping[name.strip().lower()] = c["id"]
    return mapping


# ---------------------------------------------------------------------------
# Datasets
# ---------------------------------------------------------------------------

def create_dataset(project_id: str, name: str, hf_repo: str | None = None) -> dict:
    res = (
        _sb()
        .table("datasets")
        .insert({"project_id": project_id, "name": name})
        .execute()
    )
    return _dataset_row(res.data[0])


def list_datasets(project_id: str) -> list[dict]:
    res = (
        _sb()
        .table("datasets")
        .select("*")
        .eq("project_id", project_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return [_dataset_row(r) for r in res.data or []]


def get_dataset(project_id: str, dataset_id: str) -> dict | None:
    res = (
        _sb()
        .table("datasets")
        .select("*")
        .eq("id", dataset_id)
        .eq("project_id", project_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return _dataset_row(rows[0]) if rows else None


def update_dataset(project_id: str, dataset_id: str, fields: dict) -> None:
    payload: dict = {}
    if "totalImages" in fields:
        payload["total_images"] = fields["totalImages"]
    if "totalSizeBytes" in fields:
        payload["total_size_bytes"] = fields["totalSizeBytes"]
    if "hfFolderPath" in fields:
        payload["storage_folder_path"] = fields["hfFolderPath"]
    if payload:
        (
            _sb()
            .table("datasets")
            .update(payload)
            .eq("id", dataset_id)
            .eq("project_id", project_id)
            .execute()
        )


def count_dataset_images(project_id: str, dataset_id: str) -> int:
    res = (
        _sb()
        .table("images")
        .select("id", count="exact")
        .eq("project_id", project_id)
        .eq("dataset_id", dataset_id)
        .execute()
    )
    return res.count or 0


def recount_dataset_images(project_id: str, dataset_id: str) -> int:
    total = count_dataset_images(project_id, dataset_id)
    update_dataset(
        project_id,
        dataset_id,
        {
            "totalImages": total,
            "hfFolderPath": f"datasets/{project_id}/{dataset_id}",
        },
    )
    return total


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

def _build_image_insert_payload(project_id: str, dataset_id: str, data: dict) -> dict:
    payload = {
        "project_id": project_id,
        "dataset_id": dataset_id,
        "file_name": data["fileName"],
        "hf_repo": data.get("hfRepo", "datasets"),
        "hf_path": data["hfPath"],
        "width": data.get("width"),
        "height": data.get("height"),
        "mime_type": data.get("mimeType"),
        "file_size": data.get("fileSize", 0),
        "status": data.get("status", "uploaded"),
        "queue_type": data.get("queueType", "unassigned"),
    }
    if data.get("localPath") is not None:
        payload["local_path"] = data["localPath"]
    if data.get("storageStatus") is not None:
        payload["storage_status"] = data["storageStatus"]
    if data.get("hfSyncStatus") is not None:
        payload["hf_sync_status"] = data["hfSyncStatus"]
    return payload


def create_image(project_id: str, dataset_id: str, data: dict) -> dict:
    payload = _build_image_insert_payload(project_id, dataset_id, data)
    try:
        res = _sb().table("images").insert(payload).execute()
    except Exception as exc:
        message = str(exc).lower()
        if "column" in message and "does not exist" in message:
            fallback = {k: v for k, v in payload.items() if k not in {"local_path", "storage_status", "hf_sync_status"}}
            res = _sb().table("images").insert(fallback).execute()
        else:
            raise
    return _image_row(res.data[0])


def update_image_status(project_id: str, image_id: str, status: str) -> None:
    _sb().table("images").update({"status": status}).eq("id", image_id).eq("project_id", project_id).execute()


def update_image_storage_fields(project_id: str, image_id: str, data: dict) -> None:
    payload = {}
    if "status" in data:
        payload["status"] = data["status"]
    if "local_path" in data:
        payload["local_path"] = data["local_path"]
    if "storage_status" in data:
        payload["storage_status"] = data["storage_status"]
    if "hf_sync_status" in data:
        payload["hf_sync_status"] = data["hf_sync_status"]
    if not payload:
        return
    try:
        _sb().table("images").update(payload).eq("id", image_id).eq("project_id", project_id).execute()
    except Exception as exc:
        message = str(exc).lower()
        if "column" in message and "does not exist" in message:
            fallback = {k: v for k, v in payload.items() if k not in {"local_path", "storage_status", "hf_sync_status"}}
            if fallback:
                _sb().table("images").update(fallback).eq("id", image_id).eq("project_id", project_id).execute()
        else:
            raise


def list_dataset_images(project_id: str, dataset_id: str) -> list[dict]:
    res = (
        _sb()
        .table("images")
        .select("*")
        .eq("project_id", project_id)
        .eq("dataset_id", dataset_id)
        .order("created_at")
        .execute()
    )
    return [_image_row(r) for r in res.data or []]


def get_image(project_id: str, image_id: str) -> dict | None:
    res = (
        _sb()
        .table("images")
        .select("*")
        .eq("id", image_id)
        .eq("project_id", project_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return _image_row(rows[0]) if rows else None


def _delete_image_annotations(project_id: str, image_id: str) -> None:
    ann_res = (
        _sb()
        .table("annotations")
        .select("id")
        .eq("project_id", project_id)
        .eq("image_id", image_id)
        .execute()
    )
    ann_ids = [a["id"] for a in ann_res.data or []]
    if ann_ids:
        _sb().table("annotation_objects").delete().in_("image_id", [image_id]).execute()
        _sb().table("annotations").delete().in_("id", ann_ids).execute()


def delete_images(project_id: str, dataset_id: str, image_ids: list[str]) -> None:
    for image_id in image_ids:
        img = get_image(project_id, image_id)
        if not img or img.get("datasetId") != dataset_id:
            continue
        _delete_image_annotations(project_id, image_id)
        repo_id = img.get("hfRepo")
        path_in_repo = img.get("hfPath")
        if repo_id and path_in_repo:
            try:
                file_storage.delete_from_repo(
                    repo_id,
                    path_in_repo,
                    repo_type=file_storage.REPO_TYPE_DATASET,
                )
            except Exception as exc:
                logger.warning("HF image delete failed %s: %s", image_id, exc)
        _sb().table("images").delete().eq("id", image_id).execute()
    recount_dataset_images(project_id, dataset_id)


def delete_dataset(project_id: str, dataset_id: str) -> None:
    imgs = list_dataset_images(project_id, dataset_id)
    for img in imgs:
        _delete_image_annotations(project_id, img["id"])
        repo_id = img.get("hfRepo")
        path_in_repo = img.get("hfPath")
        if repo_id and path_in_repo:
            try:
                file_storage.delete_from_repo(
                    repo_id,
                    path_in_repo,
                    repo_type=file_storage.REPO_TYPE_DATASET,
                )
            except Exception as exc:
                logger.warning("HF dataset image delete failed %s: %s", img["id"], exc)
    _sb().table("images").delete().eq("dataset_id", dataset_id).execute()
    _sb().table("datasets").delete().eq("id", dataset_id).eq("project_id", project_id).execute()


def dataset_review_files(project_id: str, dataset_id: str) -> list[dict]:
    images = list_dataset_images(project_id, dataset_id)
    ann_res = (
        _sb()
        .table("annotations")
        .select("*")
        .eq("project_id", project_id)
        .execute()
    )
    annotations = {str(a["image_id"]): _annotation_row(a) for a in ann_res.data or []}

    obj_res = (
        _sb()
        .table("annotation_objects")
        .select("*")
        .eq("project_id", project_id)
        .execute()
    )
    objects_by_image: dict[str, list[dict]] = {}
    for o in obj_res.data or []:
        objects_by_image.setdefault(str(o["image_id"]), []).append(_object_row(o))

    return [
        {
            "image": img,
            "annotation": annotations.get(img["id"]),
            "objects": objects_by_image.get(img["id"], []),
        }
        for img in images
    ]


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

def create_model(project_id: str, data: dict) -> dict:
    """Insert or replace model row when the same model_name already exists in the project."""
    payload = {
        "project_id": project_id,
        "model_name": data["modelName"],
        "model_version": data.get("modelVersion", "1.0.0"),
        "model_type": data.get("modelType", "pytorch"),
        "hf_repo": data.get("hfRepo", "models"),
        "hf_path": data["hfPath"],
        "class_mapping": data.get("classMapping") or {},
        "file_size": data.get("fileSize"),
        "description": data.get("description"),
    }
    res = (
        _sb()
        .table("models")
        .upsert(payload, on_conflict="project_id,model_name")
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("Model upsert returned no rows")
    return _model_row(rows[0])


def list_models(project_id: str) -> list[dict]:
    res = (
        _sb()
        .table("models")
        .select("*")
        .eq("project_id", project_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return [_model_row(r) for r in res.data or []]


def get_model(project_id: str, model_id: str) -> dict | None:
    res = (
        _sb()
        .table("models")
        .select("*")
        .eq("id", model_id)
        .eq("project_id", project_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return _model_row(rows[0]) if rows else None


def delete_model(project_id: str, model_id: str) -> None:
    _sb().table("models").delete().eq("id", model_id).eq("project_id", project_id).execute()


# ---------------------------------------------------------------------------
# Labelling jobs
# ---------------------------------------------------------------------------

def get_job_registry_project(job_id: str) -> str | None:
    res = _sb().table("job_registry").select("project_id").eq("job_id", job_id).limit(1).execute()
    rows = res.data or []
    return str(rows[0]["project_id"]) if rows else None


def get_labelling_job(project_id: str, job_id: str) -> dict | None:
    res = (
        _sb()
        .table("labelling_jobs")
        .select("*")
        .eq("id", job_id)
        .eq("project_id", project_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return _job_row(rows[0]) if rows else None


def create_labelling_job(
    project_id: str,
    *,
    job_type: str,
    dataset_id: str | None = None,
    model_id: str | None = None,
    model_ids: list[str] | None = None,
    config: dict | None = None,
    input_payload: dict | None = None,
    total_items: int = 0,
) -> str:
    cfg = config or {}
    row = {
        "project_id": project_id,
        "job_type": job_type,
        "dataset_id": dataset_id,
        "model_id": model_id,
        "model_ids": model_ids or [],
        "confidence_threshold": cfg.get("confidence", 0.25),
        "iou_threshold": cfg.get("iou", 0.45),
        "image_size": cfg.get("image_size", 640),
        "low_label_threshold": cfg.get("low_label_threshold", 1),
        "config": cfg,
        "input_payload": input_payload or {},
        "status": "queued",
        "progress": 0,
        "progress_message": "Queued",
        "total_items": total_items,
        "processed_items": 0,
    }
    res = _sb().table("labelling_jobs").insert(row).execute()
    job_id = str(res.data[0]["id"])
    _sb().table("job_registry").insert(
        {"job_id": job_id, "project_id": project_id, "job_type": job_type}
    ).execute()
    return job_id


def update_labelling_job(project_id: str, job_id: str, **fields) -> None:
    mapping = {
        "status": "status",
        "progress": "progress",
        "progress_message": "progress_message",
        "processed_items": "processed_items",
        "result": "result",
        "error_message": "error_message",
        "total_items": "total_items",
    }
    payload: dict = {}
    for key, col in mapping.items():
        if key in fields and fields[key] is not None:
            payload[col] = fields[key]
    if fields.get("mark_started"):
        payload["started_at"] = now_iso()
    if fields.get("mark_completed"):
        payload["completed_at"] = now_iso()
    if payload:
        (
            _sb()
            .table("labelling_jobs")
            .update(payload)
            .eq("id", job_id)
            .eq("project_id", project_id)
            .execute()
        )


# ---------------------------------------------------------------------------
# Annotations
# ---------------------------------------------------------------------------

def get_annotation_for_image(project_id: str, image_id: str) -> dict | None:
    res = (
        _sb()
        .table("annotations")
        .select("*")
        .eq("project_id", project_id)
        .eq("image_id", image_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return _annotation_row(rows[0]) if rows else None


def list_annotation_objects(project_id: str, image_id: str) -> list[dict]:
    res = (
        _sb()
        .table("annotation_objects")
        .select("*")
        .eq("project_id", project_id)
        .eq("image_id", image_id)
        .execute()
    )
    return [_object_row(r) for r in res.data or []]


def save_image_annotations(
    project_id: str,
    image_id: str,
    objects: list[dict],
    *,
    job_id: str | None = None,
    source: str = "auto",
    auto_labeled: bool = True,
    review_status: str | None = "pending",
) -> str:
    now = now_iso()
    existing = get_annotation_for_image(project_id, image_id)
    if existing:
        ann_id = existing["id"]
        _sb().table("annotations").update(
            {
                "job_id": job_id,
                "source": source,
                "review_status": review_status,
                "auto_labeled_at": now if auto_labeled else None,
            }
        ).eq("id", ann_id).execute()
    else:
        res = (
            _sb()
            .table("annotations")
            .insert(
                {
                    "project_id": project_id,
                    "image_id": image_id,
                    "job_id": job_id,
                    "status": "active",
                    "source": source,
                    "review_status": review_status,
                    "auto_labeled_at": now if auto_labeled else None,
                }
            )
            .execute()
        )
        ann_id = str(res.data[0]["id"])

    _sb().table("annotation_objects").delete().eq("image_id", image_id).execute()
    if objects:
        rows = [
            {
                "annotation_id": ann_id,
                "project_id": project_id,
                "image_id": image_id,
                "class_id": obj.get("classId") or obj.get("project_class_id"),
                "class_index": obj.get("classIndex", 0),
                "class_name": obj.get("className") or obj.get("class_name", "unknown"),
                "x_min": obj["xMin"],
                "y_min": obj["yMin"],
                "x_max": obj["xMax"],
                "y_max": obj["yMax"],
                "confidence": obj.get("confidence", 1.0),
                "source": source,
            }
            for obj in objects
        ]
        _sb().table("annotation_objects").insert(rows).execute()
    return ann_id


def detections_to_objects(detections: list[dict]) -> list[dict]:
    out: list[dict] = []
    for det in detections:
        x, y, w, h = det["x"], det["y"], det["width"], det["height"]
        half_w, half_h = w / 2, h / 2
        out.append(
            {
                "classId": det.get("project_class_id"),
                "classIndex": det.get("class_index", 0),
                "className": det.get("class_name", "unknown"),
                "xMin": max(0.0, x - half_w),
                "yMin": max(0.0, y - half_h),
                "xMax": min(1.0, x + half_w),
                "yMax": min(1.0, y + half_h),
                "confidence": det.get("confidence", 1.0),
            }
        )
    return out


def set_review_status(project_id: str, image_id: str, status: str) -> None:
    now = now_iso()
    ann = get_annotation_for_image(project_id, image_id)
    if ann:
        _sb().table("annotations").update(
            {"review_status": status, "reviewed_at": now}
        ).eq("id", ann["id"]).execute()
    _sb().table("images").update(
        {
            "status": "reviewed" if status in ("approved", "rejected") else "labeled",
        }
    ).eq("id", image_id).execute()


# ---------------------------------------------------------------------------
# Review queues
# ---------------------------------------------------------------------------

def update_image_queue(project_id: str, image_id: str, queue_type: str, reason: str) -> None:
    _sb().table("images").update(
        {"queue_type": queue_type, "status": "labeled"}
    ).eq("id", image_id).execute()
    _sb().table("review_queues").insert(
        {
            "project_id": project_id,
            "image_id": image_id,
            "queue_type": queue_type,
            "reason": reason,
        }
    ).execute()


def review_queue_counts(project_id: str) -> dict[str, int]:
    res = _sb().table("images").select("queue_type").eq("project_id", project_id).execute()
    counts: dict[str, int] = {}
    for row in res.data or []:
        qt = row.get("queue_type") or "unassigned"
        counts[qt] = counts.get(qt, 0) + 1
    return counts


def list_images_by_queue(project_id: str, queue_type: str | None = None) -> list[dict]:
    q = _sb().table("images").select("*").eq("project_id", project_id)
    if queue_type:
        q = q.eq("queue_type", queue_type)
    res = q.execute()
    return [_image_row(r) for r in res.data or []]


def classify_queue(
    objects: list[dict],
    *,
    confidence: float,
    low_label_threshold: int,
    class_id_known: bool = True,
    per_model: dict[str, int] | None = None,
) -> tuple[str, str]:
    count = len(objects)
    if count == 0:
        return "no_label", "Zero detections"
    if not class_id_known:
        return "class_missing", "Detected class not mapped to a project class"
    if count <= low_label_threshold:
        return "low_label", f"Only {count} detection(s)"
    low_conf = [o for o in objects if o.get("confidence", 1) < confidence]
    if low_conf:
        return "low_confidence", f"{len(low_conf)} low-confidence label(s)"
    if per_model and len(per_model) > 1:
        vals = list(per_model.values())
        if max(vals) - min(vals) > max(1, count // 2):
            return "conflict", "Models disagree on detection count"
    return "good", "Sufficient confident labels"


# ---------------------------------------------------------------------------
# Model comparison / test runs / exports
# ---------------------------------------------------------------------------

def create_test_run(project_id: str, data: dict) -> str:
    res = (
        _sb()
        .table("model_test_runs")
        .insert({"project_id": project_id, "payload": data, "status": "queued"})
        .execute()
    )
    return str(res.data[0]["id"])


def update_test_run(project_id: str, test_run_id: str, fields: dict) -> None:
    _sb().table("model_test_runs").update(fields).eq("id", test_run_id).execute()


def save_comparison_result(project_id: str, data: dict) -> str:
    res = (
        _sb()
        .table("model_comparison_results")
        .insert({"project_id": project_id, "payload": data})
        .execute()
    )
    return str(res.data[0]["id"])


def list_comparison_results(project_id: str, test_run_id: str) -> list[dict]:
    res = (
        _sb()
        .table("model_comparison_results")
        .select("*")
        .eq("project_id", project_id)
        .eq("test_run_id", test_run_id)
        .execute()
    )
    return res.data or []


def create_export_job(project_id: str, export_format: str) -> str:
    res = (
        _sb()
        .table("export_jobs")
        .insert({"project_id": project_id, "export_format": export_format, "status": "running"})
        .execute()
    )
    return str(res.data[0]["id"])


def complete_export_job(
    project_id: str, export_job_id: str, *, hf_repo: str, hf_path: str
) -> None:
    _sb().table("export_jobs").update(
        {
            "status": "completed",
            "hf_repo": hf_repo,
            "hf_path": hf_path,
            "completed_at": now_iso(),
        }
    ).eq("id", export_job_id).execute()


def fail_export_job(project_id: str, export_job_id: str, error: str) -> None:
    _sb().table("export_jobs").update(
        {"status": "failed", "error_message": error, "completed_at": now_iso()}
    ).eq("id", export_job_id).execute()


def get_approved_export_data(project_id: str) -> list[dict]:
    ann_res = (
        _sb()
        .table("annotations")
        .select("image_id")
        .eq("project_id", project_id)
        .eq("review_status", "approved")
        .execute()
    )
    approved_ids = {str(a["image_id"]) for a in ann_res.data or []}
    if not approved_ids:
        return []

    img_res = _sb().table("images").select("*").eq("project_id", project_id).execute()
    out: list[dict] = []
    for row in img_res.data or []:
        image_id = str(row["id"])
        if image_id not in approved_ids:
            continue
        out.append(
            {
                "image": _image_row(row),
                "objects": list_annotation_objects(project_id, image_id),
            }
        )
    return out
