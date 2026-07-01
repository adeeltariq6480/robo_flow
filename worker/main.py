import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import api_router, jobs_router
from app.config import settings
from app.core.jobs import process_job
from app.core.queue import queue_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    queue_manager.set_processor(process_job)
    await queue_manager.start()
    if not settings.hf_token:
        logger.warning("HF_TOKEN is not set — uploads to Hugging Face will fail")
    if not settings.dataset_repo_id:
        logger.warning(
            "HF_DATASET_REPO / HF_USERNAME is not set — dataset uploads will fail"
        )
    logger.info("Robo Flow API started on %s:%s", settings.worker_host, settings.worker_port)
    yield
    await queue_manager.stop()
    logger.info("API stopped")


app = FastAPI(
    title="Robo Flow API",
    description="Main API layer: Firestore metadata, Hugging Face storage, YOLO auto-labelling",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs_router)
app.include_router(api_router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "queues": queue_manager.queue_stats(),
        "config": {
            "firebase": bool(
                settings.firebase_service_account_json.strip()
                or settings.google_application_credentials.strip()
            ),
            "hf_token": bool(settings.hf_token),
            "hf_dataset_repo": bool(settings.dataset_repo_id),
            "hf_model_repo": bool(settings.model_repo_id),
        },
    }
