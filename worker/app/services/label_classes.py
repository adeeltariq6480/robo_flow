"""Helpers for mapping detections to project classes and YOLO label indices."""

from __future__ import annotations

import os

from app.models.schemas import DetectionBox

# Classes the worker must never auto-label (substring match, case-insensitive).
_DEFAULT_EXCLUDE_SUBSTRINGS = (
    "refrigerat",
    "fridge",
    "freezer",
    "cooler",
    "background",
    "unknown",
)


def excluded_class_substrings() -> tuple[str, ...]:
    raw = os.getenv("AUTO_LABEL_EXCLUDE_CLASSES", "")
    if not raw.strip():
        return _DEFAULT_EXCLUDE_SUBSTRINGS
    extra = tuple(
        part.strip().lower()
        for part in raw.split(",")
        if part.strip()
    )
    return _DEFAULT_EXCLUDE_SUBSTRINGS + extra


def is_excluded_detection_class(name: str) -> bool:
    lower = (name or "").strip().lower()
    if not lower:
        return True
    return any(sub in lower for sub in excluded_class_substrings())


def filter_saveable_detections(detections: list[DetectionBox]) -> list[DetectionBox]:
    """Keep only detections mapped to a real project class and not on the exclude list."""
    kept: list[DetectionBox] = []
    for det in detections:
        if not det.project_class_id:
            continue
        if is_excluded_detection_class(det.class_name):
            continue
        kept.append(det)
    return kept


def class_maps_for_project(project_id: str) -> tuple[dict[str, int], dict[str, int]]:
    """Return (class_name -> yolo_index, class_uuid -> yolo_index)."""
    from app.services import supabase_repo

    classes = supabase_repo.list_classes(project_id)
    by_name: dict[str, int] = {}
    by_id: dict[str, int] = {}
    for i, row in enumerate(classes):
        name = str(row.get("className") or "").strip()
        idx = int(row.get("classIndex", i) if row.get("classIndex") is not None else i)
        class_id = str(row["id"])
        if name:
            by_name[name] = idx
            compact = "".join(name.lower().split())
            if compact:
                by_name[compact] = idx
        by_id[class_id] = idx
    return by_name, by_id


def yolo_index_for_object(
    obj: dict,
    *,
    by_name: dict[str, int],
    by_id: dict[str, int],
) -> int | None:
    """Resolve YOLO class index — never default to 0 for unknown names."""
    class_id = obj.get("classId") or obj.get("class_id") or obj.get("project_class_id")
    if class_id and str(class_id) in by_id:
        return by_id[str(class_id)]

    name = str(obj.get("className") or obj.get("class_name") or "").strip()
    if not name:
        return None
    if name in by_name:
        return by_name[name]
    compact = "".join(name.lower().split())
    return by_name.get(compact)


def build_model_class_name_map(
    project_id: str,
    model_id: str,
    user_map: dict[str, str],
) -> dict[str, str]:
    """Merge per-model YOLO class names with project class names."""
    from app.services.storage import build_class_name_map
    from app.services.supabase_repo import get_model, get_project_class_map

    merged = dict(build_class_name_map(project_id, user_map))
    row = get_model(project_id, model_id)
    if not row:
        return merged

    project_names = set(get_project_class_map(project_id).keys())
    raw_mapping = row.get("classMapping") or row.get("class_mapping") or {}
    if not isinstance(raw_mapping, dict):
        return merged

    for yolo_key, project_name in raw_mapping.items():
        target = str(project_name).strip()
        if not target:
            continue
        if target in project_names:
            merged[str(yolo_key)] = target
            merged[str(yolo_key).strip().lower()] = target
    return merged
