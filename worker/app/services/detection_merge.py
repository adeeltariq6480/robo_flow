"""Merge detections from multiple models (IoU NMS per class)."""

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


def merge_detections(
    detections: list[DetectionBox],
    iou_threshold: float = 0.5,
) -> list[DetectionBox]:
    """Keep highest-confidence box when same-class boxes overlap."""
    if len(detections) <= 1:
        return detections

    sorted_boxes = sorted(detections, key=lambda d: d.confidence, reverse=True)
    kept: list[DetectionBox] = []

    for box in sorted_boxes:
        suppress = False
        for existing in kept:
            same_class = (
                box.project_class_id
                and existing.project_class_id
                and box.project_class_id == existing.project_class_id
            ) or (
                box.class_name.lower() == existing.class_name.lower()
            )
            if same_class and _box_iou(box, existing) >= iou_threshold:
                suppress = True
                break
        if not suppress:
            kept.append(box)

    return kept
