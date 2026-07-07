import io
import os
import logging
import zipfile
import asyncio
import tempfile
import shutil
import threading
from uuid import uuid4
from pathlib import Path

import psutil
from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Response,
    UploadFile,
)
from huggingface_hub import CommitOperationDelete, HfApi

from app.config import settings
from app.core.jobs import submit_job
from app.core.queue import queue_manager
from app.models.schemas import (
    AnnotationsSave,
    AutoLabelRequest,
    ClassesSave,
    DatasetCreate,
    ExportRequest,
    JobCreateResponse,
    JobResponse,
    JobStatus,
    JobType,
    ModelCompareRequest,
    ModelRegister,
    ProjectCreate,
    ProjectUpdate,
    ReviewAction,
    TestRunRequest,
)
from app.services import export_builder, hf_storage as file_storage, image_preprocess
from app.services import supabase_repo as repo
from app.services import model_chunk_upload
from app.services.storage import persist_model_bytes_locally, resolve_model_local_path
from app.services.yolo_inference import describe_model_status
from app.services.model_validator import detect_model_type, validate_model_file

logger = logging.getLogger(__name__)

jobs_router = APIRouter(prefix="/jobs", tags=["jobs"])
api_router = APIRouter(prefix="/api", tags=["api"])

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
_upload_sessions: dict[str, dict] = {}
_upload_sessions_lock = threading.Lock()
_UPLOAD_BATCH_SIZE = int(os.getenv("UPLOAD_BATCH_SIZE", "200"))
_UPLOAD_FLUSH_DELAY_SECONDS = float(os.getenv("UPLOAD_FLUSH_DELAY_SECONDS", "60.0"))


async def verify_api_key(x_worker_key: str = Header(default="")) -> None:
    # Open in local no-auth mode; only enforce when a key is configured.
    if settings.worker_api_key and x_worker_key != settings.worker_api_key:
        raise HTTPException(status_code=401, detail="Invalid worker API key")


async def db(fn, /, *args, **kwargs):
    """Run blocking Firestore/repo calls off the asyncio event loop."""
    return await asyncio.to_thread(fn, *args, **kwargs)


def _check_upload_config() -> None:
    """Fail fast when Supabase metadata is not configured."""
    missing: list[str] = []
    if not settings.supabase_configured:
        missing.append("SUPABASE_URL")
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if settings.hf_upload_enabled:
        if not settings.hf_token:
            missing.append("HF_TOKEN")
        if not settings.dataset_repo_id:
            missing.append("HF_DATASET_REPO (or HF_USERNAME)")
        if not settings.model_repo_id:
            missing.append("HF_MODEL_REPO (or HF_USERNAME)")
    if missing:
        raise HTTPException(
            status_code=503,
            detail=(
                "Upload storage not configured on the backend. "
                f"Set these Railway variables: {', '.join(missing)}"
            ),
        )


def _hf_api() -> HfApi:
    if not settings.hf_token:
        raise HTTPException(status_code=503, detail="HF_TOKEN is not configured on the backend.")
    return HfApi(token=settings.hf_token)


def _validate_hf_cleanup_args(repo_id: str | None, repo_type: str | None) -> tuple[str, str]:
    if not repo_id or not repo_id.strip():
        raise HTTPException(status_code=400, detail="repo_id is required")
    if repo_type not in {"dataset", "model"}:
        raise HTTPException(status_code=400, detail="repo_type must be either 'dataset' or 'model'")
    return repo_id.strip(), repo_type


def _safe_filename(name: str | None, fallback: str = "image.jpg") -> str:
    if not name or not name.strip():
        return fallback
    return name.replace("\\", "/").rsplit("/", 1)[-1]


def _safe_local_name(name: str, used: set[str]) -> str:
    base = _safe_filename(name, "image.jpg")
    if base not in used:
        used.add(base)
        return base
    stem = Path(base).stem or "image"
    suffix = Path(base).suffix or ".jpg"
    i = 2
    while True:
        candidate = f"{stem}_{i}{suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        i += 1


def _dataset_image_local_dir(project_id: str, dataset_id: str) -> Path:
    base = settings.dataset_files_dir / project_id / dataset_id / "images"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _persist_dataset_image_locally(project_id: str, dataset_id: str, file_name: str, data: bytes) -> Path:
    target_dir = _dataset_image_local_dir(project_id, dataset_id)
    target_path = target_dir / file_name
    target_path.write_bytes(data)
    logger.info("Image saved locally project=%s dataset=%s path=%s", project_id, dataset_id, target_path)
    return target_path


def _image_dimensions(data: bytes) -> tuple[int | None, int | None]:
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as img:
            return img.width, img.height
    except Exception:
        return None, None


def _preprocess_upload_item(
    data: bytes, filename: str
) -> tuple[
    image_preprocess.PreprocessResult | None,
    dict | None,
    dict | None,
]:
    """Returns (result, skip_info, adjust_info)."""
    result = image_preprocess.preprocess_upload_image(data, filename)
    if not result.accepted:
        reason = result.skip_reason or "rejected"
        labels = {
            "blurry": "Image is too blurry",
            "invalid_image": "Invalid or unreadable image",
        }
        return None, {"fileName": filename, "reason": reason, "message": labels.get(reason, reason)}, None

    adjust_info = None
    if result.rotated_to_portrait or result.exif_corrected:
        parts = []
        if result.exif_corrected:
            parts.append("orientation corrected")
        if result.rotated_to_portrait:
            parts.append("rotated to portrait")
        adjust_info = {
            "fileName": filename,
            "reason": "rotated_to_portrait" if result.rotated_to_portrait else "exif_corrected",
            "message": ", ".join(parts),
        }
    return result, None, adjust_info


async def _create_image_record(
    project_id: str,
    dataset_id: str,
    filename: str,
    result: image_preprocess.PreprocessResult,
    content_type: str | None,
    hf_repo: str,
) -> dict:
    hf_path = file_storage.dataset_image_path(project_id, dataset_id, filename)
    return await asyncio.to_thread(
        repo.create_image,
        project_id,
        dataset_id,
        {
            "fileName": filename,
            "hfRepo": hf_repo,
            "hfPath": hf_path,
            "width": result.width,
            "height": result.height,
            "mimeType": result.mime_type or content_type,
            "fileSize": len(result.data),
        },
    )


