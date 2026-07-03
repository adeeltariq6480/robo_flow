"""Resolve model/image files by downloading them from Hugging Face Hub."""

import logging
import threading
from pathlib import Path

from app.services import hf_storage as file_storage
from app.services.supabase_repo import (
    get_image,
    get_model,
    get_project_class_map as _class_map,
)

logger = logging.getLogger(__name__)
_MODEL_DOWNLOAD_LOCK = threading.Lock()


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
        logger.info("Checking model file: %s", target_path)
        if target_path.exists() and target_path.stat().st_size > 0:
            logger.info("Model already exists locally: %s", target_path)
            return target_path

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
    return file_storage.model_local_cache_path(local_name)


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
    repo, path = row.get("hfRepo"), row.get("hfPath")
    if not repo or not path:
        raise ValueError(f"Image {image_id} has no storage location")
    return download_image(repo, path, image_id)


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
