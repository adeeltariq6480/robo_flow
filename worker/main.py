import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import api_router, jobs_router
from app.config import settings
from app.core.jobs import process_job
from app.core.queue import queue_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Always start queue: test-run + model-compare need it.
    # Auto-label is skipped locally when RUN_AUTO_LABEL_WORKER=false (Colab handles it).
    queue_manager.set_processor(process_job)
    await queue_manager.start()
    if settings.run_auto_label_worker:
        logger.info("Local job queue started (includes auto-label)")
    else:
        logger.info(
            "Job queue started for test-run/compare only "
            "(RUN_AUTO_LABEL_WORKER=false — auto-label via Colab)"
        )
    if not settings.supabase_configured:
        logger.warning("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — API will fail")
    if not settings.hf_configured:
        logger.warning(
            "HF_TOKEN / HF_DATASET_REPO / HF_MODEL_REPO not set — uploads will fail"
        )
    # Log Hugging Face upload configuration
    try:
        logger.info("RUN_AUTO_LABEL_WORKER=%s", settings.run_auto_label_worker)
        logger.info("DISABLE_MODEL_PREWARM=%s", settings.disable_model_prewarm)
        logger.info("HF_UPLOAD_ENABLED=%s", settings.hf_upload_enabled)
        logger.info("HF_TOKEN present=%s", bool(settings.hf_token and settings.hf_token.strip()))
        logger.info("HF_DATASET_REPO=%s", settings.dataset_repo_id or None)
        logger.info("HF_MODEL_REPO=%s", settings.model_repo_id or None)
        logger.info("HF dataset upload repo_type=%s (images)", settings.dataset_repo_type)
        logger.info("HF model upload repo_type=%s (weights)", settings.model_repo_type)
        if settings.dataset_repo_type != "dataset":
            logger.warning(
                "HF_DATASET_REPO_TYPE=%s — image uploads should use repo_type=dataset. "
                "Set HF_DATASET_REPO_TYPE=dataset on Railway.",
                settings.dataset_repo_type,
            )
        if (
            settings.hf_model_repo
            and settings.hf_dataset_repo
            and settings.hf_model_repo != settings.hf_dataset_repo
            and settings.model_repo_type != "model"
        ):
            logger.warning(
                "HF_MODEL_REPO_TYPE=%s — model weights should use repo_type=model when "
                "HF_MODEL_REPO is separate from HF_DATASET_REPO.",
                settings.model_repo_type,
            )
        logger.info("HF_AUTO_CREATE_REPO=%s", settings.hf_auto_create_repo)
        if settings.dataset_repo_id and settings.model_repo_id:
            if settings.dataset_repo_id == settings.model_repo_id:
                logger.info(
                    "HF dual-namespace repo %s: images use repo_type=%s, models use repo_type=%s",
                    settings.dataset_repo_id,
                    settings.dataset_repo_type,
                    settings.model_repo_type,
                )
            else:
                logger.info(
                    "Split HF repos: images→%s (%s), models→%s (%s)",
                    settings.dataset_repo_id,
                    settings.dataset_repo_type,
                    settings.model_repo_id,
                    settings.model_repo_type,
                )
        # YOLO runtime settings (informational — not loaded when API-only)
        import os
        logger.info("ENABLE_YOLOV5_RUNTIME=%s", os.getenv("ENABLE_YOLOV5_RUNTIME", "false"))
        logger.info("YOLOV5_REPO_REF=%s", os.getenv("YOLOV5_REPO_REF", "v6.2"))
    except Exception:
        logger.exception("Failed to log HF startup configuration")
    logger.info("Axiom AI API started on %s:%s", settings.worker_host, settings.worker_port)
    yield
    await queue_manager.stop()
    logger.info("API stopped")


app = FastAPI(
    title="Axiom AI API",
    description="Axiom AI backend: Supabase metadata + Hugging Face file storage",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

app.include_router(jobs_router)
app.include_router(api_router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )
    detail = str(exc) or "Internal Server Error"
    lowered = detail.lower()
    if any(
        token in lowered
        for token in ("http2", "httpcore", "connection", "remote protocol", "read error")
    ):
        logger.error(
            "Transient upstream error on %s %s: %s",
            request.method,
            request.url.path,
            detail,
        )
    else:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": detail},
    )


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "run_auto_label_worker": settings.run_auto_label_worker,
        "queues": queue_manager.queue_stats(),
        "config": {
            "supabase": settings.supabase_configured,
            "huggingface": settings.hf_configured,
            "storage_backend": "huggingface",
            "dataset_repo": settings.dataset_repo_id or None,
            "model_repo": settings.model_repo_id or None,
            "auto_label_on_colab": not settings.run_auto_label_worker,
            "test_run_on_railway": True,
            "model_compare_on_railway": True,
        },
    }