async def _store_dataset_image(
    project_id: str,
    dataset_id: str,
    filename: str,
    result: image_preprocess.PreprocessResult,
    content_type: str | None,
) -> dict:
    # Save local copy first so downstream jobs can run from local storage
    local_path = None
    try:
        loc = await asyncio.to_thread(
            file_storage.upload_dataset_image,
            project_id,
            dataset_id,
            filename,
            result.data,
        )
        # hf_storage.upload_dataset_image now also returns localPath when HF is disabled
        local_path = loc.get("localPath") if isinstance(loc, dict) else None
    except Exception:
        # If HF upload fails, we still want to persist the local file and create DB record.
        logger.exception("Hugging Face upload failed for %s/%s — will continue with local storage", project_id, filename)
        # Attempt to save locally directly
        try:
            local_dir = settings.dataset_files_dir / str(project_id) / str(dataset_id) / "images"
            local_dir.mkdir(parents=True, exist_ok=True)
            lp = local_dir / filename
            lp.write_bytes(result.data)
            local_path = str(lp)
            logger.info("Saved dataset image locally after HF failure: %s", local_path)
        except Exception:
            logger.exception("Failed to save dataset image locally for %s/%s", project_id, filename)

    db_payload = {
        "fileName": filename,
        "hfRepo": settings.dataset_repo_id,
        "hfPath": file_storage.dataset_image_path(project_id, dataset_id, filename),
        "width": result.width,
        "height": result.height,
        "mimeType": result.mime_type or content_type,
        "fileSize": len(result.data),
    }
    if local_path:
        db_payload["localPath"] = local_path
        db_payload["storageStatus"] = "local_ready"
        # if HF is enabled we mark pending, otherwise disabled
        db_payload["hfSyncStatus"] = "pending" if file_storage.hf_upload_enabled() else "disabled"
    else:
        db_payload["storageStatus"] = "pending"
        db_payload["hfSyncStatus"] = "pending"

    logger.info("Creating DB image record project=%s dataset=%s file=%s local=%s hf_upload=%s", project_id, dataset_id, filename, bool(local_path), file_storage.hf_upload_enabled())

    return await asyncio.to_thread(
        repo.create_image,
        project_id,
        dataset_id,
        db_payload,
    )


async def _upload_one_image(
    project_id: str,
    dataset_id: str,
    filename: str,
    raw_data: bytes,
    content_type: str | None = None,
) -> tuple[dict | None, dict | None, dict | None]:
    """Upload after QA. Returns (image_record, skip_info, adjust_info)."""
    result, skip_info, adjust_info = await asyncio.to_thread(
        _preprocess_upload_item, raw_data, filename
    )
    if skip_info:
        return None, skip_info, None
    assert result is not None
    image = await _store_dataset_image(
        project_id, dataset_id, filename, result, content_type
    )
    return image, None, adjust_info


async def _flush_upload_session(session_id: str, *, initial_delay: float) -> None:
    delay = max(0.0, initial_delay)
    while True:
        if delay > 0:
            await asyncio.sleep(delay)

        with _upload_sessions_lock:
            session = _upload_sessions.get(session_id)
            if not session:
                return
            if session.get("uploading"):
                return

            items = session["items"][:_UPLOAD_BATCH_SIZE]
            if not items:
                session["flush_task"] = None
                return

            del session["items"][: len(items)]
            session["uploading"] = True
            batch_root = Path(session["dir"]) / f"batch-{uuid4().hex}"
            batch_root.mkdir(parents=True, exist_ok=True)
            for item in items:
                src = Path(item["local_path"])
                (batch_root / item["stored_name"]).write_bytes(src.read_bytes())

        logger.info(
            "Batch upload started session=%s project=%s dataset=%s count=%d",
            session_id,
            session["project_id"],
            session["dataset_id"],
            len(items),
        )

        try:
            # Do not commit to Hugging Face during upload flush. Only persist
            # local files and mark DB records as ready for later finalization.
            logger.info("Upload session flushed locally session=%s count=%d", session_id, len(items))
            for item in items:
                await asyncio.to_thread(
                    repo.update_image_storage_fields,
                    session["project_id"],
                    item["image_id"],
                    {
                        "status": "uploaded",
                        "storage_status": "local_ready",
                        "hf_sync_status": "pending",
                    },
                )
        except Exception as exc:
            logger.exception(
                "Upload failed after retries session=%s count=%d: %s",
                session_id,
                len(items),
                exc,
            )
            for item in items:
                await asyncio.to_thread(
                    repo.update_image_storage_fields,
                    session["project_id"],
                    item["image_id"],
                    {
                        "status": "pending_hf_sync",
                        "storage_status": "local_ready",
                        "hf_sync_status": "pending_hf_sync",
                    },
                )
        finally:
            shutil.rmtree(batch_root, ignore_errors=True)
            with _upload_sessions_lock:
                session = _upload_sessions.get(session_id)
                if not session:
                    return
                session["uploading"] = False
                remaining = len(session["items"])
                finalize_requested = bool(session.get("finalize_requested"))
                if remaining == 0:
                    session["flush_task"] = None
                    if finalize_requested:
                        session["finalized"] = True
                    return

        delay = 0.0 if remaining >= _UPLOAD_BATCH_SIZE or finalize_requested else _UPLOAD_FLUSH_DELAY_SECONDS


def _ensure_upload_session(project_id: str, dataset_id: str, session_id: str) -> dict:
    with _upload_sessions_lock:
        session = _upload_sessions.get(session_id)
        if session is None:
            session_dir = tempfile.mkdtemp(prefix=f"upload-session-{session_id}-")
            session = {
                "project_id": project_id,
                "dataset_id": dataset_id,
                "dir": session_dir,
                "items": [],
                "used_names": set(),
                "uploading": False,
                "finalize_requested": False,
                "flush_task": None,
                "finalized": False,
            }
            _upload_sessions[session_id] = session
        elif session["project_id"] != project_id or session["dataset_id"] != dataset_id:
            raise HTTPException(status_code=400, detail="Invalid upload session context")
        return session


def _schedule_upload_flush(session_id: str, *, immediate: bool) -> None:
    with _upload_sessions_lock:
        session = _upload_sessions.get(session_id)
        if not session or session.get("flush_task") is not None:
            return
        delay = 0.0 if immediate else _UPLOAD_FLUSH_DELAY_SECONDS
        session["flush_task"] = asyncio.create_task(
            _flush_upload_session(session_id, initial_delay=delay)
        )


# ===========================================================================
# Projects
# ===========================================================================

@api_router.post("/projects")
async def create_project(body: ProjectCreate, _: None = Depends(verify_api_key)):
    return repo.create_project(body.name, body.description, body.annotation_type)


@api_router.get("/projects")
async def list_projects(_: None = Depends(verify_api_key)):
    return await db(repo.list_projects)


