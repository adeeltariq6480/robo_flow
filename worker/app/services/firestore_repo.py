"""Firestore data access — metadata only. All binary files live in Hugging Face Hub."""

import logging
from datetime import date, datetime, timezone

from app.services.firebase_client import get_db

logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db():
    return get_db()


def _project_ref(project_id: str):
    return _db().collection("projects").document(project_id)


def _sub(project_id: str, name: str):
    return _project_ref(project_id).collection(name)


def _serialize_value(value):
    """Convert Firestore field types to JSON-safe values."""
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, dict):
        return {str(k): _serialize_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize_value(v) for v in value]
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    if hasattr(value, "path"):
        return str(value.path)
    if hasattr(value, "latitude") and hasattr(value, "longitude"):
        return {"latitude": value.latitude, "longitude": value.longitude}
    return str(value)


def _doc_dict(doc) -> dict:
    raw = {"id": doc.id, **(doc.to_dict() or {})}
    return _serialize_value(raw)


def _stream_docs(query, *, label: str) -> list[dict]:
    try:
        return [_doc_dict(d) for d in query.stream()]
    except Exception:
        logger.exception("Firestore query failed: %s", label)
        raise


def _subcollection_count(proj, name: str) -> int:
    col = proj.collection(name)
    try:
        return int(col.count().get()[0][0].value)
    except Exception:
        logger.warning("count() failed for %s, falling back to stream", name)
        try:
            return sum(1 for _ in col.stream())
        except Exception:
            logger.exception("stream count failed for %s", name)
            return 0


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

def create_project(name: str, description: str | None, annotation_type: str) -> dict:
    now = now_iso()
    ref = _db().collection("projects").document()
    data = {
        "name": name,
        "description": description,
        "annotationType": annotation_type,
        "createdAt": now,
        "updatedAt": now,
    }
    ref.set(data)
    return {"id": ref.id, **data}


def list_projects() -> list[dict]:
    col = _db().collection("projects")
    try:
        return _stream_docs(col.order_by("updatedAt", direction="DESCENDING"), label="list_projects")
    except Exception:
        return _stream_docs(col, label="list_projects_fallback")


def get_project(project_id: str) -> dict | None:
    doc = _project_ref(project_id).get()
    return _doc_dict(doc) if doc.exists else None


def update_project(project_id: str, fields: dict) -> dict | None:
    payload = {k: v for k, v in fields.items() if v is not None}
    payload["updatedAt"] = now_iso()
    _project_ref(project_id).update(payload)
    return get_project(project_id)


def delete_project(project_id: str) -> None:
    proj = _project_ref(project_id)
    subcollections = [
        "classes", "datasets", "images", "models", "annotations",
        "annotationObjects", "labellingJobs", "reviewQueues", "exportJobs",
        "modelTestRuns", "modelComparisonResults",
    ]
    for name in subcollections:
        docs = list(proj.collection(name).stream())
        for i in range(0, len(docs), 400):
            batch = _db().batch()
            for d in docs[i:i + 400]:
                batch.delete(d.reference)
            batch.commit()
    proj.delete()


def get_project_stats(project_id: str) -> dict:
    proj = _project_ref(project_id)
    if not proj.get().exists:
        raise ValueError(f"Project {project_id} not found")
    return {
        "classCount": _subcollection_count(proj, "classes"),
        "datasetCount": _subcollection_count(proj, "datasets"),
        "modelCount": _subcollection_count(proj, "models"),
        "imageCount": _subcollection_count(proj, "images"),
    }


# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------

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
    """Repair legacy/corrupt class rows (e.g. array stored in className)."""
    name = _coerce_str(
        doc.get("className") or doc.get("name") or doc.get("class_name"),
        fallback="unknown",
    )
    idx = _coerce_int(doc.get("classIndex", doc.get("class_index")), fallback=0)
    color = doc.get("color")
    if isinstance(color, list):
        color = color[0] if color else None
    description = doc.get("description")
    if isinstance(description, list):
        description = ", ".join(str(v) for v in description)
    return {
        **doc,
        "className": name,
        "classIndex": idx,
        "color": color,
        "description": description,
    }


