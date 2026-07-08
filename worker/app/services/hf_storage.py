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
import time
from functools import lru_cache
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download
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

    try:
        _api().create_repo(
            repo_id=repo_id,
            repo_type=repo_type,
            private=True,
            exist_ok=True,
        )
    except HfHubHTTPError as exc:
        if exc.response is not None and exc.response.status_code == 409:
            logger.info("HF repo already exists at %s — continuing", repo_id)
            return
        raise


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


def model_cache_local_name_from_path(path_in_repo: str) -> str:
    base = path_in_repo.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not base:
        return "model.pt"
    if Path(base).suffix:
        return base
    return f"{base}.pt"


def model_local_cache_path(local_name: str, project_id: str | None = None) -> Path:
    path = settings.model_files_dir
    if project_id:
        path = path / project_id
    path.mkdir(parents=True, exist_ok=True)
    return path / local_name


def persist_model_bytes_locally(project_id: str, file_name: str, data: bytes) -> Path:
    target_dir = settings.model_files_dir / project_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / file_name
    target_path.write_bytes(data)
    logger.info("Model saved locally project=%s path=%s", project_id, target_path)
    return target_path


def hf_dataset_upload_enabled() -> bool:
    return bool(settings.hf_upload_enabled and settings.hf_token and settings.dataset_repo_id)


def hf_model_upload_enabled() -> bool:
    return bool(settings.hf_upload_enabled and settings.hf_token and settings.model_repo_id)


def hf_upload_enabled() -> bool:
    return hf_dataset_upload_enabled() or hf_model_upload_enabled()


def _format_hf_error(exc: Exception) -> str:
    if isinstance(exc, HfHubHTTPError):
        status = exc.response.status_code if exc.response is not None else None
        text = str(exc)
        if status == 401:
            return "Hugging Face rejected HF_TOKEN (401). Check token value and permissions."
        if status == 403:
            return "Hugging Face denied access (403). Token needs write access to this repo."
        if status == 404:
            return "Hugging Face repo or path was not found (404). Check repo id and repo type."
        if status == 429:
            return "Hugging Face rate limit reached (429). Wait and retry with fewer commits."
        if status:
            return f"Hugging Face returned HTTP {status}: {text}"
        return f"Hugging Face error: {text}"
    return str(exc)


def _verify_repo_file(repo_id: str, repo_type: str, path_in_repo: str) -> None:
    _verify_repo_files(repo_id, repo_type, [path_in_repo])


def _verify_repo_files(repo_id: str, repo_type: str, paths_in_repo: list[str]) -> None:
    try:
        files = _api().list_repo_files(repo_id=repo_id, repo_type=repo_type)
    except Exception as exc:
        raise RuntimeError(
            f"Uploaded files, but could not verify Hugging Face repo files: {_format_hf_error(exc)}"
        ) from exc
    file_set = set(files)
    missing = [path for path in paths_in_repo if path not in file_set]
    if missing:
        raise RuntimeError(
            f"Hugging Face upload did not make {len(missing)} file(s) available in repo {repo_id} ({repo_type}). "
            f"Examples: {missing[:5]}"
        )


def _repo_file_exists(repo_id: str, repo_type: str, path_in_repo: str) -> bool:
    try:
        files = _api().list_repo_files(repo_id=repo_id, repo_type=repo_type)
    except Exception as exc:
        logger.warning(
            "Could not check Hugging Face file existence repo=%s repo_type=%s path=%s: %s",
            repo_id,
            repo_type,
            path_in_repo,
            _format_hf_error(exc),
        )
        return False
    return path_in_repo in set(files)