@api_router.get("/projects/{project_id}")
async def get_project(project_id: str, _: None = Depends(verify_api_key)):
    project = await db(repo.get_project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@api_router.get("/projects/{project_id}/stats")
async def get_project_stats(project_id: str, _: None = Depends(verify_api_key)):
    try:
        return await db(repo.get_project_stats, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@api_router.put("/projects/{project_id}")
async def update_project(
    project_id: str, body: ProjectUpdate, _: None = Depends(verify_api_key)
):
    updated = repo.update_project(
        project_id,
        {
            "name": body.name,
            "description": body.description,
            "annotationType": body.annotation_type,
        },
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str, _: None = Depends(verify_api_key)):
    repo.delete_project(project_id)
    return {"ok": True}


# ===========================================================================
# Classes
# ===========================================================================

@api_router.post("/classes")
async def save_classes(body: ClassesSave, _: None = Depends(verify_api_key)):
    classes = [
        {
            "className": c.class_name,
            "classIndex": c.class_index if c.class_index is not None else i,
            "color": c.color,
            "description": c.description,
        }
        for i, c in enumerate(body.classes)
    ]
    return await db(repo.save_classes, body.project_id, classes)


@api_router.get("/classes/{project_id}")
async def get_classes(project_id: str, _: None = Depends(verify_api_key)):
    return await db(repo.list_classes, project_id)


# ===========================================================================
# Datasets
# ===========================================================================

@api_router.post("/datasets")
async def create_dataset(body: DatasetCreate, _: None = Depends(verify_api_key)):
    return repo.create_dataset(body.project_id, body.name)


@api_router.get("/datasets/{project_id}")
async def list_datasets(project_id: str, _: None = Depends(verify_api_key)):
    return await db(repo.list_datasets, project_id)


@api_router.get("/datasets/{project_id}/{dataset_id}")
async def get_dataset(project_id: str, dataset_id: str, _: None = Depends(verify_api_key)):
    ds = await db(repo.get_dataset, project_id, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return ds


@api_router.get("/datasets/{project_id}/{dataset_id}/images")
async def list_dataset_images(
    project_id: str, dataset_id: str, _: None = Depends(verify_api_key)
):
    return repo.list_dataset_images(project_id, dataset_id)


@api_router.get("/datasets/{project_id}/{dataset_id}/review")
async def dataset_review(
    project_id: str, dataset_id: str, _: None = Depends(verify_api_key)
):
    return repo.dataset_review_files(project_id, dataset_id)


@api_router.delete("/datasets/{project_id}/{dataset_id}")
async def delete_dataset(
    project_id: str, dataset_id: str, _: None = Depends(verify_api_key)
):
    repo.delete_dataset(project_id, dataset_id)
    return {"ok": True}


@api_router.post("/datasets/{project_id}/{dataset_id}/delete-images")
async def delete_images(
    project_id: str,
    dataset_id: str,
    body: dict,
    _: None = Depends(verify_api_key),
):
    repo.delete_images(project_id, dataset_id, body.get("imageIds", []))
    return {"ok": True}


# ===========================================================================
# Uploads → Hugging Face Hub (metadata in Supabase Postgres)
# ===========================================================================

@api_router.post("/upload-images")
async def upload_images(
    project_id: str = Form(...),
    dataset_id: str = Form(...),
    files: list[UploadFile] = File(...),
    upload_session_id: str | None = Form(default=None),
    finalize_session: bool = Form(default=False),
    _: None = Depends(verify_api_key),
):
    _check_upload_config()
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    created: list[dict] = []
    skipped: list[dict] = []
    adjusted: list[dict] = []

    session_id = (upload_session_id or uuid4().hex).strip() or uuid4().hex
    session = _ensure_upload_session(project_id, dataset_id, session_id)

    for f in files:
        data = await f.read()
        if not data:
            continue

        filename = _safe_filename(f.filename)
        result, skip_info, adjust_info = await asyncio.to_thread(
            _preprocess_upload_item, data, filename
        )
        if skip_info:
            skipped.append(skip_info)
            continue
        if adjust_info:
            adjusted.append(adjust_info)
        assert result is not None

        with _upload_sessions_lock:
            session_state = _upload_sessions.get(session_id)
            if session_state is None:
                raise HTTPException(status_code=500, detail="Upload session expired")
            stored_name = _safe_local_name(filename, session_state["used_names"])

        local_path = _persist_dataset_image_locally(project_id, dataset_id, stored_name, result.data)
        logger.info(
            "Image received session=%s file=%s stored=%s local=%s",
            session_id,
            filename,
            stored_name,
            local_path,
        )

        record = await asyncio.to_thread(
            repo.create_image,
            project_id,
            dataset_id,
            {
                "fileName": stored_name,
                "hfRepo": settings.dataset_repo_id,
                "hfPath": file_storage.dataset_image_path(
                    project_id, dataset_id, stored_name
                ),
                "width": result.width,
                "height": result.height,
                "mimeType": result.mime_type or f.content_type,
                "fileSize": len(result.data),
                "status": "queued",
                "localPath": str(local_path),
                "storageStatus": "local_ready",
                "hfSyncStatus": "queued" if file_storage.hf_upload_enabled() else "skipped",
            },
        )

        with _upload_sessions_lock:
            session_state = _upload_sessions.get(session_id)
            if session_state is not None:
                session_state["items"].append(
                    {
                        "image_id": record["id"],
                        "stored_name": stored_name,
                        "local_path": str(local_path),
                    }
                )

        created.append(record)
        logger.info("Image added to upload queue session=%s file=%s", session_id, stored_name)

    if not created:
        return {
            "uploaded": 0,
            "images": [],
            "queued": 0,
            "skipped": skipped,
            "adjusted": adjusted,
        }

    with _upload_sessions_lock:
        session = _upload_sessions.get(session_id)
        if session is not None:
            if finalize_session:
                session["finalize_requested"] = True
            immediate = finalize_session or len(session["items"]) >= _UPLOAD_BATCH_SIZE
            should_schedule = session.get("flush_task") is None and session["items"]
        else:
            immediate = False
            should_schedule = False

    if should_schedule:
        _schedule_upload_flush(session_id, immediate=immediate)

    await asyncio.to_thread(repo.recount_dataset_images, project_id, dataset_id)
    return {
        "uploadSessionId": session_id,
        "uploaded": len(created),
        "images": created,
        "queued": len(created),
        "skipped": skipped,
        "adjusted": adjusted,
        "processing": True,
    }

    with _upload_sessions_lock:
        session = _upload_sessions.get(session_id)
        if session is not None:
            if finalize_session:
                session["finalize_requested"] = True
            immediate = finalize_session or len(session["items"]) >= _UPLOAD_BATCH_SIZE
            should_schedule = session.get("flush_task") is None and session["items"]
        else:
            immediate = False
            should_schedule = False

    if should_schedule:
        _schedule_upload_flush(session_id, immediate=immediate)

    result_payload = {
        "uploadSessionId": session_id,
        "uploaded": len(created),
        "images": created,
        "queued": len(created),
        "skipped": skipped,
        "adjusted": adjusted,
        "processing": True,
    }
    await asyncio.to_thread(repo.recount_dataset_images, project_id, dataset_id)
    return result_payload


@api_router.post("/upload-zip")
async def upload_zip(
    project_id: str = Form(...),
    dataset_id: str = Form(...),
    file: UploadFile = File(...),
    _: None = Depends(verify_api_key),
):
    _check_upload_config()
    created: list[dict] = []
    skipped: list[dict] = []
    adjusted: list[dict] = []

    session_id = uuid4().hex
    session = _ensure_upload_session(project_id, dataset_id, session_id)

    try:
        with zipfile.ZipFile(file.file) as zf:
            for name in zf.namelist():
                if name.endswith("/") or not name.lower().endswith(IMAGE_EXTS):
                    continue
                data = zf.read(name)
                filename = _safe_filename(name.rsplit("/", 1)[-1])
                result, skip_info, adjust_info = await asyncio.to_thread(
                    _preprocess_upload_item, data, filename
                )
                if skip_info:
                    skipped.append(skip_info)
                    continue
                if adjust_info:
                    adjusted.append(adjust_info)
                assert result is not None

                with _upload_sessions_lock:
                    session_state = _upload_sessions.get(session_id)
                    if session_state is None:
                        raise HTTPException(status_code=500, detail="Upload session expired")
                    stored_name = _safe_local_name(filename, session_state["used_names"])

                local_path = _persist_dataset_image_locally(project_id, dataset_id, stored_name, result.data)

                record = await asyncio.to_thread(
                    repo.create_image,
                    project_id,
                    dataset_id,
                    {
                        "fileName": stored_name,
                        "hfRepo": settings.dataset_repo_id,
                        "hfPath": file_storage.dataset_image_path(
                            project_id, dataset_id, stored_name
                        ),
                        "width": result.width,
                        "height": result.height,
                        "mimeType": result.mime_type or file.content_type,
                        "fileSize": len(result.data),
                        "status": "queued",
                        "localPath": str(local_path),
                        "storageStatus": "local_ready",
                        "hfSyncStatus": "queued" if file_storage.hf_upload_enabled() else "skipped",
                    },
                )

                with _upload_sessions_lock:
                    session_state = _upload_sessions.get(session_id)
                    if session_state is not None:
                        session_state["items"].append(
                            {
                                "image_id": record["id"],
                                "stored_name": stored_name,
                                "local_path": str(local_path),
                            }
                        )

                created.append(record)
                logger.info(
                    "ZIP image staged session=%s file=%s stored=%s",
                    session_id,
                    filename,
                    stored_name,
                )
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")

    with _upload_sessions_lock:
        session = _upload_sessions.get(session_id)
        if session is not None:
            immediate = len(session["items"]) >= _UPLOAD_BATCH_SIZE
            should_schedule = session.get("flush_task") is None and session["items"]
        else:
            should_schedule = False

    if should_schedule:
        _schedule_upload_flush(session_id, immediate=immediate)

    await asyncio.to_thread(repo.recount_dataset_images, project_id, dataset_id)
    return {
        "uploadSessionId": session_id,
        "uploaded": len(created),
        "images": created,
        "skipped": skipped,
        "adjusted": adjusted,
        "queued": len(created),
        "processing": True,
    }


@api_router.post("/upload-model/init")
async def upload_model_init(
    project_id: str = Form(...),
    file_name: str = Form(...),
    total_chunks: int = Form(...),
    file_size: int = Form(...),
    model_name: str = Form(...),
    model_version: str = Form("1.0.0"),
    model_type: str = Form("pytorch"),
    description: str = Form(""),
    _: None = Depends(verify_api_key),
):
    """Start a chunked model upload session (for large .pt files)."""
    _check_upload_config()
    try:
        session_id = await asyncio.to_thread(
            model_chunk_upload.init_session,
            project_id,
            file_name,
            total_chunks,
            model_name=model_name,
            model_version=model_version,
            model_type=model_type,
            description=description or None,
            file_size=file_size,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"sessionId": session_id}


@api_router.post("/upload-model/chunk")
async def upload_model_chunk(
    session_id: str = Form(...),
    chunk_index: int = Form(...),
    chunk: UploadFile = File(...),
    _: None = Depends(verify_api_key),
):
    _check_upload_config()
    data = await chunk.read()
    try:
        await asyncio.to_thread(
            model_chunk_upload.save_chunk, session_id, chunk_index, data
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "chunkIndex": chunk_index}


@api_router.post("/upload-model/finish")
async def upload_model_finish(
    session_id: str = Form(...),
    _: None = Depends(verify_api_key),
):
    _check_upload_config()
    try:
        model = await asyncio.to_thread(model_chunk_upload.finalize_session, session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Chunked model upload failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return model


@api_router.post("/upload-model")
async def upload_model(
    project_id: str = Form(...),
    model_name: str = Form(...),
    model_version: str = Form("1.0.0"),
    model_type: str = Form("pytorch"),
    description: str = Form(""),
    file: UploadFile = File(...),
    _: None = Depends(verify_api_key),
):
    """Upload model file via worker → Hugging Face Hub + DB record."""
    _check_upload_config()
    data = await file.read()
    local_path = await asyncio.to_thread(persist_model_bytes_locally, project_id, file.filename, data)
    if settings.hf_upload_enabled:
        loc = await asyncio.to_thread(
            file_storage.upload_model_file, project_id, file.filename, data
        )
    else:
        loc = {"hfRepo": settings.model_repo_id, "hfPath": file_storage.model_path(project_id, file.filename)}
    model = repo.create_model(project_id, {
        "modelName": model_name,
        "modelVersion": model_version,
        "modelType": model_type,
        "description": description or None,
        "hfRepo": loc["hfRepo"],
        "hfPath": loc["hfPath"],
        "fileSize": len(data),
    })
    return model


@api_router.post("/register-model")
async def register_model(body: ModelRegister, _: None = Depends(verify_api_key)):
    """Register model metadata when the file already exists on Hugging Face Hub."""
    if not body.hf_path.strip():
        raise HTTPException(status_code=400, detail="hf_path is required")
    return await asyncio.to_thread(
        repo.create_model,
        body.project_id,
        {
            "modelName": body.model_name,
            "modelVersion": body.model_version,
            "modelType": body.model_type,
            "description": body.description,
            "hfRepo": body.hf_repo or settings.model_repo_id,
            "hfPath": body.hf_path,
            "fileSize": body.file_size,
        },
    )


@api_router.get("/models/{project_id}")
async def list_models(project_id: str, _: None = Depends(verify_api_key)):
    return await db(repo.list_models, project_id)


@api_router.delete("/models/{project_id}/{model_id}")
async def delete_model(project_id: str, model_id: str, _: None = Depends(verify_api_key)):
    repo.delete_model(project_id, model_id)
    return {"ok": True}


@api_router.post("/models/{project_id}/{model_id}/reupload")
async def reupload_model(
    project_id: str,
    model_id: str,
    _: None = Depends(verify_api_key),
):
    model_row = await asyncio.to_thread(repo.get_model, project_id, model_id)
    if not model_row:
        raise HTTPException(status_code=404, detail="Model not found")

    try:
        local_path = await asyncio.to_thread(resolve_model_local_path, model_id, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not local_path.exists() or not local_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Model file not found locally or on Hugging Face. Please re-upload this model.",
        )

    data = local_path.read_bytes()
    loc = await asyncio.to_thread(
        file_storage.upload_model_file,
        project_id,
        local_path.name,
        data,
    )
    return await asyncio.to_thread(
        repo.create_model,
        project_id,
        {
            "modelName": model_row["modelName"],
            "modelVersion": model_row.get("modelVersion", "1.0.0"),
            "modelType": model_row.get("modelType", "pytorch"),
            "description": model_row.get("description"),
            "hfRepo": loc["hfRepo"],
            "hfPath": loc["hfPath"],
            "fileSize": len(data),
        },
    )


@api_router.get("/admin/hf-cleanup/preview")
async def preview_hf_cleanup(
    repo_id: str = "",
    repo_type: str = "",
    _: None = Depends(verify_api_key),
):
    logger.info("cleanup preview started repo=%s type=%s", repo_id, repo_type)
    repo_id, repo_type = _validate_hf_cleanup_args(repo_id, repo_type)
    api = _hf_api()

    try:
        files = api.list_repo_files(repo_id=repo_id, repo_type=repo_type)
    except Exception as exc:
        logger.exception("cleanup preview failed repo=%s type=%s", repo_id, repo_type)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list repository files: {exc}",
        ) from exc

    logger.info(
        "files found repo=%s type=%s count=%d",
        repo_id,
        repo_type,
        len(files),
    )

    response = {
        "repo_id": repo_id,
        "repo_type": repo_type,
        "files": files,
    }
    if not files:
        response["message"] = "No files found."
    return response


@api_router.post("/admin/hf-cleanup/delete")
async def delete_hf_cleanup(
    body: dict = Body(...),
    _: None = Depends(verify_api_key),
):
    repo_id = body.get("repo_id", "")
    repo_type = body.get("repo_type", "")
    confirmation = body.get("confirmation", "")

    logger.info("cleanup delete requested repo=%s type=%s", repo_id, repo_type)
    repo_id, repo_type = _validate_hf_cleanup_args(repo_id, repo_type)

    if confirmation != "DELETE":
        raise HTTPException(
            status_code=400,
            detail="Confirmation must be exactly DELETE",
        )

    logger.info("confirmation verified repo=%s type=%s", repo_id, repo_type)
    api = _hf_api()

    try:
        files = api.list_repo_files(repo_id=repo_id, repo_type=repo_type)
    except Exception as exc:
        logger.exception("cleanup failed listing files repo=%s type=%s", repo_id, repo_type)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list repository files: {exc}",
        ) from exc

    if not files:
        logger.info("cleanup completed repo=%s type=%s no files found", repo_id, repo_type)
        return {
            "success": True,
            "deleted_count": 0,
            "deleted_files": [],
            "message": "No files found.",
        }

    operations = [CommitOperationDelete(path_in_repo=file) for file in files]
    logger.info(
        "delete commit started repo=%s type=%s files=%d",
        repo_id,
        repo_type,
        len(files),
    )

    try:
        api.create_commit(
            repo_id=repo_id,
            repo_type=repo_type,
            operations=operations,
            commit_message="Cleanup repo contents",
        )
    except Exception as exc:
        logger.exception("cleanup failed repo=%s type=%s", repo_id, repo_type)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete repository files: {exc}",
        ) from exc

    logger.info("cleanup completed repo=%s type=%s deleted=%d", repo_id, repo_type, len(files))
    return {
        "success": True,
        "deleted_count": len(files),
        "deleted_files": files,
    }


@api_router.get("/admin/hf-sync/preview")
async def preview_hf_sync(project_id: str, _: None = Depends(verify_api_key)):
    """Preview which local models/images would be uploaded to Hugging Face for a project."""
    logger.info("hf-sync preview project=%s", project_id)
    # Basic HF config
    hf_enabled = file_storage.hf_upload_enabled()
    dataset_repo = settings.dataset_repo_id
    model_repo = settings.model_repo_id

    # Models: local files and DB models
    model_dir = settings.model_files_dir / project_id
    local_models = []
    if model_dir.exists():
        for p in model_dir.iterdir():
            if p.is_file() and p.stat().st_size > 0:
                local_models.append(p.name)

    db_models = await asyncio.to_thread(repo.list_models, project_id)
    db_model_names = [m.get("hfPath") and file_storage.model_cache_local_name_from_path(m.get("hfPath")) or None for m in db_models]
    models_missing_local = [m for m in db_model_names if m and m not in local_models]

    # Datasets / images: aggregate per-dataset
    datasets = await asyncio.to_thread(repo.list_datasets, project_id)
    datasets_summary: list[dict] = []
    total_local_images = 0
    total_db_images = 0
    total_pending_images = 0
    for ds in datasets:
        ds_id = ds["id"]
        local_images_dir = settings.dataset_files_dir / project_id / ds_id / "images"
        local_images = []
        if local_images_dir.exists():
            for p in local_images_dir.iterdir():
                if p.is_file() and p.stat().st_size > 0:
                    local_images.append(p.name)
        db_images = await asyncio.to_thread(repo.list_dataset_images, project_id, ds_id)
        pending = [i for i in db_images if i.get("hfSyncStatus") != "synced" and i.get("storageStatus") in {"local_ready", "pending"}]
        datasets_summary.append({
            "datasetId": ds_id,
            "datasetName": ds.get("name"),
            "localImagesCount": len(local_images),
            "dbImagesCount": len(db_images),
            "pendingImagesCount": len(pending),
        })
        total_local_images += len(local_images)
        total_db_images += len(db_images)
        total_pending_images += len(pending)

    response = {
        "hfUploadEnabled": hf_enabled,
        "datasetRepo": dataset_repo,
        "modelRepo": model_repo,
        "projectId": project_id,
        "localModelsCount": len(local_models),
        "dbModelsCount": len(db_models),
        "modelsMissingLocal": models_missing_local,
        "localImagesCount": total_local_images,
        "dbImagesCount": total_db_images,
        "imagesPendingSyncCount": total_pending_images,
        # extra fields for admin
        "local_images_found": total_local_images,
        "pending_hf_images": total_pending_images,
        "failed_hf_images": 0,
        "local_models_found": len(local_models),
        "pending_hf_models": 0,
        "last_hf_error": None,
        "datasets": datasets_summary,
    }
    return response


@api_router.post("/admin/hf-sync/run")
async def run_hf_sync(project_id: str, _: None = Depends(verify_api_key)):
    """Run a large-batch HF sync for a project. Non-blocking uploads are serialized
    and retried conservatively; failures are recorded as `pending_hf_sync`.
    """
    hf_enabled = file_storage.hf_upload_enabled()
    batch_size = int(os.getenv("HF_SYNC_BATCH_SIZE", "200"))
    min_delay = int(os.getenv("HF_SYNC_MIN_DELAY_SECONDS", "60"))

    datasets = await asyncio.to_thread(repo.list_datasets, project_id)
    report = {"projectId": project_id, "hfUploadEnabled": hf_enabled, "datasets": []}

    for ds in datasets:
        ds_id = ds["id"]
        images = await asyncio.to_thread(repo.list_dataset_images, project_id, ds_id)
        pending = [i for i in images if i.get("hfSyncStatus") not in {"synced", "disabled", "skipped"} and (i.get("storageStatus") in {"local_ready", "pending"} or i.get("localPath"))]
        failed = []
        uploaded = 0
        # prepare batches
        items: list[tuple[str, bytes, str]] = []
        for img in pending:
            lp = img.get("localPath") or img.get("local_path")
            if not lp:
                failed.append({"id": img.get("id"), "reason": "no localPath"})
                continue
            try:
                data = Path(lp).read_bytes()
                items.append((img.get("fileName") or Path(lp).name, data, img.get("id")))
            except Exception as exc:
                failed.append({"id": img.get("id"), "reason": f"read failed: {exc}"})

        # upload in batches
        for i in range(0, len(items), batch_size):
            batch = items[i : i + batch_size]
            payload = [(name, data) for (name, data, _id) in batch]
            try:
                res = await asyncio.to_thread(file_storage.upload_dataset_images_batch, project_id, ds_id, payload)
                # mark all as synced
                for (_name, _data, img_id) in batch:
                    try:
                        await asyncio.to_thread(repo.update_image_storage_fields, project_id, img_id, {"hf_sync_status": "synced", "storage_status": "local_ready"})
                        uploaded += 1
                    except Exception:
                        failed.append({"id": img_id, "reason": "db update failed after upload"})
            except Exception as exc:
                logger.exception("HF batch upload failed for project=%s dataset=%s: %s", project_id, ds_id, exc)
                # mark images as pending_hf_sync
                for (_name, _data, img_id) in batch:
                    try:
                        await asyncio.to_thread(repo.update_image_storage_fields, project_id, img_id, {"hf_sync_status": "pending_hf_sync"})
                    except Exception:
                        logger.exception("Failed to mark image pending_hf_sync %s", img_id)
                # Respect server-side Retry-After by sleeping a bit before next commit
                await asyncio.sleep(min_delay)

        report["datasets"].append({"datasetId": ds_id, "uploaded": uploaded, "failed": failed, "pendingCount": len(pending)})

    return report


@api_router.post("/datasets/{project_id}/{dataset_id}/finalize-upload")
async def finalize_upload(project_id: str, dataset_id: str, _: None = Depends(verify_api_key)):
    """Finalize a dataset upload by committing the entire images folder to Hugging Face in one commit."""
    folder = settings.dataset_files_dir / str(project_id) / str(dataset_id) / "images"
    if not folder.exists():
        raise HTTPException(status_code=404, detail="Dataset images folder not found")
    hf_enabled = file_storage.hf_upload_enabled()
    if not hf_enabled:
        raise HTTPException(status_code=400, detail="Hugging Face upload is disabled")

    try:
        res = await asyncio.to_thread(file_storage.upload_labels_from_folder, project_id, dataset_id, str(folder), sum(1 for _ in folder.iterdir() if _.is_file()))
    except Exception as exc:
        logger.exception("Finalize upload failed for %s/%s: %s", project_id, dataset_id, exc)
        # mark pending for retry
        images = await asyncio.to_thread(repo.list_dataset_images, project_id, dataset_id)
        for img in images:
            try:
                await asyncio.to_thread(repo.update_image_storage_fields, project_id, img.get("id"), {"hf_sync_status": "pending_hf_sync"})
            except Exception:
                logger.exception("Failed to mark image pending_hf_sync %s", img.get("id"))
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # mark all images as synced
    images = await asyncio.to_thread(repo.list_dataset_images, project_id, dataset_id)
    for img in images:
        try:
            await asyncio.to_thread(repo.update_image_storage_fields, project_id, img.get("id"), {"hf_sync_status": "synced"})
        except Exception:
            logger.exception("Failed to mark image synced %s", img.get("id"))

    return {"ok": True, "commit": res}


@api_router.post("/datasets/{project_id}/{dataset_id}/finalize-labels")
async def finalize_labels(project_id: str, dataset_id: str, _: None = Depends(verify_api_key)):
    """Commit all label files in dataset labels folder to Hugging Face in one commit."""
    folder = settings.dataset_files_dir / str(project_id) / str(dataset_id) / "labels"
    if not folder.exists():
        raise HTTPException(status_code=404, detail="Labels folder not found")
    hf_enabled = file_storage.hf_upload_enabled()
    if not hf_enabled:
        raise HTTPException(status_code=400, detail="Hugging Face upload is disabled")

    try:
        res = await asyncio.to_thread(file_storage.upload_dataset_images_from_folder, project_id, dataset_id, str(folder), sum(1 for _ in folder.iterdir() if _.is_file()))
    except Exception as exc:
        logger.exception("Finalize labels failed for %s/%s: %s", project_id, dataset_id, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # update dataset label_status if DB has such field; for now update images hfSyncStatus if present
    return {"ok": True, "commit": res}


@api_router.get("/datasets/{project_id}/{dataset_id}/sync-preview")
async def dataset_sync_preview(project_id: str, dataset_id: str, _: None = Depends(verify_api_key)):
    images = await asyncio.to_thread(repo.list_dataset_images, project_id, dataset_id)
    local_images = 0
    pending_image_sync = 0
    for img in images:
        lp = img.get("localPath") or img.get("local_path")
        if lp and Path(lp).exists():
            local_images += 1
        if img.get("hfSyncStatus") not in {"synced", "disabled", "skipped"}:
            pending_image_sync += 1
    labels_dir = settings.dataset_files_dir / str(project_id) / str(dataset_id) / "labels"
    local_labels = sum(1 for _ in labels_dir.iterdir() if _.is_file()) if labels_dir.exists() else 0
    pending_label_sync = 0
    # labels syncing tracked at dataset level; for now infer from existence
    labels_synced = False
    return {
        "local_images_count": len(images),
        "local_labels_count": local_labels,
        "images_synced": pending_image_sync == 0,
        "labels_synced": labels_synced,
        "pending_image_sync": pending_image_sync,
        "pending_label_sync": pending_label_sync,
    }


@api_router.post("/admin/datasets/{project_id}/{dataset_id}/repair-local-paths")
async def repair_local_paths(project_id: str, dataset_id: str, _: None = Depends(verify_api_key)):
    """Scan the local dataset folder and update DB `localPath` and `storageStatus`.
    """
    base = settings.dataset_files_dir / str(project_id) / str(dataset_id) / "images"
    found = []
    updated = 0
    if not base.exists():
        raise HTTPException(status_code=404, detail="Dataset local folder not found")

    files_on_disk = {p.name: p for p in base.iterdir() if p.is_file()}
    images = await asyncio.to_thread(repo.list_dataset_images, project_id, dataset_id)
    name_map = {img.get("fileName"): img for img in images}
    for name, path in files_on_disk.items():
        img = name_map.get(name)
        if not img:
            continue
        img_id = img.get("id")
        try:
            await asyncio.to_thread(repo.update_image_storage_fields, project_id, img_id, {"localPath": str(path), "storageStatus": "local_ready", "hfSyncStatus": img.get("hfSyncStatus") or "pending"})
            updated += 1
            found.append(name)
        except Exception:
            logger.exception("Failed to update image localPath for %s", img_id)

    return {"projectId": project_id, "datasetId": dataset_id, "found": len(found), "updated": updated}


@api_router.get("/model-status")
async def model_status(
    project_id: str,
    model_id: str,
    _: None = Depends(verify_api_key),
):
    try:
        model_path = resolve_model_local_path(model_id, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    status = describe_model_status(model_path)
    status.update(
        {
            "selected_model_directory": str(model_path.parent),
            "cache_path": str(settings.hf_cache_dir),
        }
    )
    return status


@api_router.get("/memory-status")
async def memory_status(
    project_id: str | None = None,
    model_id: str | None = None,
    _: None = Depends(verify_api_key),
):
    process = psutil.Process()
    memory_mb = process.memory_info().rss / 1024 / 1024
    model_loaded = False
    model_path = None
    if project_id and model_id:
        try:
            model_path = str(resolve_model_local_path(model_id, project_id))
            status = describe_model_status(Path(model_path))
            model_loaded = status.get("model_loaded", False)
        except ValueError:
            model_path = None

    return {
        "ram_usage_mb": round(memory_mb, 2),
        "model_loaded": model_loaded,
        "model_path": model_path,
    }


@api_router.get("/models/{project_id}/{model_id}/validate")
async def validate_model_endpoint(
    project_id: str,
    model_id: str,
    _: None = Depends(verify_api_key),
):
    """Validate a model by ID and return detection info."""
    try:
        model_path = resolve_model_local_path(model_id, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    detection_info = detect_model_type(str(model_path))
    return {
        "model_id": model_id,
        "model_path": str(model_path),
        "detection": detection_info,
    }


@api_router.post("/models/validate-file")
async def validate_model_file_endpoint(
    file: UploadFile = File(...),
    _: None = Depends(verify_api_key),
):
    """Validate an uploaded model file without saving it."""
    import tempfile

    # Save to temp file for validation
    with tempfile.NamedTemporaryFile(suffix=Path(file.filename or "model.pt").suffix, delete=False) as tmp:
        tmp_path = tmp.name
        tmp.write(await file.read())

    try:
        detection_info = validate_model_file(tmp_path)
        return {
            "filename": file.filename,
            "detection": detection_info,
        }
    finally:
        # Clean up temp file
        try:
            Path(tmp_path).unlink()
        except Exception:
            pass


# ===========================================================================
# Image content proxy (Hugging Face Hub)
# ===========================================================================

@api_router.get("/images/{project_id}/{image_id}/content")
async def image_content(project_id: str, image_id: str, _: None = Depends(verify_api_key)):
    img = repo.get_image(project_id, image_id)
    if not img or not img.get("hfRepo") or not img.get("hfPath"):
        raise HTTPException(status_code=404, detail="Image not found")
    data = file_storage.download_bytes(
        img["hfRepo"], img["hfPath"], repo_type=file_storage.REPO_TYPE_DATASET
    )
    return Response(content=data, media_type=img.get("mimeType") or "image/jpeg")


# ===========================================================================
# Inference jobs (test-run, auto-label, model-compare)
# ===========================================================================

@jobs_router.post("/test-run", response_model=JobCreateResponse)
@api_router.post("/test-run", response_model=JobCreateResponse)
async def create_test_run(body: TestRunRequest, _: None = Depends(verify_api_key)):
    if not body.image_path and not body.dataset_file_id:
        raise HTTPException(status_code=400, detail="Provide image_path or dataset_file_id")
    job_id, queue, position = await submit_job(
        body.project_id, JobType.TEST_RUN,
        model_id=body.model_id, config=body.config,
        input_payload={
            "image_path": body.image_path,
            "dataset_file_id": str(body.dataset_file_id) if body.dataset_file_id else None,
        },
    )
    return JobCreateResponse(
        job_id=job_id, queue_name=queue, status=JobStatus.QUEUED,
        message=f"Test run queued (position {position})",
    )


@jobs_router.post("/auto-label", response_model=JobCreateResponse)
@api_router.post("/auto-label", response_model=JobCreateResponse)
async def create_auto_label(body: AutoLabelRequest, _: None = Depends(verify_api_key)):
    total = repo.count_dataset_images(body.project_id, body.dataset_id)
    model_ids = body.resolved_model_ids()
    total_work_items = total * max(len(model_ids), 1)
    job_id, queue, position = await submit_job(
        body.project_id, JobType.AUTO_LABEL,
        model_id=model_ids[0], model_ids=model_ids,
        dataset_id=body.dataset_id, config=body.config, total_items=total_work_items,
        input_payload={"model_ids": model_ids},
    )
    return JobCreateResponse(
        job_id=job_id, queue_name=queue, status=JobStatus.QUEUED,
        message=f"Auto-label queued for {total} files (position {position})",
    )


@jobs_router.post("/model-compare", response_model=JobCreateResponse)
@api_router.post("/model-compare", response_model=JobCreateResponse)
async def create_model_compare(body: ModelCompareRequest, _: None = Depends(verify_api_key)):
    if not body.image_path and not body.dataset_file_id:
        raise HTTPException(status_code=400, detail="Provide image_path or dataset_file_id")
    job_id, queue, position = await submit_job(
        body.project_id, JobType.MODEL_COMPARE,
        model_ids=body.model_ids, config=body.config,
        input_payload={
            "image_path": body.image_path,
            "dataset_file_id": str(body.dataset_file_id) if body.dataset_file_id else None,
        },
    )
    return JobCreateResponse(
        job_id=job_id, queue_name=queue, status=JobStatus.QUEUED,
        message=f"Model compare queued (position {position})",
    )


@jobs_router.get("/queues/stats")
async def queue_stats(_: None = Depends(verify_api_key)):
    return queue_manager.queue_stats()


def _job_to_response(project_id: str, job_id: str, d: dict) -> JobResponse:
    queue_map = {"test_run": "interactive", "auto_label": "batch", "model_compare": "compare"}
    return JobResponse(
        id=job_id,
        project_id=project_id,
        job_type=d.get("jobType", "auto_label"),
        queue_name=queue_map.get(d.get("jobType", ""), "batch"),
        status=d.get("status", "queued"),
        progress=d.get("progress", 0),
        progress_message=d.get("progressMessage"),
        total_items=d.get("totalItems", 0),
        processed_items=d.get("processedItems", 0),
        result=d.get("result"),
        error_message=d.get("errorMessage"),
    )


def _resolve_project_for_job(job_id: str) -> str | None:
    return repo.get_job_registry_project(job_id)


@jobs_router.get("/{job_id}", response_model=JobResponse)
async def get_job_by_id(job_id: str, _: None = Depends(verify_api_key)):
    project_id = _resolve_project_for_job(str(job_id))
    if not project_id:
        raise HTTPException(status_code=404, detail="Job not found")
    d = await db(repo.get_labelling_job, project_id, str(job_id))
    if not d:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(project_id, str(job_id), d)


@api_router.get("/jobs/{project_id}/{job_id}", response_model=JobResponse)
async def get_job_for_project(
    project_id: str, job_id: str, _: None = Depends(verify_api_key)
):
    d = await db(repo.get_labelling_job, project_id, str(job_id))
    if not d:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(project_id, str(job_id), d)


# ===========================================================================
# Review queues + annotations
# ===========================================================================

@api_router.get("/review-queues/{project_id}")
async def review_queues(
    project_id: str, queue_type: str | None = None, _: None = Depends(verify_api_key)
):
    return {
        "counts": repo.review_queue_counts(project_id),
        "images": repo.list_images_by_queue(project_id, queue_type),
    }


@api_router.get("/annotations/{project_id}/{image_id}")
async def get_annotations(
    project_id: str, image_id: str, _: None = Depends(verify_api_key)
):
    image = repo.get_image(project_id, image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return {
        "image": image,
        "annotation": repo.get_annotation_for_image(project_id, image_id),
        "objects": repo.list_annotation_objects(project_id, image_id),
    }


@api_router.put("/annotations/{project_id}/{image_id}")
async def save_annotations(
    project_id: str,
    image_id: str,
    body: AnnotationsSave,
    _: None = Depends(verify_api_key),
):
    objects = [
        {
            "classId": o.class_id,
            "classIndex": o.class_index,
            "className": o.class_name,
            "xMin": o.x_min,
            "yMin": o.y_min,
            "xMax": o.x_max,
            "yMax": o.y_max,
            "confidence": o.confidence,
        }
        for o in body.objects
    ]
    ann_id = repo.save_image_annotations(
        project_id, image_id, objects, source="manual",
        auto_labeled=False, review_status="pending",
    )
    return {"ok": True, "annotationId": ann_id}


@api_router.post("/approve-image")
async def approve_image(body: ReviewAction, _: None = Depends(verify_api_key)):
    repo.set_review_status(body.project_id, body.image_id, "approved")
    return {"ok": True}


@api_router.post("/reject-image")
async def reject_image(body: ReviewAction, _: None = Depends(verify_api_key)):
    repo.set_review_status(body.project_id, body.image_id, "rejected")
    return {"ok": True}


# ===========================================================================
# Export → Hugging Face Hub
# ===========================================================================

@api_router.post("/export")
async def export(body: ExportRequest, _: None = Depends(verify_api_key)):
    _check_upload_config()
    export_job_id = repo.create_export_job(body.project_id, body.export_format)
    try:
        zip_bytes, file_name = await asyncio.to_thread(
            export_builder.build_export, body.project_id, body.export_format
        )
        loc = file_storage.upload_export(body.project_id, file_name, zip_bytes)
        repo.complete_export_job(
            body.project_id, export_job_id, hf_repo=loc["hfRepo"], hf_path=loc["hfPath"]
        )
        return {
            "exportJobId": export_job_id,
            "hfRepo": loc["hfRepo"],
            "hfPath": loc["hfPath"],
            "fileName": file_name,
        }
    except ValueError as exc:
        repo.fail_export_job(body.project_id, export_job_id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Export failed")
        repo.fail_export_job(body.project_id, export_job_id, str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@api_router.post("/export/download")
async def export_download(body: ExportRequest, _: None = Depends(verify_api_key)):
    """Build export ZIP (images + labels) and return it as a file download."""
    try:
        zip_bytes, file_name = await asyncio.to_thread(
            export_builder.build_export, body.project_id, body.export_format
        )
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{file_name}"',
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Export download failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
