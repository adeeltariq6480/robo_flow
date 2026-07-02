"""Hugging Face Hub storage — the canonical store for all binary files.

Folder layout
-------------
Dataset repo (HF dataset):
    datasets/{projectId}/{datasetId}/images/{fileName}
    datasets/{projectId}/{datasetId}/zips/{fileName}
    labels/{projectId}/...
    exports/{projectId}/{fileName}

Model repo (HF model):
    models/{projectId}/{fileName}
"""

import logging
from functools import lru_cache
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download

from app.config import settings

logger = logging.getLogger(__name__)

REPO_TYPE_DATASET = "dataset"
REPO_TYPE_MODEL = "model"


@lru_cache(maxsize=1)
def _api() -> HfApi:
    if not settings.hf_token:
        raise RuntimeError("HF_TOKEN is not configured for the backend.")
    return HfApi(token=settings.hf_token)


def _ensure_repo(repo_id: str, repo_type: str) -> None:
    if not repo_id:
        raise RuntimeError(
            f"Missing Hugging Face {repo_type} repo. Set HF_DATASET_REPO / "
            "HF_MODEL_REPO (or HF_USERNAME) in the backend env."
        )
    _api().create_repo(
        repo_id=repo_id,
        repo_type=repo_type,
        private=True,
        exist_ok=True,
    )


def _temp_dir() -> Path:
    path = Path(settings.temp_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def dataset_image_path(project_id: str, dataset_id: str, file_name: str) -> str:
    return f"datasets/{project_id}/{dataset_id}/images/{file_name}"


def dataset_zip_path(project_id: str, dataset_id: str, file_name: str) -> str:
    return f"datasets/{project_id}/{dataset_id}/zips/{file_name}"


def label_path(project_id: str, file_name: str) -> str:
    return f"labels/{project_id}/{file_name}"


def export_path(project_id: str, file_name: str) -> str:
    return f"exports/{project_id}/{file_name}"


def model_path(project_id: str, file_name: str) -> str:
    return f"models/{project_id}/{file_name}"


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

def upload_bytes(
    data: bytes,
    *,
    repo_type: str,
    path_in_repo: str,
    commit_message: str | None = None,
) -> dict:
    repo_id = (
        settings.dataset_repo_id if repo_type == REPO_TYPE_DATASET
        else settings.model_repo_id
    )
    _ensure_repo(repo_id, repo_type)
    _api().upload_file(
        path_or_fileobj=data,
        path_in_repo=path_in_repo,
        repo_id=repo_id,
        repo_type=repo_type,
        commit_message=commit_message or f"Upload {path_in_repo}",
    )
    return {"hfRepo": repo_id, "hfPath": path_in_repo, "repoType": repo_type}


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
    """Upload many images in one Hugging Face commit (much faster than one-by-one)."""
    if not items:
        raise ValueError("No images to upload")

    repo_id = settings.dataset_repo_id
    _ensure_repo(repo_id, REPO_TYPE_DATASET)

    files = [
        (dataset_image_path(project_id, dataset_id, file_name), data)
        for file_name, data in items
    ]

    _api().upload_files(
        repo_id=repo_id,
        repo_type=REPO_TYPE_DATASET,
        files=files,
        commit_message=f"Upload {len(files)} images to dataset {dataset_id}",
    )
    return {"hfRepo": repo_id, "count": len(files)}


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
    return upload_bytes(
        data,
        repo_type=REPO_TYPE_DATASET,
        path_in_repo=export_path(project_id, file_name),
    )


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def download_to_local(
    repo_id: str,
    path_in_repo: str,
    *,
    repo_type: str,
    local_name: str | None = None,
) -> Path:
    """Download a file from HF Hub into the worker temp dir."""
    cached = hf_hub_download(
        repo_id=repo_id,
        filename=path_in_repo,
        repo_type=repo_type,
        token=settings.hf_token or None,
    )
    if not local_name:
        return Path(cached)

    dest = _temp_dir() / local_name
    dest.write_bytes(Path(cached).read_bytes())
    return dest


def download_bytes(repo_id: str, path_in_repo: str, *, repo_type: str) -> bytes:
    return download_to_local(repo_id, path_in_repo, repo_type=repo_type).read_bytes()
