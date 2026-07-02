import io
import logging
import zipfile
import asyncio

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
    ProjectCreate,
    ProjectUpdate,
    ReviewAction,
    TestRunRequest,
)
from app.services import export_builder, hf_storage, image_preprocess
from app.services import firestore_repo as repo
from app.services.firebase_client import get_db

logger = logging.getLogger(__name__)

jobs_router = APIRouter(prefix="/jobs", tags=["jobs"])
api_router = APIRouter(prefix="/api", tags=["api"])

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


async def verify_api_key(x_worker_key: str = Header(default="")) -> None:
    # Open in local no-auth mode; only enforce when a key is configured.
    if settings.worker_api_key and x_worker_key != settings.worker_api_key:
        raise HTTPException(status_code=401, detail="Invalid worker API key")


def _check_upload_config() -> None:
    """Fail fast with a clear message when Railway env is incomplete."""
    missing: list[str] = []
    if not settings.hf_token:
        missing.append("HF_TOKEN")
    if not settings.dataset_repo_id:
        missing.append("HF_DATASET_REPO (or HF_USERNAME)")
    has_firebase = bool(
        settings.firebase_service_account_json.strip()
        or settings.google_application_credentials.strip()
    )
    if not has_firebase:
        missing.append("FIREBASE_SERVICE_ACCOUNT_JSON")
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
    hf_path = hf_storage.dataset_image_path(project_id, dataset_id, filename)
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
        hf_storage.upload_dataset_image,
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


# ===========================================================================
# Projects
# ===========================================================================

@api_router.post("/projects")
async def create_project(body: ProjectCreate, _: None = Depends(verify_api_key)):
    return repo.create_project(body.name, body.description, body.annotation_type)


@api_router.get("/projects")
async def list_projects(_: None = Depends(verify_api_key)):
    return repo.list_projects()


@api_router.get("/projects/{project_id}")
async def get_project(project_id: str, _: None = Depends(verify_api_key)):
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@api_router.get("/projects/{project_id}/stats")
async def get_project_stats(project_id: str, _: None = Depends(verify_api_key)):
    return repo.get_project_stats(project_id)


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
    return repo.save_classes(body.project_id, classes)


@api_router.get("/classes/{project_id}")
async def get_classes(project_id: str, _: None = Depends(verify_api_key)):
    return repo.list_classes(project_id)


# ===========================================================================
# Datasets
# ===========================================================================

@api_router.post("/datasets")
async def create_dataset(body: DatasetCreate, _: None = Depends(verify_api_key)):
    return repo.create_dataset(body.project_id, body.name, hf_repo=settings.dataset_repo_id)


@api_router.get("/datasets/{project_id}")
async def list_datasets(project_id: str, _: None = Depends(verify_api_key)):
    return repo.list_datasets(project_id)


@api_router.get("/datasets/{project_id}/{dataset_id}")
async def get_dataset(project_id: str, dataset_id: str, _: None = Depends(verify_api_key)):
    ds = repo.get_dataset(project_id, dataset_id)
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
# Uploads → Hugging Face
# ===========================================================================

@api_router.post("/upload-images")
async def upload_images(
    project_id: str = Form(...),
    dataset_id: str = Form(...),
    files: list[UploadFile] = File(...),
    _: None = Depends(verify_api_key),
):
    _check_upload_config()
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    created: list[dict] = []
    skipped: list[dict] = []
    adjusted: list[dict] = []

    raw_files: list[tuple[UploadFile, bytes]] = []
    for f in files:
        data = await f.read()
        if data:
            raw_files.append((f, data))

    prep_sem = asyncio.Semaphore(max(1, settings.upload_preprocess_workers))

    async def prepare_one(upload: UploadFile, data: bytes):
        filename = _safe_filename(upload.filename)
        async with prep_sem:
            result, skip_info, adjust_info = await asyncio.to_thread(
                _preprocess_upload_item, data, filename
            )
        return filename, upload.content_type, result, skip_info, adjust_info

    prep_results = await asyncio.gather(
        *[prepare_one(f, data) for f, data in raw_files],
        return_exceptions=True,
    )

    ready: list[tuple[str, image_preprocess.PreprocessResult, str | None]] = []
    for outcome in prep_results:
        if isinstance(outcome, Exception):
            logger.exception("preprocess failed")
            raise HTTPException(status_code=500, detail=str(outcome)) from outcome

        filename, content_type, result, skip_info, adjust_info = outcome
        if skip_info:
            skipped.append(skip_info)
            continue
        if adjust_info:
            adjusted.append(adjust_info)
        if result is not None:
            ready.append((filename, result, content_type))

    if ready:
        hf_items = [(filename, result.data) for filename, result, _ in ready]
        try:
            hf_info = await asyncio.to_thread(
                hf_storage.upload_dataset_images_batch,
                project_id,
                dataset_id,
                hf_items,
            )
        except RuntimeError as exc:
            logger.exception("HF batch upload failed")
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("HF batch upload failed")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        hf_repo = hf_info["hfRepo"]
        fs_sem = asyncio.Semaphore(max(1, settings.upload_firestore_workers))

        async def record_one(
            filename: str,
            result: image_preprocess.PreprocessResult,
            content_type: str | None,
        ):
            async with fs_sem:
                return await _create_image_record(
                    project_id, dataset_id, filename, result, content_type, hf_repo
                )

        records = await asyncio.gather(
            *[
                record_one(filename, result, content_type)
                for filename, result, content_type in ready
            ],
            return_exceptions=True,
        )
        for record in records:
            if isinstance(record, Exception):
                logger.exception("Firestore image record failed")
                raise HTTPException(status_code=500, detail=str(record)) from record
            created.append(record)

    await asyncio.to_thread(repo.recount_dataset_images, project_id, dataset_id)
    return {
        "uploaded": len(created),
        "images": created,
        "skipped": skipped,
        "adjusted": adjusted,
    }


