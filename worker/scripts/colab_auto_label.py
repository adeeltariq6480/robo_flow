#!/usr/bin/env python3
"""
Run auto-label on Google Colab (GPU). Falls back to Railway if Colab fails.

Images + models from Hugging Face; labels → Supabase + HF.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[1]
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

DEFAULT_RAILWAY_URL = "https://roboflow-production.up.railway.app"


def _is_colab() -> bool:
    try:
        import google.colab  # noqa: F401

        return True
    except ImportError:
        return False


def _apply_colab_defaults() -> None:
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
    }
    for key, value in defaults.items():
        os.environ.setdefault(key, value)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Colab auto-label with Railway fallback")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--model-ids", required=True)
    parser.add_argument("--confidence", type=float, default=0.15)
    parser.add_argument("--iou", type=float, default=0.45)
    parser.add_argument("--relabel", action="store_true")
    parser.add_argument("--job-id", default=os.getenv("COLAB_JOB_ID", ""))
    parser.add_argument("--hf-token", default=os.getenv("HF_TOKEN", ""))
    parser.add_argument(
        "--supabase-url",
        default=os.getenv("SUPABASE_URL", "") or os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""),
    )
    parser.add_argument("--supabase-key", default=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
    parser.add_argument("--hf-dataset-repo", default=os.getenv("HF_DATASET_REPO", ""))
    parser.add_argument("--hf-model-repo", default=os.getenv("HF_MODEL_REPO", ""))
    parser.add_argument(
        "--railway-url",
        default=os.getenv("WORKER_API_URL", "") or os.getenv("RAILWAY_WORKER_URL", "") or DEFAULT_RAILWAY_URL,
        help="Railway worker URL for automatic fallback",
    )
    parser.add_argument(
        "--worker-api-key",
        default=os.getenv("WORKER_API_KEY", ""),
        help="Same key as Railway WORKER_API_KEY (if set)",
    )
    parser.add_argument(
        "--railway-only",
        action="store_true",
        help="Skip Colab; queue job on Railway immediately",
    )
    parser.add_argument(
        "--no-railway-fallback",
        action="store_true",
        help="Do not fall back to Railway if Colab fails",
    )
    return parser.parse_args()


def _apply_secrets(args: argparse.Namespace) -> None:
    if args.hf_token:
        os.environ["HF_TOKEN"] = args.hf_token
    if args.supabase_url:
        os.environ["SUPABASE_URL"] = args.supabase_url
    if args.supabase_key:
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = args.supabase_key
    if args.hf_dataset_repo:
        os.environ["HF_DATASET_REPO"] = args.hf_dataset_repo
    if args.hf_model_repo:
        os.environ["HF_MODEL_REPO"] = args.hf_model_repo

    missing = [
        name
        for name, val in [
            ("SUPABASE_URL", os.getenv("SUPABASE_URL")),
            ("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
            ("HF_TOKEN", os.getenv("HF_TOKEN")),
            ("HF_DATASET_REPO", os.getenv("HF_DATASET_REPO")),
            ("HF_MODEL_REPO", os.getenv("HF_MODEL_REPO")),
        ]
        if not (val or "").strip()
    ]
    if missing:
        raise SystemExit(f"Missing required secrets: {', '.join(missing)}")


def _model_id_list(args: argparse.Namespace) -> list[str]:
    model_ids = [mid.strip() for mid in args.model_ids.split(",") if mid.strip()]
    if not model_ids:
        raise SystemExit("Provide at least one model id in --model-ids")
    return model_ids


def _submit_railway_job(args: argparse.Namespace) -> dict:
    """Queue auto-label via Railway API (creates Supabase job; Colab worker runs YOLO)."""
    model_ids = _model_id_list(args)
    base = (args.railway_url or DEFAULT_RAILWAY_URL).rstrip("/")
    url = f"{base}/jobs/auto-label"
    body = {
        "project_id": args.project_id,
        "dataset_id": args.dataset_id,
        "model_id": model_ids[0],
        "model_ids": model_ids,
        "relabel_all": args.relabel,
        "config": {
            "confidence": args.confidence,
            "iou": args.iou,
            "save_to_dataset": True,
            "relabel_all": args.relabel,
        },
    }
    data = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if args.worker_api_key:
        headers["X-Worker-Key"] = args.worker_api_key

    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Railway returned {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cannot reach Railway at {base}: {exc}") from exc


async def _run_colab_session(args: argparse.Namespace) -> str:
    from app.core.jobs import create_job_record, process_job, register_job_project, update_job
    from app.models.schemas import JobConfig, JobStatus, JobType
    from app.services.auto_label import get_dataset_label_stats
    from app.services.supabase_repo import get_labelling_job

    model_ids = _model_id_list(args)
    stats = await asyncio.to_thread(
        get_dataset_label_stats, args.project_id, args.dataset_id
    )
    scope_count = stats["already_labeled"] if args.relabel else stats["unlabeled"]
    mode = "relabel already labeled" if args.relabel else "label unlabeled"

    print(f"Dataset stats: total={stats['total']} unlabeled={stats['unlabeled']} "
          f"already_labeled={stats['already_labeled']}")
    print(f"Mode: {mode} → {scope_count} image(s)")

    if scope_count == 0:
        print("Nothing to process.")
        if args.job_id:
            await update_job(
                args.job_id,
                status=JobStatus.FAILED,
                progress_message="Nothing to process",
                error_message="No images matched the selected label mode",
                project_id=args.project_id,
            )
        return ""

    config = JobConfig(
        confidence=args.confidence,
        iou=args.iou,
        save_to_dataset=True,
        relabel_all=args.relabel,
    )

    job_id = (args.job_id or "").strip()
    if job_id:
        existing = await asyncio.to_thread(
            get_labelling_job, args.project_id, job_id
        )
        if not existing:
            raise RuntimeError(f"Pre-created job not found: {job_id}")
        register_job_project(job_id, args.project_id)
        await update_job(
            job_id,
            status=JobStatus.QUEUED,
            progress=0,
            progress_message="Colab connected — installing and loading models…",
            total_items=scope_count,
            project_id=args.project_id,
        )
        print(f"Using pre-created job id: {job_id}")
    else:
        job_id = await create_job_record(
            args.project_id,
            JobType.AUTO_LABEL,
            model_id=model_ids[0],
            model_ids=model_ids,
            dataset_id=args.dataset_id,
            config=config,
            input_payload={"model_ids": model_ids, "relabel_all": args.relabel},
            total_items=scope_count,
        )
        register_job_project(job_id, args.project_id)

    print()
    print("=" * 60)
    print("Running on Colab / local GPU")
    print(f"Job id: {job_id}")
    print("Watch progress in your Vercel app (Inference / Label page)")
    print("=" * 60)
    print()

    await process_job(job_id)
    return job_id


async def _run_with_fallback(args: argparse.Namespace) -> int:
    if args.railway_only:
        print("Queue-only — creating Supabase job via Railway API (no local YOLO).")
        result = await asyncio.to_thread(_submit_railway_job, args)
        print(f"Queued: job_id={result.get('job_id')}")
        print(f"Message: {result.get('message', '')}")
        print("Process with: python scripts/colab_auto_label_worker.py")
        return 0

    if not _is_colab():
        print("Not inside Colab — queueing on Railway API for Colab worker.")
        result = await asyncio.to_thread(_submit_railway_job, args)
        print(f"Queued: job_id={result.get('job_id')}")
        print(f"Message: {result.get('message', '')}")
        print("Run scripts/colab_auto_label_worker.py on Colab to process.")
        return 0

    try:
        job_id = await _run_colab_session(args)
        if job_id:
            print(f"Colab session done. Job id: {job_id}")
        return 0
    except Exception as exc:
        print()
        print(f"Colab failed: {exc}")
        if args.job_id:
            try:
                from app.core.jobs import update_job
                from app.models.schemas import JobStatus

                await update_job(
                    args.job_id,
                    status=JobStatus.FAILED,
                    progress_message="Colab failed",
                    error_message=str(exc),
                    project_id=args.project_id,
                )
            except Exception:
                pass
        if args.no_railway_fallback:
            print("Fallback disabled (--no-railway-fallback).")
            raise

        print()
        print("=" * 60)
        print("Fallback: re-queue on Railway API (YOLO not run on Railway)")
        print("Then run: python scripts/colab_auto_label_worker.py")
        print(f"URL: {args.railway_url}")
        print("=" * 60)
        try:
            result = await asyncio.to_thread(_submit_railway_job, args)
            print(f"Queued: job_id={result.get('job_id')}")
            print(f"Message: {result.get('message', '')}")
            return 0
        except Exception as railway_exc:
            print(f"Queue also failed: {railway_exc}")
            raise


def main() -> None:
    _apply_colab_defaults()
    os.environ["RUN_AUTO_LABEL_WORKER"] = "true"
    args = _parse_args()
    _apply_secrets(args)
    raise SystemExit(asyncio.run(_run_with_fallback(args)))


if __name__ == "__main__":
    main()
