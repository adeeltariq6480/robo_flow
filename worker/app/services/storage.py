"""Resolve model/image files from local storage first, then Hugging Face Hub."""

import logging
import threading
from pathlib import Path

from huggingface_hub.utils import HfHubHTTPError

from app.config import settings
from app.services import hf_storage as file_storage
from app.services.supabase_repo import (
    get_image,
    get_model,
    get_project_class_map as _class_map,
    update_image_storage_fields,
)

logger = logging.getLogger(__name__)
_MODEL_DOWNLOAD_LOCK = threading.Lock()


def persist_model_bytes_locally(project_id: str, file_name: str, data: bytes) -> Path:
    target_dir = settings.model_files_dir / project_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / file_name
    target_path.write_bytes(data)
    logger.info("Model saved locally project=%s path=%s", project_id, target_path)
    return target_path


def _model_local_candidates(project_id: str, local_name: str) -> tuple[Path, Path]:
    project_path = settings.model_files_dir / project_id / local_name
    global_path = settings.model_files_dir / local_name
    logger.info("checking project local model path: %s", project_path)
    logger.info("checking global local model path: %s", global_path)
    return project_path, global_path


def _resolve_existing_model_path(project_id: str, local_name: str) -> Path | None:
    project_path, global_path = _model_local_candidates(project_id, local_name)
    if project_path.exists() and project_path.stat().st_size > 0:
        logger.info("local model found: %s", project_path)
        return project_path
    if global_path.exists() and global_path.stat().st_size > 0:
        logger.info("local model found: %s", global_path)
        return global_path
    return None


def download_model(model_id: str, project_id: str) -> Path:
    row = get_model(project_id, model_id)
    if not row:
        raise ValueError(f"Model {model_id} not found in project {project_id}")
    repo = row.get("hfRepo")
    path = row.get("hfPath")
    if not repo or not path:
        raise ValueError(f"Model {model_id} has no storage location")
    local_name = file_storage.model_cache_local_name_from_path(path)
    project_local_name = f"{project_id}/{local_name}"
    with _MODEL_DOWNLOAD_LOCK:
        logger.info(
            "Model download selected storage path project=%s model=%s repo=%s path=%s local=%s",
            project_id,
            model_id,
            repo,
            path,
            project_local_name,
        )

        existing_path = _resolve_existing_model_path(project_id, local_name)
        if existing_path is not None:
            return existing_path

        logger.info("Hugging Face download started repo=%s path=%s", repo, path)
        try:
            downloaded = file_storage.download_to_local(
                repo,
                path,
                repo_type=file_storage.REPO_TYPE_MODEL,
                local_name=project_local_name,
            )
        except HfHubHTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status == 404:
                logger.warning("Hugging Face model missing 404 repo=%s path=%s", repo, path)
                raise FileNotFoundError(
                    "Model file not found locally or on Hugging Face. Please re-upload this model."
                ) from exc
            logger.exception("Model download failed with full error for %s", model_id)
            raise RuntimeError(f"Model download failed for {model_id}: {exc}") from exc
        except Exception as exc:
            logger.exception("File download failed with full error for %s", model_id)
            raise RuntimeError(f"Model download failed for {model_id}: {exc}") from exc

        logger.info("Model download completed: %s", downloaded)
        return downloaded


def resolve_model_local_path(model_id: str, project_id: str) -> Path:
    row = get_model(project_id, model_id)
    if not row:
        raise ValueError(f"Model {model_id} not found in project {project_id}")
    path = row.get("hfPath")
    if not path:
        raise ValueError(f"Model {model_id} has no storage location")
    local_name = file_storage.model_cache_local_name_from_path(path)
    project_path = settings.model_files_dir / project_id / local_name
    global_path = settings.model_files_dir / local_name
    if project_path.exists() and project_path.stat().st_size > 0:
        return project_path
    if global_path.exists() and global_path.stat().st_size > 0:
        return global_path
    return project_path


def resolve_image_path(row: dict, image_id: str) -> Path | None:
    local_path = row.get("localPath") or row.get("local_path")
    if settings.auto_label_use_local_images and local_path:
        candidate = Path(local_path)
        if candidate.exists() and candidate.is_file():
            logger.info("Auto-label using local image %s for %s", candidate, image_id)
            return candidate

    hf_path = row.get("hfPath")
    if not hf_path:
        logger.warning("Image %s has no remote HF path", image_id)
        return None

    if not settings.auto_label_use_local_images:
        logger.info("Auto-label falling back to HF image for %s", image_id)
    else:
        logger.info("Auto-label local image missing; falling back to HF for %s", image_id)

    try:
        downloaded = file_storage.download_to_local(
            row.get("hfRepo", settings.dataset_repo_id),
            hf_path,
            repo_type=file_storage.REPO_TYPE_DATASET,
        )
        # Cache HF images into project dataset local folder for future reuse
        try:
            project_id = row.get("projectId") or row.get("project_id")
            dataset_id = row.get("datasetId") or row.get("dataset_id")
            file_name = row.get("fileName") or Path(hf_path).name
            if project_id and dataset_id:
                dest_dir = settings.dataset_files_dir / str(project_id) / str(dataset_id) / "images"
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest_path = dest_dir / file_name
                if not dest_path.exists() or dest_path.stat().st_size == 0:
                    dest_path.write_bytes(downloaded.read_bytes())
                    # update DB local path for this image
                    try:
                        update_image_storage_fields(str(project_id), image_id, {"localPath": str(dest_path), "storageStatus": "local_ready"})
                    except Exception:
                        logger.exception("Failed to update image local path for %s", image_id)
                return dest_path
        except Exception:
            logger.exception("Failed to cache HF image locally for %s", image_id)
        return downloaded
    except Exception as exc:
        logger.warning("HF image unavailable for %s: %s", image_id, exc)
        return None


def download_image(repo: str, path: str, image_id: str) -> Path:
    logger.debug("Downloading image %s from %s/%s", image_id, repo, path)
    return file_storage.download_to_local(
        repo, path, repo_type=file_storage.REPO_TYPE_DATASET
    )


def download_image_by_id(project_id: str, image_id: str) -> Path:
    row = get_image(project_id, image_id)
    if not row:
        raise ValueError(f"Image {image_id} not found")
    repo, path = row.get("hfRepo"), row.get("hfPath")
    if not repo or not path:
        raise ValueError(f"Image {image_id} has no storage location")
    return download_image(repo, path, image_id)


def download_image_row(row: dict, image_id: str) -> Path:
    resolved = resolve_image_path(row, image_id)
    if resolved is not None:
        return resolved
    repo, path = row.get("hfRepo"), row.get("hfPath")
    if not repo or not path:
        raise ValueError(f"Image {image_id} has no storage location")
    raise FileNotFoundError(f"Image {image_id} missing locally and on Hugging Face")


def get_project_class_map(project_id: str) -> dict[str, str]:
    base = _class_map(project_id)
    mapping: dict[str, str] = dict(base)
    for name, class_id in base.items():
        mapping[name.strip().lower()] = class_id
    return mapping


def build_class_name_map(project_id: str, user_map: dict[str, str]) -> dict[str, str]:
    project_classes = get_project_class_map(project_id)
    return {
        yolo_name: project_name
        for yolo_name, project_name in user_map.items()
        if project_name in project_classes
    }