@api_router.post("/upload-zip")
async def upload_zip(
    project_id: str = Form(...),
    dataset_id: str = Form(...),
    file: UploadFile = File(...),
    _: None = Depends(verify_api_key),
):
    raw = await file.read()
    hf_storage.upload_dataset_zip(project_id, dataset_id, file.filename, raw)

    created = []
    skipped = []
    adjusted = []
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            for name in zf.namelist():
                if name.endswith("/") or not name.lower().endswith(IMAGE_EXTS):
                    continue
                data = zf.read(name)
                base = name.rsplit("/", 1)[-1]
                image, skip_info, adjust_info = await _upload_one_image(
                    project_id, dataset_id, base, data
                )
                if skip_info:
                    skipped.append(skip_info)
                    continue
                if adjust_info:
                    adjusted.append(adjust_info)
                created.append(image)
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")

    await asyncio.to_thread(repo.recount_dataset_images, project_id, dataset_id)
    return {
        "uploaded": len(created),
        "images": created,
        "skipped": skipped,
        "adjusted": adjusted,
    }


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
    data = await file.read()
    loc = hf_storage.upload_model_file(project_id, file.filename, data)
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


@api_router.get("/models/{project_id}")
async def list_models(project_id: str, _: None = Depends(verify_api_key)):
    return repo.list_models(project_id)


@api_router.delete("/models/{project_id}/{model_id}")
async def delete_model(project_id: str, model_id: str, _: None = Depends(verify_api_key)):
    repo.delete_model(project_id, model_id)
    return {"ok": True}


# ===========================================================================
# Image content proxy (HF repos are private)
# ===========================================================================

@api_router.get("/images/{project_id}/{image_id}/content")
async def image_content(project_id: str, image_id: str, _: None = Depends(verify_api_key)):
    img = repo.get_image(project_id, image_id)
    if not img or not img.get("hfRepo") or not img.get("hfPath"):
        raise HTTPException(status_code=404, detail="Image not found")
    data = hf_storage.download_bytes(
        img["hfRepo"], img["hfPath"], repo_type=hf_storage.REPO_TYPE_DATASET
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
    job_id, queue, position = await submit_job(
        body.project_id, JobType.AUTO_LABEL,
        model_id=model_ids[0], model_ids=model_ids,
        dataset_id=body.dataset_id, config=body.config, total_items=total,
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
    doc = get_db().collection("jobRegistry").document(job_id).get()
    return doc.to_dict().get("projectId") if doc.exists else None


@jobs_router.get("/{job_id}", response_model=JobResponse)
async def get_job_by_id(job_id: str, _: None = Depends(verify_api_key)):
    project_id = _resolve_project_for_job(str(job_id))
    if not project_id:
        raise HTTPException(status_code=404, detail="Job not found")
    d = repo.get_labelling_job(project_id, str(job_id))
    if not d:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(project_id, str(job_id), d)


@api_router.get("/jobs/{project_id}/{job_id}", response_model=JobResponse)
async def get_job_for_project(
    project_id: str, job_id: str, _: None = Depends(verify_api_key)
):
    d = repo.get_labelling_job(project_id, str(job_id))
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
# Export → Hugging Face
# ===========================================================================

@api_router.post("/export")
async def export(body: ExportRequest, _: None = Depends(verify_api_key)):
    export_job_id = repo.create_export_job(body.project_id, body.export_format)
    try:
        zip_bytes, file_name = await asyncio.to_thread(
            export_builder.build_export, body.project_id, body.export_format
        )
        loc = hf_storage.upload_export(body.project_id, file_name, zip_bytes)
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
