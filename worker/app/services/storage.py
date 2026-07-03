"""Resolve model/image files from local storage first, then Hugging Face Hub."""

import logging
import os
import threading
from pathlib import Path

from app.config import settings
from app.services import hf_storage as file_storage
from app.services.supabase_repo import (
    get_image,
    get_model,
    get_project_class_map as _class_map,
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


def download_model(model_id: str, project_id: str) -> Path:
    row = get_model(project_id, model_id)
    if not row:
        raise ValueError(f"Model {model_id} not found in project {project_id}")
    repo = row.get("hfRepo")
    path = row.get("hfPath")
    if not repo or not path:
        raise ValueError(f"Model {model_id} has no storage location")
    local_name = file_storage.model_cache_local_name_from_path(path)
    target_path = file_storage.model_local_cache_path(local_name)
    with _MODEL_DOWNLOAD_LOCK:
        logger.info(
            "Model download selected storage path project=%s model=%s repo=%s path=%s local=%s",
            project_id,
            model_id,
            repo,
            path,
            target_path,
        )
        if target_path.exists() and target_path.stat().st_size > 0:
            logger.info("Model already exists locally: %s", target_path)
            return target_path

        fallback_dir = settings.model_files_dir / project_id
        fallback_path = fallback_dir / local_name
        if fallback_path.exists() and fallback_path.stat().st_size > 0:
            logger.info("Model found in project local storage: %s", fallback_path)
            return fallback_path

        logger.info("Model download started: %s", target_path)
        try:
            downloaded = file_storage.download_to_local(
                repo,
                path,
                repo_type=file_storage.REPO_TYPE_MODEL,
                local_name=local_name,
            )
        except Exception as exc:
            logger.exception("Model download failed with full error for %s", model_id)
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
    candidate = file_storage.model_local_cache_path(local_name)
    fallback = settings.model_files_dir / project_id / local_name
    if candidate.exists() and candidate.stat().st_size > 0:
        return candidate
    if fallback.exists() and fallback.stat().st_size > 0:
        return fallback
    return candidate


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
        return file_storage.download_to_local(
            row.get("hfRepo", settings.dataset_repo_id),
            hf_path,
            repo_type=file_storage.REPO_TYPE_DATASET,
        )
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
