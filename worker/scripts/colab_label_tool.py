#!/usr/bin/env python3
"""Temporary DB-free YOLO + reference-product labeling on Google Colab."""
from __future__ import annotations
import argparse, asyncio, io, json, sys, urllib.request
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
from scripts.product_matcher import ProductMatcher


def request_json(url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(request, timeout=180) as response: return json.loads(response.read().decode())


async def main(config_url: str) -> None:
    cfg = request_json(config_url); base = cfg["railway_url"].rstrip("/"); token = cfg["label_token"]
    update_url = f"{base}/api/label-tool-colab/update/{token}"
    request_json(update_url, {"status": "running", "message": "Loading reference matcher on Colab GPU"})
    matcher = ProductMatcher(cfg["references"], float(cfg["threshold"]))
    from app.services.stock_url_direct import check_stock_url
    model_ids = [value for value in cfg["model_ids"] if value]
    for index, target in enumerate(cfg["targets"]):
        try:
            result = await check_stock_url(cfg["project_id"], model_ids, target["url"], float(cfg["confidence"]), float(cfg["iou"]))
            with urllib.request.urlopen(target["url"], timeout=90) as response: image = Image.open(io.BytesIO(response.read())).convert("RGB")
            final = []
            for detection in result.get("detections", []):
                x, y, w, h = [float(detection[key]) for key in ("x", "y", "width", "height")]
                left, top = max(0, int((x-w/2)*image.width)), max(0, int((y-h/2)*image.height))
                right, bottom = min(image.width, int((x+w/2)*image.width)), min(image.height, int((y+h/2)*image.height))
                matched, score = matcher.match(image.crop((left, top, right, bottom)))
                final.append({**detection, "class_name": matched or detection["class_name"], "source": "reference_matcher" if matched else "yolo", "matcher_score": score, "original_yolo_class": detection["class_name"], "original_yolo_confidence": detection["confidence"]})
            payload = {"file_name": target["name"], "image_url": target["url"], "width": image.width, "height": image.height, "detections": final}
        except Exception as exc: payload = {"file_name": target["name"], "image_url": target["url"], "detections": [], "error": str(exc)}
        request_json(update_url, {"processed": index + 1, "message": f"Labeled {index+1}/{len(cfg['targets'])}", "result": payload})
    request_json(update_url, {"status": "completed", "processed": len(cfg["targets"]), "message": "Temporary labeling complete"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--config-url", required=True); args = parser.parse_args()
    asyncio.run(main(args.config_url))
