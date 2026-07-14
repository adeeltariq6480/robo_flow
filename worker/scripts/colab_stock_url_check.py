#!/usr/bin/env python3
"""Run DB-free CSV URL stock inference on Colab and relay results in memory."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def request_json(url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.loads(response.read().decode())


async def main(config_url: str) -> None:
    cfg = request_json(config_url)
    base = cfg["railway_url"].rstrip("/")
    token = cfg["stock_token"]
    update_url = f"{base}/api/stock-colab/update/{token}"
    urls = cfg["image_urls"]
    model_ids = [value for value in cfg["model_ids"].split(",") if value]
    request_json(update_url, {"status": "running", "message": "Colab GPU connected — loading models"})

    from app.services.stock_url_direct import check_stock_url
    for index, image_url in enumerate(urls):
        try:
            result = await check_stock_url(cfg["project_id"], model_ids, image_url, cfg["confidence"], cfg["iou"])
        except Exception as exc:
            result = {"url": image_url, "counts": {}, "detections": [], "needs_review": {}, "possible_wrong": 0, "error": str(exc)}
        request_json(update_url, {"processed": index + 1, "message": f"Checked {index + 1}/{len(urls)}", "result": result})
        print(f"Checked {index + 1}/{len(urls)}")

    request_json(update_url, {"status": "completed", "processed": len(urls), "message": "Completed on Colab GPU"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config-url", required=True)
    args = parser.parse_args()
    try:
        asyncio.run(main(args.config_url))
    except Exception as exc:
        print("Stock check failed:", exc)
        raise
