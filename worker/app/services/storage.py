"""Resolve model/image files by downloading them from Hugging Face Hub."""

import logging
from pathlib import Path

from app.services import hf_storage as file_storage
from app.services.supabase_repo import (
    get_image,
    get_model,
    get_project_class_map as _class_map,
)

logger = logging.getLogger(__name__)


def download_model(model_id: str, project_id: str) -> Path:
    row = get_model(project_id, model_id)
    if not row:
        raise ValueError(f"Model {model_id} not found in project {project_id}")
    repo = row.get("hfRepo")
    path = row.get("hfPath")
    if not repo or not path:
        raise ValueError(f"Model {model_id} has no storage location")
    logger.info("Downloading model %s from %s/%s", model_id, repo, path)
    return file_storage.download_to_local(
        repo,
        path,
        repo_type=file_storage.REPO_TYPE_MODEL,
        local_name=file_storage.model_cache_local_name_from_path(path),
    )


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