def list_classes(project_id: str) -> list[dict]:
    col = _sub(project_id, "classes")
    try:
        rows = _stream_docs(col.order_by("classIndex"), label="list_classes")
    except Exception:
        rows = _stream_docs(col, label="list_classes_fallback")
    normalized = [_normalize_class_record(r) for r in rows]
    return sorted(normalized, key=lambda r: r.get("classIndex", 0))


def save_classes(project_id: str, classes: list[dict]) -> list[dict]:
    """Replace project classes with the provided list (import/bulk save)."""
    col = _sub(project_id, "classes")
    existing = list(col.stream())

    for i in range(0, len(existing), 400):
        batch = _db().batch()
        for d in existing[i : i + 400]:
            batch.delete(d.reference)
        batch.commit()

    now = now_iso()
    created: list[dict] = []
    pending: list[dict] = []

    for idx, c in enumerate(classes):
        data = _normalize_class_record(
            {
                "className": c.get("className") or c.get("name") or c.get("class_name"),
                "classIndex": c.get("classIndex", c.get("class_index", idx)),
                "color": c.get("color"),
                "description": c.get("description"),
                "createdAt": now,
                "updatedAt": now,
            }
        )
        pending.append(data)

    for i in range(0, len(pending), 400):
        batch = _db().batch()
        chunk = pending[i : i + 400]
        for data in chunk:
            ref = col.document()
            batch.set(ref, data)
            created.append({"id": ref.id, **data})
        batch.commit()

    return created


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
    now = now_iso()
    ref = _sub(project_id, "datasets").document()
    data = {
        "name": name,
        "totalImages": 0,
        "hfRepo": hf_repo,
        "hfFolderPath": None,
        "createdAt": now,
        "updatedAt": now,
    }
    ref.set(data)
    return {"id": ref.id, **data}


def list_datasets(project_id: str) -> list[dict]:
    col = _sub(project_id, "datasets")
    try:
        return _stream_docs(col.order_by("updatedAt", direction="DESCENDING"), label="list_datasets")
    except Exception:
        return _stream_docs(col, label="list_datasets_fallback")


def get_dataset(project_id: str, dataset_id: str) -> dict | None:
    doc = _sub(project_id, "datasets").document(dataset_id).get()
    return _doc_dict(doc) if doc.exists else None


def update_dataset(project_id: str, dataset_id: str, fields: dict) -> None:
    fields["updatedAt"] = now_iso()
    _sub(project_id, "datasets").document(dataset_id).update(fields)


def recount_dataset_images(project_id: str, dataset_id: str) -> int:
    total = count_dataset_images(project_id, dataset_id)
    update_dataset(project_id, dataset_id, {"totalImages": total, "hfFolderPath": f"datasets/{project_id}/{dataset_id}"})
    return total


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

def create_image(project_id: str, dataset_id: str, data: dict) -> dict:
    now = now_iso()
    ref = _sub(project_id, "images").document()
    payload = {
        "datasetId": dataset_id,
        "fileName": data["fileName"],
        "hfRepo": data.get("hfRepo"),
        "hfPath": data.get("hfPath"),
        "width": data.get("width"),
        "height": data.get("height"),
        "mimeType": data.get("mimeType"),
        "fileSize": data.get("fileSize"),
        "status": data.get("status", "uploaded"),
        "queueType": data.get("queueType", "unassigned"),
        "createdAt": now,
        "updatedAt": now,
    }
    ref.set(payload)
    return {"id": ref.id, **payload}


def list_dataset_images(project_id: str, dataset_id: str) -> list[dict]:
    snap = _sub(project_id, "images").where("datasetId", "==", dataset_id).stream()
    return [_doc_dict(d) for d in snap]


def count_dataset_images(project_id: str, dataset_id: str) -> int:
    snap = _sub(project_id, "images").where("datasetId", "==", dataset_id).count().get()
    return snap[0][0].value


