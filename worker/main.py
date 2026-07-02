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
    queue_manager.set_processor(process_job)
    await queue_manager.start()
    if not settings.supabase_configured:
        logger.warning("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — API will fail")
    logger.info("Axiom AI API started on %s:%s", settings.worker_host, settings.worker_port)
    yield
    await queue_manager.stop()
    logger.info("API stopped")


app = FastAPI(
    title="Axiom AI API",
    description="Axiom AI backend: Supabase metadata + storage, YOLO auto-labelling",
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
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc) or "Internal Server Error"},
    )


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "queues": queue_manager.queue_stats(),
        "config": {
            "supabase": settings.supabase_configured,
        },
    }
