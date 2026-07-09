"""Merge detections from multiple models (IoU NMS per class + per-object dedupe)."""

from app.models.schemas import DetectionBox


def _box_iou(a: DetectionBox, b: DetectionBox) -> float:
    aw, ah = a.width, a.height
    bw, bh = b.width, b.height
    ax1, ay1 = a.x - aw / 2, a.y - ah / 2
    ax2, ay2 = a.x + aw / 2, a.y + ah / 2
    bx1, by1 = b.x - bw / 2, b.y - bh / 2
    bx2, by2 = b.x + bw / 2, b.y + bh / 2

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area_a = aw * ah
    area_b = bw * bh
    union = area_a + area_b - inter_area
    if union <= 0:
        return 0.0
    return inter_area / union


def _object_dict_iou(a: dict, b: dict) -> float:
    ax1, ay1, ax2, ay2 = a["xMin"], a["yMin"], a["xMax"], a["yMax"]
    bx1, by1, bx2, by2 = b["xMin"], b["yMin"], b["xMax"], b["yMax"]

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter_area
    if union <= 0:
        return 0.0
    return inter_area / union


def _same_detection_class(a: DetectionBox, b: DetectionBox) -> bool:
    if (
        a.project_class_id
        and b.project_class_id
        and a.project_class_id == b.project_class_id
    ):
        return True
    return a.class_name.lower() == b.class_name.lower()


def merge_detections(
    detections: list[DetectionBox],
    iou_threshold: float = 0.5,
    *,
    class_agnostic: bool = False,
) -> list[DetectionBox]:
    """Suppress overlapping boxes — keep highest-confidence detection per object."""
    if len(detections) <= 1:
        return detections

    sorted_boxes = sorted(detections, key=lambda d: d.confidence, reverse=True)
    kept: list[DetectionBox] = []

    for box in sorted_boxes:
        suppress = False
        for existing in kept:
            same_class = _same_detection_class(box, existing)
            if class_agnostic or same_class:
                if _box_iou(box, existing) >= iou_threshold:
                    suppress = True
                    break
        if not suppress:
            kept.append(box)

    return kept


def dedupe_objects(
    objects: list[dict],
    iou_threshold: float = 0.45,
) -> list[dict]:
    """Keep one annotation box per overlapping object (class-agnostic NMS)."""
    if len(objects) <= 1:
        return objects

    sorted_objs = sorted(
        objects,
        key=lambda o: float(o.get("confidence", 1.0)),
        reverse=True,
    )
    kept: list[dict] = []
    for obj in sorted_objs:
        if any(_object_dict_iou(obj, existing) >= iou_threshold for existing in kept):
            continue
        kept.append(obj)
    return kept