def get_image(project_id: str, image_id: str) -> dict | None:
    doc = _sub(project_id, "images").document(image_id).get()
    return _doc_dict(doc) if doc.exists else None


def _delete_image_annotations(project_id: str, image_id: str) -> None:
    db = _db()
    batch = db.batch()
    for col in ("annotations", "annotationObjects"):
        for d in _sub(project_id, col).where("imageId", "==", image_id).stream():
            batch.delete(d.reference)
    batch.commit()


def delete_images(project_id: str, dataset_id: str, image_ids: list[str]) -> None:
    for image_id in image_ids:
        ref = _sub(project_id, "images").document(image_id)
        snap = ref.get()
        if not snap.exists:
            continue
        if (snap.to_dict() or {}).get("datasetId") != dataset_id:
            continue
        _delete_image_annotations(project_id, image_id)
        ref.delete()
    recount_dataset_images(project_id, dataset_id)


def delete_dataset(project_id: str, dataset_id: str) -> None:
    for img in list_dataset_images(project_id, dataset_id):
        _delete_image_annotations(project_id, img["id"])
        _sub(project_id, "images").document(img["id"]).delete()
    _sub(project_id, "datasets").document(dataset_id).delete()


def dataset_review_files(project_id: str, dataset_id: str) -> list[dict]:
    """Images of a dataset, each with its annotation + objects (for review UI)."""
    images = list_dataset_images(project_id, dataset_id)
    images.sort(key=lambda i: i.get("createdAt", ""))
    annotations = {
        a["imageId"]: a
        for a in [_doc_dict(d) for d in _sub(project_id, "annotations").stream()]
        if a.get("imageId")
    }
    objects_by_image: dict[str, list[dict]] = {}
    for d in _sub(project_id, "annotationObjects").stream():
        obj = _doc_dict(d)
        objects_by_image.setdefault(obj.get("imageId"), []).append(obj)
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
    now = now_iso()
    ref = _sub(project_id, "models").document()
    payload = {
        "modelName": data["modelName"],
        "modelVersion": data.get("modelVersion", "1.0.0"),
        "modelType": data.get("modelType", "pytorch"),
        "hfRepo": data.get("hfRepo"),
        "hfPath": data.get("hfPath"),
        "classMapping": data.get("classMapping") or {},
        "fileSize": data.get("fileSize"),
        "description": data.get("description"),
        "createdAt": now,
        "updatedAt": now,
    }
    ref.set(payload)
    return {"id": ref.id, **payload}


def list_models(project_id: str) -> list[dict]:
    col = _sub(project_id, "models")
    try:
        return _stream_docs(col.order_by("updatedAt", direction="DESCENDING"), label="list_models")
    except Exception:
        return _stream_docs(col, label="list_models_fallback")


def get_model(project_id: str, model_id: str) -> dict | None:
    doc = _sub(project_id, "models").document(model_id).get()
    return _doc_dict(doc) if doc.exists else None


def delete_model(project_id: str, model_id: str) -> None:
    _sub(project_id, "models").document(model_id).delete()


# ---------------------------------------------------------------------------
# Labelling jobs
# ---------------------------------------------------------------------------

def get_labelling_job(project_id: str, job_id: str) -> dict | None:
    doc = _sub(project_id, "labellingJobs").document(job_id).get()
    return _doc_dict(doc) if doc.exists else None


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
    ref = _sub(project_id, "labellingJobs").document()
    now = now_iso()
    cfg = config or {}
    ref.set({
        "jobType": job_type,
        "datasetId": dataset_id,
        "modelId": model_id,
        "modelIds": model_ids or [],
        "confidenceThreshold": cfg.get("confidence", 0.25),
        "iouThreshold": cfg.get("iou", 0.45),
        "imageSize": cfg.get("image_size", 640),
        "lowLabelThreshold": cfg.get("low_label_threshold", 1),
        "config": cfg,
        "inputPayload": input_payload or {},
        "status": "queued",
        "progress": 0,
        "progressMessage": "Queued",
        "totalItems": total_items,
        "processedItems": 0,
        "createdAt": now,
    })
    _db().collection("jobRegistry").document(ref.id).set(
        {"projectId": project_id, "jobType": job_type, "createdAt": now}
    )
    return ref.id


