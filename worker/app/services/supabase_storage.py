"""Supabase Storage — canonical store for images, models, and exports.

API field names stay hfRepo / hfPath for frontend compatibility:
  hfRepo = bucket id (datasets | models | exports)
  hfPath = object path inside the bucket
"""

import logging
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from app.config import settings
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

REPO_TYPE_DATASET = "dataset"
REPO_TYPE_MODEL = "model"

BUCKET_DATASETS = "datasets"
BUCKET_MODELS = "models"
BUCKET_EXPORTS = "exports"

# pylint: disable=unused-argument
def _bucket_for_repo_type(repo_type: str) -> str:
    return BUCKET_MODELS if repo_type == REPO_TYPE_MODEL else BUCKET_DATASETS


def _temp_dir() -> Path:
    path = Path(settings.temp_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_local_name(file_name: str, used: set[str]) -> str:
    base = file_name.replace("\\", "/").rsplit("/", 1)[-1].strip() or "image.jpg"
    if base not in used:
        used.add(base)
        return base
    stem = Path(base).stem or "image"
    suffix = Path(base).suffix or ".jpg"
    n = 2
    while True:
        candidate = f"{stem}_{n}{suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        n += 1


def dataset_image_path(project_id: str, dataset_id: str, file_name: str) -> str:
    return f"{project_id}/{dataset_id}/images/{file_name}"


def dataset_zip_path(project_id: str, dataset_id: str, file_name: str) -> str:
    return f"{project_id}/{dataset_id}/zips/{file_name}"


def label_path(project_id: str, file_name: str) -> str:
    return f"labels/{project_id}/{file_name}"


def export_path(project_id: str, file_name: str) -> str:
    return f"{project_id}/{file_name}"


def model_path(project_id: str, file_name: str) -> str:
    return f"{project_id}/{file_name}"


def _upload_one(bucket: str, path: str, data: bytes) -> None:
    sb = get_supabase()
    sb.storage.from_(bucket).upload(
        path,
        data,
        file_options={"upsert": "true"},
    )


def upload_bytes(
    data: bytes,
    *,
    repo_type: str,
    path_in_repo: str,
    commit_message: str | None = None,
) -> dict:
    bucket = _bucket_for_repo_type(repo_type)
    _upload_one(bucket, path_in_repo, data)
    return {"hfRepo": bucket, "hfPath": path_in_repo, "repoType": repo_type}


def upload_dataset_image(
    project_id: str, dataset_id: str, file_name: str, data: bytes
) -> dict:
    return upload_bytes(
        data,
        repo_type=REPO_TYPE_DATASET,
        path_in_repo=dataset_image_path(project_id, dataset_id, file_name),
    )


def upload_dataset_images_batch(
    project_id: str,
    dataset_id: str,
    items: list[tuple[str, bytes]],
) -> dict:
    if not items:
        raise ValueError("No images to upload")

    used_names: set[str] = set()
    local_names: list[str] = []
    uploads: list[tuple[str, bytes]] = []

    for file_name, data in items:
        local_name = _safe_local_name(file_name, used_names)
        local_names.append(local_name)
        path = dataset_image_path(project_id, dataset_id, local_name)
        uploads.append((path, data))

    workers = min(8, max(1, len(uploads)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(_upload_one, BUCKET_DATASETS, path, data)
            for path, data in uploads
        ]
        for fut in as_completed(futures):
            fut.result()

    return {"hfRepo": BUCKET_DATASETS, "count": len(items), "localNames": local_names}


def upload_dataset_images_from_folder(
    project_id: str,
    dataset_id: str,
    folder_path: str,
    count: int,
) -> dict:
    folder = Path(folder_path)
    items: list[tuple[str, bytes]] = []
    for p in sorted(folder.iterdir()):
        if p.is_file():
            items.append((p.name, p.read_bytes()))
    if not items:
        raise ValueError("No files in upload session folder")
    return upload_dataset_images_batch(project_id, dataset_id, items)


def upload_dataset_zip(
    project_id: str, dataset_id: str, file_name: str, data: bytes
) -> dict:
    return upload_bytes(
        data,
        repo_type=REPO_TYPE_DATASET,
        path_in_repo=dataset_zip_path(project_id, dataset_id, file_name),
    )


def upload_model_file(project_id: str, file_name: str, data: bytes) -> dict:
    return upload_bytes(
        data,
        repo_type=REPO_TYPE_MODEL,
        path_in_repo=model_path(project_id, file_name),
    )


def upload_export(project_id: str, file_name: str, data: bytes) -> dict:
    path = export_path(project_id, file_name)
    _upload_one(BUCKET_EXPORTS, path, data)
    return {"hfRepo": BUCKET_EXPORTS, "hfPath": path, "repoType": REPO_TYPE_DATASET}


def download_to_local(
    repo_id: str,
    path_in_repo: str,
    *,
    repo_type: str,
    local_name: str | None = None,
) -> Path:
    bucket = repo_id or _bucket_for_repo_type(repo_type)
    logger.debug("Supabase download %s/%s", bucket, path_in_repo)
    data = get_supabase().storage.from_(bucket).download(path_in_repo)
    if not local_name:
        dest = _temp_dir() / Path(path_in_repo).name
    else:
        dest = _temp_dir() / local_name
    dest.write_bytes(data)
    return dest


def download_bytes(repo_id: str, path_in_repo: str, *, repo_type: str) -> bytes:
    bucket = repo_id or _bucket_for_repo_type(repo_type)
    return get_supabase().storage.from_(bucket).download(path_in_repo)
