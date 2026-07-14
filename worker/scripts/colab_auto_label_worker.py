#!/usr/bin/env python3
"""
Google Colab auto-label worker — polls Supabase and runs YOLO locally.

Railway API creates labelling_jobs with status=queued (RUN_AUTO_LABEL_WORKER=false).
This script claims those jobs and does all heavy AI work on Colab GPU.

Hugging Face layout:
  Images: datasets/{project_id}/{dataset_id}/images/{file_name}
  Labels: datasets/{project_id}/{dataset_id}/labels/{image_stem}.txt
  Models: models/{project_id}/{model_file_name}

Colab setup:
  !pip install ultralytics torch torchvision opencv-python-headless pillow supabase huggingface_hub python-dotenv
  %cd /content/robo_flow/worker   # after cloning repo
  # set env vars (or use Colab Secrets), then:
  !python scripts/colab_auto_label_worker.py

Env (Colab):
  SUPABASE_URL=...
  SUPABASE_SERVICE_ROLE_KEY=...
  HF_TOKEN=...
  HF_DATASET_REPO=Adeel6480/robo_flow
  HF_DATASET_REPO_TYPE=dataset
  HF_MODEL_REPO=Adeel6480/robo_flow
  HF_MODEL_REPO_TYPE=model
  WORKER_LOOP=true          # keep polling every POLL_SECONDS
  POLL_SECONDS=10
  RUN_AUTO_LABEL_WORKER=true  # allow process_job / YOLO here
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any

WORKER_ROOT = Path(__file__).resolve().parents[1]
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("colab_auto_label_worker")

# Image statuses skipped when relabel_all is false
_SKIP_IMAGE_STATUS = frozenset(
    {"labeled", "reviewed", "approved", "rejected", "auto_labeled"}
)


def _apply_colab_env_defaults() -> None:
    defaults = {
        "DEPLOY_TARGET": "colab",
        "LOCAL_STORAGE_ENABLED": "false",
        "AUTO_LABEL_USE_LOCAL_IMAGES": "false",
        "LOW_MEMORY_MODE": "false",
        "MEMORY_SOFT_LIMIT_MB": "10000",
        "MEMORY_HARD_LIMIT_MB": "12000",
        "AUTO_LABEL_KEEP_ALL_MODELS": "true",
        "MODEL_UNLOAD_EVERY_IMAGES": "0",
        "HF_UPLOAD_ENABLED": "true",
        "AUTO_COMMIT_AFTER_LABELS": "true",
        "AUTO_LABEL_SYNC_HF_BEFORE_START": "false",
        "UNIVERSAL_MODEL_LOAD": "true",
        "RUN_AUTO_LABEL_WORKER": "true",
        "DISABLE_MODEL_PREWARM": "false",
    }
    for key, value in defaults.items():
        os.environ.setdefault(key, value)


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _require_env() -> None:
    missing = [
        k
        for k in (
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "HF_TOKEN",
            "HF_DATASET_REPO",
            "HF_MODEL_REPO",
        )
        if not _env(k)
    ]
    if missing:
        raise SystemExit(f"Missing required env: {', '.join(missing)}")


# ---------------------------------------------------------------------------
# Helpers (public API for notebook / tests)
# ---------------------------------------------------------------------------

def get_supabase_client():
    """Return supabase client (uses app settings after env applied)."""
    from app.services.supabase_repo import _sb

    return _sb()


def get_next_queued_job() -> dict | None:
    """Peek oldest queued auto_label job (does not claim)."""
    from app.services.supabase_repo import _job_row, _sb

    res = (
        _sb()
        .table("labelling_jobs")
        .select("*")
        .eq("job_type", "auto_label")
        .eq("status", "queued")
        .order("created_at", desc=False)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return _job_row(rows[0]) if rows else None


def mark_job_running(project_id: str, job_id: str, message: str = "Running on Colab") -> bool:
    """Safe lock: only transitions queued → running. Returns True if claimed."""
    from app.services.supabase_repo import now_iso, _sb

    res = (
        _sb()
        .table("labelling_jobs")
        .update(
            {
                "status": "running",
                "progress_message": message,
                "started_at": now_iso(),
            }
        )
        .eq("id", job_id)
        .eq("project_id", project_id)
        .eq("status", "queued")
        .execute()
    )
    return bool(res.data)


def mark_job_failed(project_id: str, job_id: str, error_message: str) -> None:
    from app.services.supabase_repo import now_iso, update_labelling_job

    update_labelling_job(
        project_id,
        job_id,
        status="failed",
        progress_message="Failed",
        error_message=error_message[:2000],
        mark_completed=True,
    )


def mark_job_completed(project_id: str, job_id: str, result: dict | None = None) -> None:
    from app.services.supabase_repo import update_labelling_job

    update_labelling_job(
        project_id,
        job_id,
        status="completed",
        progress=100,
        progress_message="Completed",
        result=result or {},
        mark_completed=True,
    )


def update_job_progress(
    project_id: str,
    job_id: str,
    *,
    progress: int | None = None,
    progress_message: str | None = None,
    processed_items: int | None = None,
    total_items: int | None = None,
) -> None:
    from app.services.supabase_repo import update_labelling_job

    update_labelling_job(
        project_id,
        job_id,
        progress=progress,
        progress_message=progress_message,
        processed_items=processed_items,
        total_items=total_items,
    )


def get_model_row(project_id: str, model_id: str) -> dict | None:
    from app.services.supabase_repo import get_model

    return get_model(project_id, model_id)


def list_dataset_images_for_job(
    project_id: str,
    dataset_id: str,
    *,
    relabel_all: bool = False,
) -> list[dict]:
    """Images for this job; skip already-labeled unless relabel_all."""
    from app.services.supabase_repo import attach_annotation_fields_to_images, list_dataset_images

    images = list_dataset_images(project_id, dataset_id)
    images = attach_annotation_fields_to_images(project_id, images)
    if relabel_all:
        return images

    out: list[dict] = []
    for img in images:
        status = str(img.get("status") or "").strip().lower().replace("-", "_")
        review = str(
            img.get("reviewStatus") or img.get("review_status") or ""
        ).strip().lower()
        if status in _SKIP_IMAGE_STATUS:
            continue
        if review in {"approved", "rejected", "reviewed"}:
            continue
        out.append(img)
    return out


def download_hf_file(
    repo_id: str,
    path_in_repo: str,
    *,
    repo_type: str,
    local_dir: Path | None = None,
) -> Path:
    from app.services.hf_storage import download_to_local

    path = download_to_local(
        repo_id,
        path_in_repo,
        repo_type=repo_type,
        local_name=Path(path_in_repo).name if local_dir is None else None,
    )
    if local_dir is not None:
        local_dir.mkdir(parents=True, exist_ok=True)
        dest = local_dir / Path(path_in_repo).name
        if path.resolve() != dest.resolve():
            dest.write_bytes(path.read_bytes())
            return dest
    return path


def run_yolo_on_image(
    model_path: Path,
    image_path: Path,
    *,
    confidence: float = 0.15,
    iou: float = 0.45,
    project_id: str | None = None,
    model_id: str | None = None,
) -> list[dict]:
    """Run YOLO and return detection dicts (normalized boxes)."""
    from app.models.schemas import JobConfig
    from app.services.yolo_inference import run_yolo_inference

    config = JobConfig(confidence=confidence, iou=iou, save_to_dataset=True)
    if project_id and model_id:
        from app.services.label_classes import build_model_class_name_map

        config = config.model_copy(
            update={
                "class_name_map": build_model_class_name_map(project_id, model_id, None)
            }
        )
    result = run_yolo_inference(model_path, image_path, config)
    return [d.model_dump() for d in result.detections]


def save_annotations(
    project_id: str,
    image_id: str,
    detections: list[dict],
    *,
    job_id: str | None = None,
) -> str:
    from app.services.supabase_repo import detections_to_objects, save_image_annotations, update_image_status

    objects = detections_to_objects(detections)
    ann_id = save_image_annotations(
        project_id,
        image_id,
        objects,
        job_id=job_id,
        source="auto",
        auto_labeled=True,
    )
    update_image_status(project_id, image_id, "labeled")
    return ann_id


def upload_label_to_hf(
    project_id: str,
    dataset_id: str,
    image_stem: str,
    label_text: str,
) -> dict:
    """Upload one YOLO .txt under datasets/{project}/{dataset}/labels/."""
    from app.config import settings
    from app.services import hf_storage as file_storage

    path_in_repo = f"datasets/{project_id}/{dataset_id}/labels/{image_stem}.txt"
    return file_storage.upload_bytes(
        label_text.encode("utf-8"),
        repo_type=settings.dataset_repo_type,
        path_in_repo=path_in_repo,
        commit_message=f"Colab label {image_stem}",
    )


def detections_to_yolo_txt(detections: list[dict], project_id: str) -> str:
    from app.services.label_classes import class_maps_for_project, yolo_index_for_object
    from app.services.supabase_repo import detections_to_objects

    objects = detections_to_objects(detections)
    by_name, by_id = class_maps_for_project(project_id)
    lines: list[str] = []
    for o in objects:
        cls_idx = yolo_index_for_object(o, by_name=by_name, by_id=by_id)
        if cls_idx is None:
            continue
        xc = (o["xMin"] + o["xMax"]) / 2
        yc = (o["yMin"] + o["yMax"]) / 2
        w = o["xMax"] - o["xMin"]
        h = o["yMax"] - o["yMin"]
        lines.append(f"{cls_idx} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")
    return "\n".join(lines) + ("\n" if lines else "")


# ---------------------------------------------------------------------------
# Job execution
# ---------------------------------------------------------------------------

async def process_claimed_job(job: dict) -> dict:
    """
    Prefer full worker pipeline (multi-model merge, blur skip, HF batch labels).
    Falls back to a simple single-model loop if process_job is unavailable.
    """
    from app.core.jobs import process_job, register_job_project
    from app.services.supabase_repo import get_labelling_job

    job_id = str(job["id"])
    project_id = str(job.get("projectId") or job.get("project_id") or "")
    if not project_id:
        # claim path may only have id — look up registry
        from app.services.supabase_repo import get_job_registry_project

        project_id = get_job_registry_project(job_id) or ""
    if not project_id:
        raise RuntimeError(f"No project_id for job {job_id}")

    # Re-read full row after claim (process_job expects status running/queued ok)
    row = get_labelling_job(project_id, job_id) or job
    register_job_project(job_id, project_id)

    logger.info(
        "Processing job %s project=%s dataset=%s models=%s",
        job_id,
        project_id,
        row.get("datasetId"),
        row.get("modelIds") or [row.get("modelId")],
    )

    # process_job will set running again (harmless) and run run_auto_label
    await process_job(job_id)

    final = get_labelling_job(project_id, job_id) or {}
    return {
        "job_id": job_id,
        "status": final.get("status"),
        "result": final.get("result"),
        "error": final.get("errorMessage"),
    }


async def claim_and_run_one() -> bool:
    """Claim one queued job and process it. Returns True if a job was found."""
    from app.services.supabase_repo import claim_next_queued_auto_label_job

    job = await asyncio.to_thread(claim_next_queued_auto_label_job)
    if not job:
        logger.info("No queued auto_label jobs")
        return False

    job_id = str(job["id"])
    project_id = str(job.get("projectId") or "")
    if not project_id:
        from app.services.supabase_repo import get_job_registry_project

        project_id = get_job_registry_project(job_id) or ""

    logger.info("Claimed job %s", job_id)
    try:
        outcome = await process_claimed_job(job)
        logger.info("Job done: %s", outcome)
    except Exception as exc:
        logger.exception("Job %s failed: %s", job_id, exc)
        if project_id:
            await asyncio.to_thread(
                mark_job_failed, project_id, job_id, f"{exc}\n{traceback.format_exc()}"
            )
        raise
    return True


async def run_worker_loop() -> int:
    loop = _env("WORKER_LOOP", "true").lower() in {"1", "true", "yes", "on"}
    poll_seconds = float(_env("POLL_SECONDS", "10") or "10")

    if not loop:
        await claim_and_run_one()
        return 0

    logger.info("WORKER_LOOP=true — polling every %ss", poll_seconds)
    while True:
        try:
            found = await claim_and_run_one()
            if not found:
                await asyncio.sleep(poll_seconds)
        except KeyboardInterrupt:
            logger.info("Stopped by user")
            return 0
        except Exception:
            logger.exception("Worker iteration failed — retrying in %ss", poll_seconds)
            await asyncio.sleep(poll_seconds)


def main() -> None:
    _apply_colab_env_defaults()
    _require_env()

    # Force settings reload-friendly env before app imports densify
    os.environ["RUN_AUTO_LABEL_WORKER"] = "true"

    print("=" * 60)
    print("Robo Flow — Colab auto-label worker")
    print(f"Dataset repo: {_env('HF_DATASET_REPO')}")
    print(f"Model repo:   {_env('HF_MODEL_REPO')}")
    print(f"WORKER_LOOP:  {_env('WORKER_LOOP', 'true')}")
    print("=" * 60)

    raise SystemExit(asyncio.run(run_worker_loop()))


if __name__ == "__main__":
    main()
