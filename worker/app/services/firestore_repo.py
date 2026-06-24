"""Firestore data access for the Python worker."""

from datetime import datetime, timezone
from uuid import UUID, uuid4

from app.services.firebase_client import get_db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _project_ref(project_id: str):
    return get_db().collection("projects").document(project_id)


def get_labelling_job(project_id: str, job_id: str) -> dict | None:
    doc = (
        _project_ref(project_id)
        .collection("labellingJobs")
        .document(job_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


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
    ref = _project_ref(project_id).collection("labellingJobs").document()
    now = _now()
    data = {
        "jobType": job_type,
        "datasetId": dataset_id,
        "modelId": model_id,
        "modelIds": model_ids or [],
        "confidenceThreshold": (config or {}).get("confidence", 0.25),
        "iouThreshold": (config or {}).get("iou", 0.45),
        "imageSize": (config or {}).get("image_size", 640),
        "lowLabelThreshold": (config or {}).get("low_label_threshold", 1),
        "config": config or {},
        "inputPayload": input_payload or {},
        "status": "queued",
        "progress": 0,
        "progressMessage": "Queued",
        "totalItems": total_items,
        "processedItems": 0,
        "createdAt": now,
    }
    ref.set(data)
    get_db().collection("jobRegistry").document(ref.id).set(
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
        payload["startedAt"] = _now()
    if fields.get("mark_completed"):
        payload["completedAt"] = _now()
    if payload:
        _project_ref(project_id).collection("labellingJobs").document(job_id).update(
            payload
        )


def list_dataset_images(project_id: str, dataset_id: str) -> list[dict]:
    snap = (
        _project_ref(project_id)
        .collection("images")
        .where("datasetId", "==", dataset_id)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in snap]


def get_image(project_id: str, image_id: str) -> dict | None:
    doc = _project_ref(project_id).collection("images").document(image_id).get()
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


def get_model(project_id: str, model_id: str) -> dict | None:
    doc = _project_ref(project_id).collection("models").document(model_id).get()
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


def list_classes(project_id: str) -> list[dict]:
    snap = (
        _project_ref(project_id)
        .collection("classes")
        .order_by("classIndex")
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in snap]


def get_project_class_map(project_id: str) -> dict[str, str]:
    return {c["className"]: c["id"] for c in list_classes(project_id)}


def save_image_annotations(
    project_id: str,
    image_id: str,
    detections: list[dict],
    *,
    job_id: str | None = None,
    source: str = "auto",
    auto_labeled: bool = True,
) -> None:
    """Persist annotations + annotationObjects for an image."""
    db = get_db()
    now = _now()
    proj = _project_ref(project_id)
    ann_col = proj.collection("annotations")
    obj_col = proj.collection("annotationObjects")

    existing = list(ann_col.where("imageId", "==", image_id).limit(1).stream())
    if existing:
        ann_ref = existing[0].reference
        ann_id = existing[0].id
        ann_ref.update(
            {
                "jobId": job_id,
                "source": source,
                "reviewStatus": "pending" if auto_labeled else None,
                "autoLabeledAt": now if auto_labeled else None,
                "updatedAt": now,
            }
        )
    else:
        ann_ref = ann_col.document()
        ann_id = ann_ref.id
        ann_ref.set(
            {
                "imageId": image_id,
                "jobId": job_id,
                "status": "active",
                "source": source,
                "reviewStatus": "pending" if auto_labeled else None,
                "autoLabeledAt": now if auto_labeled else None,
                "createdAt": now,
                "updatedAt": now,
            }
        )

    old_objs = list(obj_col.where("imageId", "==", image_id).stream())
    batch = db.batch()
    for o in old_objs:
        batch.delete(o.reference)

    for det in detections:
        x, y, w, h = det["x"], det["y"], det["width"], det["height"]
        half_w, half_h = w / 2, h / 2
        obj_ref = obj_col.document()
        batch.set(
            obj_ref,
            {
                "annotationId": ann_id,
                "imageId": image_id,
                "classId": det.get("project_class_id"),
                "classIndex": 0,
                "className": det.get("class_name", "unknown"),
                "xMin": max(0, x - half_w),
                "yMin": max(0, y - half_h),
                "xMax": min(1, x + half_w),
                "yMax": min(1, y + half_h),
                "confidence": det.get("confidence", 1.0),
                "source": source,
                "createdAt": now,
                "updatedAt": now,
            },
        )
    batch.commit()


def update_image_queue(
    project_id: str,
    image_id: str,
    queue_type: str,
    reason: str,
) -> None:
    now = _now()
    _project_ref(project_id).collection("images").document(image_id).update(
        {"queueType": queue_type, "updatedAt": now}
    )
    _project_ref(project_id).collection("reviewQueues").document().set(
        {
            "imageId": image_id,
            "queueType": queue_type,
            "reason": reason,
            "createdAt": now,
        }
    )


def classify_queue(
    detections: list[dict],
    *,
    confidence: float,
    low_label_threshold: int,
    per_model: dict[str, int] | None = None,
) -> tuple[str, str]:
    """Return (queueType, reason)."""
    count = len(detections)
    if count == 0:
        return "no_label", "Zero detections"
    if count <= low_label_threshold:
        return "low_label", f"Only {count} detection(s)"
    low_conf = [d for d in detections if d.get("confidence", 1) < confidence]
    if low_conf:
        return "low_confidence", f"{len(low_conf)} low-confidence label(s)"
    if per_model and len(per_model) > 1:
        vals = list(per_model.values())
        if max(vals) - min(vals) > max(1, count // 2):
            return "conflict", "Models disagree on detection count"
    return "good", "Sufficient confident labels"


def count_dataset_images(project_id: str, dataset_id: str) -> int:
    snap = (
        _project_ref(project_id)
        .collection("images")
        .where("datasetId", "==", dataset_id)
        .count()
        .get()
    )
    return snap[0][0].value