def _upload_with_retry(operation_name: str, fn):
    max_attempts = 5
    delay = 2.0
    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except HfHubHTTPError as exc:
            last_exc = exc
            status = exc.response.status_code if exc.response is not None else None
            detail = str(exc).lower()
            if status == 429:
                wait_for = min(165, delay)
                logger.warning(
                    "HF rate limit retry for %s (attempt %d/%d): waiting %.0fs",
                    operation_name,
                    attempt + 1,
                    max_attempts,
                    wait_for,
                )
                time.sleep(wait_for)
                delay *= 2
                continue
            if status in {500, 502, 503, 504} or "temporary" in detail:
                wait_for = min(60, delay)
                logger.warning(
                    "HF transient retry for %s (attempt %d/%d): waiting %.0fs",
                    operation_name,
                    attempt + 1,
                    max_attempts,
                    wait_for,
                )
                time.sleep(wait_for)
                delay *= 2
                continue
            if "no files have been modified" in detail or "empty commit" in detail:
                logger.info("HF upload produced no changes for %s; treating as already uploaded", operation_name)
                return None
            raise RuntimeError(_format_hf_error(exc)) from exc
        except Exception as exc:
            last_exc = exc
            if attempt < max_attempts - 1:
                wait_for = min(60, delay)
                logger.warning(
                    "HF retry for %s (attempt %d/%d): waiting %.0fs",
                    operation_name,
                    attempt + 1,
                    max_attempts,
                    wait_for,
                )
                time.sleep(wait_for)
                delay *= 2
                continue
            raise RuntimeError(_format_hf_error(exc)) from exc

    assert last_exc is not None
    logger.error("HF upload failed after retries for %s: %s", operation_name, last_exc)
    raise RuntimeError(_format_hf_error(last_exc)) from last_exc


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
        settings.dataset_repo_id if repo_type == settings.dataset_repo_type
        else settings.model_repo_id
    )
    if not repo_id:
        raise RuntimeError(
            f"Missing Hugging Face repo for repo_type={repo_type}. "
            "Set HF_DATASET_REPO or HF_MODEL_REPO as appropriate."
        )
    logger.info("Hugging Face upload started repo=%s repo_type=%s path=%s", repo_id, repo_type, path_in_repo)
    _ensure_repo(repo_id, repo_type)
    with _hf_commit_lock:
        def _do_upload():
            _api().upload_file(
                path_or_fileobj=data,
                path_in_repo=path_in_repo,
                repo_id=repo_id,
                repo_type=repo_type,
                commit_message=commit_message or f"Upload {path_in_repo}",
            )

        try:
            _upload_with_retry(f"upload_file:{path_in_repo}", _do_upload)
        except HfHubHTTPError as exc:
            detail = str(exc).lower()
            if "no files have been modified" in detail or "empty commit" in detail:
                logger.info("HF file unchanged at %s — reusing existing blob", path_in_repo)
            else:
                raise
    _verify_repo_file(repo_id, repo_type, path_in_repo)
    return {"hfRepo": repo_id, "hfPath": path_in_repo, "repoType": repo_type}


def upload_dataset_image(
    project_id: str, dataset_id: str, file_name: str, data: bytes
) -> dict:
    target_path = dataset_image_path(project_id, dataset_id, file_name)
    logger.info(
        "Selected repo for image upload: %s (dataset) target=%s",
        settings.dataset_repo_id,
        target_path,
    )

    must_upload_remote = settings.is_vercel or not settings.local_storage_enabled
    if must_upload_remote and not hf_dataset_upload_enabled():
        raise RuntimeError(
            "Hugging Face upload is disabled; this deployment requires HF dataset storage."
        )

    # Always persist a local copy first so uploads and downstream jobs
    # (auto-label) can operate from local storage even if HF is disabled
    # or rate-limited.
    local_path = None
    local_dir = settings.dataset_files_dir / str(project_id) / str(dataset_id) / "images"
    if settings.local_storage_enabled and not settings.is_vercel:
        try:
            local_dir.mkdir(parents=True, exist_ok=True)
            local_path = local_dir / file_name
            local_path.write_bytes(data)
            logger.info("Saved dataset image locally: %s", local_path)
        except Exception:
            logger.exception("Failed to save dataset image locally: %s/%s", project_id, file_name)

    if hf_dataset_upload_enabled():
        loc = upload_bytes(
            data,
            repo_type=settings.dataset_repo_type,
            path_in_repo=target_path,
        )
        if local_path:
            loc["localPath"] = str(local_path)
        return loc

    return {
        "hfRepo": settings.dataset_repo_id,
        "hfPath": target_path,
        "repoType": settings.dataset_repo_type,
        "localPath": str(local_path) if local_path else None,
    }