def update_labelling_job(project_id: str, job_id: str, **fields) -> None:
    mapping = {
        "status": "status",
        "progress": "progress",
        "progress_message": "progressMessage",
        "processed_items": "processedItems",
        "result": "result",
        "error_message": "errorMessage",
        "total_items": "totalItems",
    }
    payload = {}
    for key, fire_key in mapping.items():
        if key in fields and fields[key] is not None:
            payload[fire_key] = fields[key]
    if fields.get("mark_started"):
        payload["startedAt"] = now_iso()
    if fields.get("mark_completed"):
        payload["completedAt"] = now_iso()
    if payload:
        _sub(project_id, "labellingJobs").document(job_id).update(payload)


# ---------------------------------------------------------------------------
# Annotations + annotation objects
# ---------------------------------------------------------------------------

def get_annotation_for_image(project_id: str, image_id: str) -> dict | None:
    snap = list(
        _sub(project_id, "annotations").where("imageId", "==", image_id).limit(1).stream()
    )
    return _doc_dict(snap[0]) if snap else None


def list_annotation_objects(project_id: str, image_id: str) -> list[dict]:
    snap = _sub(project_id, "annotationObjects").where("imageId", "==", image_id).stream()
    return [_doc_dict(d) for d in snap]


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
    """Persist annotation + annotationObjects (min/max box format expected)."""
    db = _db()
    now = now_iso()
    ann_col = _sub(project_id, "annotations")
    obj_col = _sub(project_id, "annotationObjects")

    existing = list(ann_col.where("imageId", "==", image_id).limit(1).stream())
    if existing:
        ann_ref = existing[0].reference
        ann_id = existing[0].id
        ann_ref.update({
            "jobId": job_id,
            "source": source,
            "reviewStatus": review_status,
            "autoLabeledAt": now if auto_labeled else None,
            "updatedAt": now,
        })
    else:
        ann_ref = ann_col.document()
        ann_id = ann_ref.id
        ann_ref.set({
            "imageId": image_id,
            "jobId": job_id,
            "status": "active",
            "source": source,
            "reviewStatus": review_status,
            "autoLabeledAt": now if auto_labeled else None,
            "createdAt": now,
            "updatedAt": now,
        })

    old_objs = list(obj_col.where("imageId", "==", image_id).stream())
    batch = db.batch()
    for o in old_objs:
        batch.delete(o.reference)
    for obj in objects:
        ref = obj_col.document()
        batch.set(ref, {
            "annotationId": ann_id,
            "imageId": image_id,
            "classId": obj.get("classId") or obj.get("project_class_id"),
            "classIndex": obj.get("classIndex", 0),
            "className": obj.get("className") or obj.get("class_name", "unknown"),
            "xMin": obj["xMin"],
            "yMin": obj["yMin"],
            "xMax": obj["xMax"],
            "yMax": obj["yMax"],
            "confidence": obj.get("confidence", 1.0),
            "source": source,
            "createdAt": now,
            "updatedAt": now,
        })
    batch.commit()
    return ann_id


def detections_to_objects(detections: list[dict]) -> list[dict]:
    """Convert YOLO center boxes (x,y,w,h) → min/max objects."""
    out: list[dict] = []
    for det in detections:
        x, y, w, h = det["x"], det["y"], det["width"], det["height"]
        half_w, half_h = w / 2, h / 2
        out.append({
            "classId": det.get("project_class_id"),
            "classIndex": det.get("class_index", 0),
            "className": det.get("class_name", "unknown"),
            "xMin": max(0.0, x - half_w),
            "yMin": max(0.0, y - half_h),
            "xMax": min(1.0, x + half_w),
            "yMax": min(1.0, y + half_h),
            "confidence": det.get("confidence", 1.0),
        })
    return out


