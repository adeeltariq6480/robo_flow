import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as jobs_router
from app.config import settings
from app.core.jobs import process_job
from app.core.queue import queue_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    queue_manager.set_processor(process_job)
    await queue_manager.start()
    logger.info("Robo Flow worker started on %s:%s", settings.worker_host, settings.worker_port)
    yield
    await queue_manager.stop()
    logger.info("Worker stopped")


app = FastAPI(
    title="Robo Flow Worker",
    description="YOLO inference, auto-labelling, and model comparison",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs_router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "queues": queue_manager.queue_stats(),
    }
