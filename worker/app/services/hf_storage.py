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
import tempfile
import threading
from functools import lru_cache
from pathlib import Path

from huggingface_hub import CommitOperationDelete, HfApi, hf_hub_download
from huggingface_hub.utils import HfHubHTTPError

from app.config import settings

logger = logging.getLogger(__name__)

REPO_TYPE_DATASET = "dataset"
REPO_TYPE_MODEL = "model"

# HF free tier: ~128 repo commits/hour — serialize commits + batch per request.
_hf_commit_lock = threading.Lock()


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
    with _hf_commit_lock:
        try:
            _api().upload_file(
                path_or_fileobj=data,
                path_in_repo=path_in_repo,
                repo_id=repo_id,
                repo_type=repo_type,
                commit_message=commit_message or f"Upload {path_in_repo}",
            )
        except HfHubHTTPError as exc:
            detail = str(exc).lower()
            if "no files have been modified" in detail or "empty commit" in detail:
                logger.info("HF file unchanged at %s — reusing existing blob", path_in_repo)
            else:
                raise
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
    """Upload many images in a single HF commit via upload_folder."""
    if not items:
        raise ValueError("No images to upload")

    repo_id = settings.dataset_repo_id
    _ensure_repo(repo_id, REPO_TYPE_DATASET)

    repo_folder = f"datasets/{project_id}/{dataset_id}/images"
    used_names: set[str] = set()
    local_names: list[str] = []

    with tempfile.TemporaryDirectory(dir=_temp_dir()) as tmp:
        tmp_path = Path(tmp)
        for file_name, data in items:
            local_name = _safe_local_name(file_name, used_names)
            local_names.append(local_name)
            (tmp_path / local_name).write_bytes(data)

        with _hf_commit_lock:
            try:
                _api().upload_folder(
                    folder_path=str(tmp_path),
                    repo_id=repo_id,
                    repo_type=REPO_TYPE_DATASET,
                    path_in_repo=repo_folder,
                    commit_message=f"Upload {len(items)} images to dataset {dataset_id}",
                )
            except HfHubHTTPError as exc:
                if exc.response is not None and exc.response.status_code == 429:
                    raise RuntimeError(
                        "Hugging Face commit rate limit reached. "
                        "Wait ~30 minutes or upload fewer images per session."
                    ) from exc
                raise

    return {"hfRepo": repo_id, "count": len(items), "localNames": local_names}


def upload_dataset_images_from_folder(
    project_id: str,
    dataset_id: str,
    folder_path: str,
    count: int,
) -> dict:
    """Upload an existing local folder in a single commit."""
    repo_id = settings.dataset_repo_id
    _ensure_repo(repo_id, REPO_TYPE_DATASET)
    repo_folder = f"datasets/{project_id}/{dataset_id}/images"
    with _hf_commit_lock:
        try:
            _api().upload_folder(
                folder_path=folder_path,
                repo_id=repo_id,
                repo_type=REPO_TYPE_DATASET,
                path_in_repo=repo_folder,
                commit_message=f"Upload {count} images to dataset {dataset_id}",
            )
        except HfHubHTTPError as exc:
            if exc.response is not None and exc.response.status_code == 429:
                raise RuntimeError(
                    "Hugging Face commit rate limit reached. "
                    "Wait ~30 minutes or upload fewer images per session."
                ) from exc
            raise
    return {"hfRepo": repo_id, "count": count}


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
    """Download a file from HF Hub. Uses HF cache; optional copy to temp dir."""
    logger.debug("HF download %s (%s) %s", repo_id, repo_type, path_in_repo)
    cached = Path(
        hf_hub_download(
            repo_id=repo_id,
            filename=path_in_repo,
            repo_type=repo_type,
            token=settings.hf_token or None,
        )
    )
    if not local_name:
        return cached

    dest = _temp_dir() / local_name
    if dest.exists() and dest.stat().st_size == cached.stat().st_size:
        return dest
    dest.write_bytes(cached.read_bytes())
    return dest


def download_bytes(repo_id: str, path_in_repo: str, *, repo_type: str) -> bytes:
    return download_to_local(repo_id, path_in_repo, repo_type=repo_type).read_bytes()


def delete_from_repo(repo_id: str, path_in_repo: str, *, repo_type: str) -> None:
    logger.debug("HF delete %s (%s) %s", repo_id, repo_type, path_in_repo)
    try:
        _api().delete_file(
            repo_id=repo_id,
            path_in_repo=path_in_repo,
            repo_type=repo_type,
            commit_message=f"Delete {path_in_repo}",
        )
    except HfHubHTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            logger.info("HF file already missing at %s — skipping delete", path_in_repo)
            return
        raise


def delete_paths_from_repo(
    repo_id: str,
    paths_in_repo: list[str],
    *,
    repo_type: str,
    commit_message: str | None = None,
) -> None:
    """Delete many repo paths in one HF commit."""
    paths = sorted({p for p in paths_in_repo if p})
    if not paths:
        return

    logger.debug("HF bulk delete %s (%s) %d paths", repo_id, repo_type, len(paths))
    operations = [CommitOperationDelete(path_in_repo=path) for path in paths]
    with _hf_commit_lock:
        try:
            _api().create_commit(
                repo_id=repo_id,
                repo_type=repo_type,
                operations=operations,
                commit_message=commit_message or f"Delete {len(paths)} files",
            )
        except HfHubHTTPError as exc:
            if exc.response is not None and exc.response.status_code == 429:
                raise RuntimeError(
                    "Hugging Face commit rate limit reached. "
                    "Wait about 1 hour before retrying deletes."
                ) from exc
            detail = str(exc).lower()
            if "no files have been modified" in detail or "empty commit" in detail:
                logger.info("HF bulk delete found no modified files")
                return
            raise