def set_review_status(project_id: str, image_id: str, status: str) -> None:
    now = now_iso()
    ann = get_annotation_for_image(project_id, image_id)
    if ann:
        _sub(project_id, "annotations").document(ann["id"]).update({
            "reviewStatus": status,
            "reviewedAt": now,
            "updatedAt": now,
        })
    _sub(project_id, "images").document(image_id).update({
        "status": "reviewed" if status in ("approved", "rejected") else "labeled",
        "updatedAt": now,
    })


# ---------------------------------------------------------------------------
# Review queues
# ---------------------------------------------------------------------------

def update_image_queue(project_id: str, image_id: str, queue_type: str, reason: str) -> None:
    now = now_iso()
    _sub(project_id, "images").document(image_id).update(
        {"queueType": queue_type, "status": "labeled", "updatedAt": now}
    )
    _sub(project_id, "reviewQueues").document().set({
        "imageId": image_id,
        "queueType": queue_type,
        "reason": reason,
        "createdAt": now,
    })


def review_queue_counts(project_id: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for img in _sub(project_id, "images").stream():
        qt = (img.to_dict() or {}).get("queueType") or "unassigned"
        counts[qt] = counts.get(qt, 0) + 1
    return counts


def list_images_by_queue(project_id: str, queue_type: str | None = None) -> list[dict]:
    col = _sub(project_id, "images")
    snap = col.where("queueType", "==", queue_type).stream() if queue_type else col.stream()
    return [_doc_dict(d) for d in snap]


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
# Model comparison results / test runs
# ---------------------------------------------------------------------------

def create_test_run(project_id: str, data: dict) -> str:
    ref = _sub(project_id, "modelTestRuns").document()
    now = now_iso()
    ref.set({**data, "status": "queued", "createdAt": now, "updatedAt": now})
    return ref.id


def update_test_run(project_id: str, test_run_id: str, fields: dict) -> None:
    fields["updatedAt"] = now_iso()
    _sub(project_id, "modelTestRuns").document(test_run_id).update(fields)


def save_comparison_result(project_id: str, data: dict) -> str:
    ref = _sub(project_id, "modelComparisonResults").document()
    ref.set({**data, "createdAt": now_iso()})
    return ref.id


def list_comparison_results(project_id: str, test_run_id: str) -> list[dict]:
    snap = (
        _sub(project_id, "modelComparisonResults")
        .where("testRunId", "==", test_run_id)
        .stream()
    )
    return [_doc_dict(d) for d in snap]


# ---------------------------------------------------------------------------
# Export jobs
# ---------------------------------------------------------------------------

def create_export_job(project_id: str, export_format: str) -> str:
    ref = _sub(project_id, "exportJobs").document()
    now = now_iso()
    ref.set({
        "exportFormat": export_format,
        "status": "running",
        "hfRepo": None,
        "hfPath": None,
        "createdAt": now,
    })
    return ref.id


def complete_export_job(
    project_id: str, export_job_id: str, *, hf_repo: str, hf_path: str
) -> None:
    _sub(project_id, "exportJobs").document(export_job_id).update({
        "status": "completed",
        "hfRepo": hf_repo,
        "hfPath": hf_path,
        "completedAt": now_iso(),
    })


def fail_export_job(project_id: str, export_job_id: str, error: str) -> None:
    _sub(project_id, "exportJobs").document(export_job_id).update({
        "status": "failed",
        "errorMessage": error,
        "completedAt": now_iso(),
    })


def get_approved_export_data(project_id: str) -> list[dict]:
    """Return approved images with their annotation objects for export."""
    approved_image_ids = {
        a.to_dict()["imageId"]
        for a in _sub(project_id, "annotations")
        .where("reviewStatus", "==", "approved")
        .stream()
    }
    if not approved_image_ids:
        return []

    images = {d.id: _doc_dict(d) for d in _sub(project_id, "images").stream()}
    out: list[dict] = []
    for image_id in approved_image_ids:
        img = images.get(image_id)
        if not img:
            continue
        out.append({"image": img, "objects": list_annotation_objects(project_id, image_id)})
    return out