def upload_dataset_images_batch(
    project_id: str,
    dataset_id: str,
    items: list[tuple[str, bytes]],
) -> dict:
    """Upload many images in a single HF commit via upload_folder."""
    if not items:
        raise ValueError("No images to upload")

    repo_id = settings.dataset_repo_id
    _ensure_repo(repo_id, settings.dataset_repo_type)

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
            def _do_upload():
                _api().upload_folder(
                    folder_path=str(tmp_path),
                    repo_id=repo_id,
                    repo_type=settings.dataset_repo_type,
                    path_in_repo=repo_folder,
                    commit_message=f"Upload {len(items)} images to dataset {dataset_id}",
                )

            _upload_with_retry(f"upload_folder:{repo_folder}", _do_upload)

    _verify_repo_files(
        repo_id,
        settings.dataset_repo_type,
        [f"{repo_folder}/{local_name}" for local_name in local_names],
    )

    return {"hfRepo": repo_id, "count": len(items), "localNames": local_names}


def upload_dataset_images_from_folder(
    project_id: str,
    dataset_id: str,
    folder_path: str,
    count: int,
) -> dict:
    """Upload an existing local folder in a single commit."""
    if not hf_dataset_upload_enabled():
        logger.info("HF upload disabled; skipping batch upload for dataset %s", dataset_id)
        return {"hfRepo": settings.dataset_repo_id, "count": count}
    repo_id = settings.dataset_repo_id
    _ensure_repo(repo_id, settings.dataset_repo_type)
    repo_folder = f"datasets/{project_id}/{dataset_id}/images"
    with _hf_commit_lock:
        def _do_upload():
            _api().upload_folder(
                folder_path=folder_path,
                repo_id=repo_id,
                repo_type=settings.dataset_repo_type,
                path_in_repo=repo_folder,
                commit_message=f"Upload {count} images to dataset {dataset_id}",
            )

        _upload_with_retry(f"upload_folder:{repo_folder}", _do_upload)
    _verify_repo_files(
        repo_id,
        settings.dataset_repo_type,
        [f"{repo_folder}/{local_file.name}" for local_file in Path(folder_path).iterdir() if local_file.is_file()],
    )
    return {"hfRepo": repo_id, "count": count}


def upload_labels_from_folder(
    project_id: str,
    dataset_id: str,
    folder_path: str,
    count: int,
) -> dict:
    """Upload a labels folder in a single commit under datasets/{project}/{dataset}/labels."""
    if not hf_dataset_upload_enabled():
        logger.info("HF upload disabled; skipping labels batch upload for dataset %s", dataset_id)
        return {"hfRepo": settings.dataset_repo_id, "count": count}
    repo_id = settings.dataset_repo_id
    _ensure_repo(repo_id, settings.dataset_repo_type)
    repo_folder = f"datasets/{project_id}/{dataset_id}/labels"
    with _hf_commit_lock:
        def _do_upload():
            _api().upload_folder(
                folder_path=folder_path,
                repo_id=repo_id,
                repo_type=settings.dataset_repo_type,
                path_in_repo=repo_folder,
                commit_message=f"Upload {count} labels to dataset {dataset_id}",
            )

        _upload_with_retry(f"upload_folder:{repo_folder}", _do_upload)
    _verify_repo_files(
        repo_id,
        settings.dataset_repo_type,
        [f"{repo_folder}/{local_file.name}" for local_file in Path(folder_path).iterdir() if local_file.is_file()],
    )
    return {"hfRepo": repo_id, "count": count}


def upload_labels_from_folder_batched(
    project_id: str,
    dataset_id: str,
    folder_path: str,
    *,
    batch_size: int = 200,
) -> dict:
    """Upload label files in batches to avoid HF commit rate spikes."""
    folder = Path(folder_path)
    files = [p for p in folder.iterdir() if p.is_file()] if folder.exists() else []
    if not files:
        return {"hfRepo": settings.dataset_repo_id, "count": 0, "batches": 0}
    if not hf_dataset_upload_enabled():
        logger.info("HF upload disabled; skipping batched labels upload for dataset %s", dataset_id)
        return {"hfRepo": settings.dataset_repo_id, "count": len(files), "batches": 0}

    repo_id = settings.dataset_repo_id
    _ensure_repo(repo_id, settings.dataset_repo_type)
    repo_folder = f"datasets/{project_id}/{dataset_id}/labels"
    batch_size = max(1, batch_size)
    uploaded = 0
    batches = 0

    for start in range(0, len(files), batch_size):
        batch = files[start : start + batch_size]
        with tempfile.TemporaryDirectory(dir=_temp_dir()) as tmp:
            tmp_path = Path(tmp)
            for source in batch:
                (tmp_path / source.name).write_bytes(source.read_bytes())

            with _hf_commit_lock:
                def _do_upload():
                    _api().upload_folder(
                        folder_path=str(tmp_path),
                        repo_id=repo_id,
                        repo_type=settings.dataset_repo_type,
                        path_in_repo=repo_folder,
                        commit_message=f"Upload {len(batch)} labels to dataset {dataset_id}",
                    )

                _upload_with_retry(f"upload_folder:{repo_folder}:labels:{start}", _do_upload)

        _verify_repo_files(
            repo_id,
            settings.dataset_repo_type,
            [f"{repo_folder}/{source.name}" for source in batch],
        )
        uploaded += len(batch)
        batches += 1

    return {"hfRepo": repo_id, "count": uploaded, "batches": batches}


