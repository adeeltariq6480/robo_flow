import io
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
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Response,
    UploadFile,
)

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
from app.services.storage import resolve_model_local_path
from app.services.yolo_inference import describe_model_status

logger = logging.getLogger(__name__)

jobs_router = APIRouter(prefix="/jobs", tags=["jobs"])
api_router = APIRouter(prefix="/api", tags=["api"])

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
_upload_sessions: dict[str, dict] = {}
_upload_sessions_lock = threading.Lock()
_UPLOAD_BATCH_SIZE = 20
_UPLOAD_FLUSH_DELAY_SECONDS = 4.0


async def verify_api_key(x_worker_key: str = Header(default="")) -> None:
    # Open in local no-auth mode; only enforce when a key is configured.
    if settings.worker_api_key and x_worker_key != settings.worker_api_key:
        raise HTTPException(status_code=401, detail="Invalid worker API key")


async def db(fn, /, *args, **kwargs):
    """Run blocking Firestore/repo calls off the asyncio event loop."""
    return await asyncio.to_thread(fn, *args, **kwargs)


def _check_upload_config() -> None:
    """Fail fast when Supabase (metadata) or Hugging Face (files) is not configured."""
    missing: list[str] = []
    if not settings.supabase_configured:
        missing.append("SUPABASE_URL")
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
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
    loc = await asyncio.to_thread(
        file_storage.upload_dataset_image,
        project_id,
        dataset_id,
        filename,
        result.data,
    )
    return await asyncio.to_thread(
        repo.create_image,
        project_id,
        dataset_id,
        {
            "fileName": filename,
            "hfRepo": loc["hfRepo"],
            "hfPath": loc["hfPath"],
            "width": result.width,
            "height": result.height,
            "mimeType": result.mime_type or content_type,
            "fileSize": len(result.data),
        },
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
            await asyncio.to_thread(
                file_storage.upload_dataset_images_from_folder,
                session["project_id"],
                session["dataset_id"],
                str(batch_root),
                len(items),
            )
            logger.info(
                "Hugging Face upload success session=%s count=%d",
                session_id,
                len(items),
            )
            for item in items:
                await asyncio.to_thread(
                    repo.update_image_status,
                    session["project_id"],
                    item["image_id"],
                    "uploaded",
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
                    repo.update_image_status,
                    session["project_id"],
                    item["image_id"],
                    "failed",
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

        local_path = Path(session["dir"]) / stored_name
        local_path.write_bytes(result.data)
        logger.info(
            "Image received session=%s file=%s stored=%s",
            session_id,
            filename,
            stored_name,
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

                local_path = Path(session["dir"]) / stored_name
                local_path.write_bytes(result.data)

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
    loc = await asyncio.to_thread(
        file_storage.upload_model_file, project_id, file.filename, data
    )
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
