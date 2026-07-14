"""Direct URL inference with temporary files only; no database/storage writes."""
from __future__ import annotations

import asyncio
import tempfile
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app.models.schemas import DetectionBox, JobConfig
from app.services.detection_merge import merge_detections
from app.services.storage import build_class_name_map, download_model, get_project_class_map
from app.services.yolo_inference import run_yolo_inference


async def check_stock_url(
    project_id: str,
    model_ids: list[str],
    image_url: str,
    confidence: float,
    iou: float,
) -> dict:
    parsed = urlparse(image_url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only http/https image URLs are supported")

    config = JobConfig(confidence=confidence, iou=iou, save_to_dataset=False)
    config.class_name_map = build_class_name_map(project_id, config.class_name_map)
    class_id_map = get_project_class_map(project_id)

    suffix = Path(parsed.path).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}:
        suffix = ".jpg"

    with tempfile.TemporaryDirectory(prefix="direct-stock-") as folder:
        image_path = Path(folder) / f"image{suffix}"
        async with httpx.AsyncClient(follow_redirects=True, timeout=45) as client:
            response = await client.get(image_url)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if content_type and not content_type.lower().startswith("image/"):
                raise ValueError("URL did not return an image")
            if len(response.content) > 25 * 1024 * 1024:
                raise ValueError("Image is larger than 25 MB")
            image_path.write_bytes(response.content)

        combined: list[DetectionBox] = []
        for model_id in model_ids:
            model_path = await asyncio.to_thread(download_model, str(model_id), project_id)
            inference = await asyncio.to_thread(
                run_yolo_inference,
                model_path,
                image_path,
                config,
                model_name=str(model_id),
                class_id_map=class_id_map,
            )
            combined.extend(inference.detections)

        detections = merge_detections(combined, iou_threshold=iou)
        detections = merge_detections(detections, iou_threshold=iou, class_agnostic=True)
        review_threshold = max(0.30, confidence + 0.10)
        counts = Counter(det.class_name for det in detections)
        review = Counter(det.class_name for det in detections if det.confidence < review_threshold)
        return {
            "url": image_url,
            "counts": dict(counts),
            "detections": [det.model_dump() for det in detections],
            "needs_review": dict(review),
            "possible_wrong": sum(review.values()),
            "review_threshold": review_threshold,
        }