def upload_dataset_zip(
    project_id: str, dataset_id: str, file_name: str, data: bytes
) -> dict:
    return upload_bytes(
        data,
        repo_type=settings.dataset_repo_type,
        path_in_repo=dataset_zip_path(project_id, dataset_id, file_name),
    )


def upload_model_file(
    project_id: str,
    file_name: str,
    data: bytes,
    *,
    skip_if_exists: bool = True,
) -> dict:
    target_path = model_path(project_id, file_name)
    logger.info("Selected repo for model upload: %s (model) target=%s", settings.model_repo_id, target_path)
    if not hf_model_upload_enabled():
        logger.info("Hugging Face upload is disabled; skipping model upload %s", file_name)
        return {"hfRepo": settings.model_repo_id, "hfPath": target_path, "repoType": settings.model_repo_type}

    repo_id = settings.model_repo_id
    repo_type = settings.model_repo_type
    _ensure_repo(repo_id, repo_type)
    if skip_if_exists and _repo_file_exists(repo_id, repo_type, target_path):
        logger.info(
            "Model already exists on Hugging Face; reusing without new commit repo=%s repo_type=%s path=%s",
            repo_id,
            repo_type,
            target_path,
        )
        return {
            "hfRepo": repo_id,
            "hfPath": target_path,
            "repoType": repo_type,
            "alreadyExists": True,
        }

    return upload_bytes(
        data,
        repo_type=repo_type,
        path_in_repo=target_path,
        commit_message=f"Upload model {file_name}",
    )


def upload_export(project_id: str, file_name: str, data: bytes) -> dict:
    return upload_bytes(
        data,
        repo_type=settings.dataset_repo_type,
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
    """Download a file from HF Hub with a persistent local cache copy."""
    logger.debug("HF download %s (%s) %s", repo_id, repo_type, path_in_repo)
    if repo_type == settings.model_repo_type:
        logger.info("Model HF download only; no Hugging Face commit will be created path=%s", path_in_repo)

    if repo_type == settings.model_repo_type:
        cache_root = settings.model_files_dir
    else:
        cache_root = settings.hf_cache_dir
    cache_root.mkdir(parents=True, exist_ok=True)

    file_name = local_name or Path(path_in_repo).name
    dest = cache_root / file_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Selected storage path: %s", dest)
    logger.info("Checking file: %s", dest)
    if dest.exists() and dest.stat().st_size > 0:
        logger.info("File already exists locally: %s", dest)
        return dest

    try:
        cached = Path(
            hf_hub_download(
                repo_id=repo_id,
                filename=path_in_repo,
                repo_type=repo_type,
                token=settings.hf_token or None,
                cache_dir=str(settings.hf_cache_dir),
            )
        )
    except Exception:
        logger.exception("File download failed with full error: %s/%s", repo_id, path_in_repo)
        raise

    if cached.exists():
        if cached.resolve() != dest.resolve():
            dest.write_bytes(cached.read_bytes())
        logger.info("Download completed: %s", dest)
        return dest

    raise RuntimeError(f"HF download returned no file for {repo_id}/{path_in_repo}")


def download_to_temp(
    repo_id: str,
    path_in_repo: str,
    *,
    repo_type: str,
) -> Path:
    """Download a file from HF Hub to a temporary local path for ephemeral inference."""
    source = download_to_local(repo_id, path_in_repo, repo_type=repo_type)
    settings.storage_base_path.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix="hf-temp-", dir=settings.storage_base_path))
    temp_path = temp_dir / Path(path_in_repo).name
    temp_path.write_bytes(source.read_bytes())
    logger.info("Downloaded HF file to temp path: %s", temp_path)
    return temp_path


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
