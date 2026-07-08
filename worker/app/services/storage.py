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


# ---------------------------------------------------------------------------
# Row helpers: support both API camelCase and DB snake_case
# ---------------------------------------------------------------------------

def _get_first(row: dict, *keys: str):
    for key in keys:
        value = row.get(key)
        if value is not None and value != "":
            return value
    return None


def _row_project_id(row: dict) -> str:
    return str(_get_first(row, "projectId", "project_id") or "")


def _row_dataset_id(row: dict) -> str:
    return str(_get_first(row, "datasetId", "dataset_id") or "")


def _row_file_name(row: dict) -> str:
    return str(_get_first(row, "fileName", "file_name", "filename", "name") or "")


def _row_hf_path(row: dict) -> str:
    return str(_get_first(row, "hfPath", "hf_path") or "")


def _row_hf_repo(row: dict) -> str:
    stored = str(_get_first(row, "hfRepo", "hf_repo") or "")
    hf_path = _row_hf_path(row)
    configured = settings.dataset_repo_id or ""
    # Dataset image paths must use the configured HF dataset repo.
    if hf_path.startswith("datasets/") and configured:
        if stored and stored != configured:
            logger.info(
                "Using configured dataset repo %s instead of stored %s for %s",
                configured,
                stored,
                hf_path,
            )
        return configured
    return stored or configured or ""


def _row_model_hf_repo(row: dict) -> str:
    return str(_get_first(row, "hfRepo", "hf_repo") or settings.model_repo_id or "")


def _row_local_path(row: dict) -> str:
    return str(_get_first(row, "localPath", "local_path") or "")


def infer_dataset_image_local_path(row: dict) -> Path | None:
    """Standard on-disk layout when DB local_path is missing."""
    row = _normalise_row(row)
    project_id = _row_project_id(row)
    dataset_id = _row_dataset_id(row)
    file_name = _row_file_name(row)
    if not (project_id and dataset_id and file_name):
        return None
    candidate = settings.dataset_files_dir / project_id / dataset_id / "images" / file_name
    if candidate.exists() and candidate.is_file():
        return candidate
    return None


def sync_local_images_to_hf(
    project_id: str, dataset_id: str, file_list: list[dict]
) -> int:
    """Upload local dataset images that never reached Hugging Face."""
    if not file_storage.hf_dataset_upload_enabled():
        return 0

    pending: list[tuple[str, bytes, str, str]] = []
    for raw in file_list:
        row = _normalise_row(raw)
        image_id = str(_get_first(row, "id") or "")
        file_name = _row_file_name(row)
        if not image_id or not file_name:
            continue
        if _image_hf_sync_status(row) == "synced":
            hf_path = _row_hf_path(row)
            repo = _row_hf_repo(row)
            if hf_path and repo and file_storage._repo_file_exists(
                repo, settings.dataset_repo_type, hf_path
            ):
                continue

        local = _row_local_path(row)
        local_path = Path(local) if local else None
        if not local_path or not local_path.exists():
            inferred = infer_dataset_image_local_path(row)
            if inferred is not None:
                local_path = inferred

        if local_path is None or not local_path.exists():
            continue

        try:
            pending.append((file_name, local_path.read_bytes(), image_id, str(local_path)))
        except Exception as exc:
            logger.warning("Could not read local image %s: %s", local_path, exc)

    if not pending:
        return 0

    uploaded = 0
    chunk_size = 100
    for offset in range(0, len(pending), chunk_size):
        chunk = pending[offset : offset + chunk_size]
        payload = [(name, data) for name, data, _, _ in chunk]
        try:
            file_storage.upload_dataset_images_batch(project_id, dataset_id, payload)
        except Exception as exc:
            logger.exception(
                "HF sync batch failed project=%s dataset=%s offset=%d: %s",
                project_id,
                dataset_id,
                offset,
                exc,
            )
            continue

        for file_name, _, image_id, local_str in chunk:
            try:
                update_image_storage_fields(
                    project_id,
                    image_id,
                    {
                        "hfRepo": settings.dataset_repo_id,
                        "hfPath": file_storage.dataset_image_path(
                            project_id, dataset_id, file_name
                        ),
                        "localPath": local_str,
                        "storage_status": "remote_ready",
                        "hf_sync_status": "synced",
                        "status": "uploaded",
                    },
                )
                uploaded += 1
            except Exception:
                logger.exception("Failed to update image after HF sync %s", image_id)

    if uploaded:
        logger.info(
            "Synced %d local image(s) to HF project=%s dataset=%s repo=%s",
            uploaded,
            project_id,
            dataset_id,
            settings.dataset_repo_id,
        )
    return uploaded


def _image_hf_sync_status(row: dict) -> str:
    return str(_get_first(row, "hfSyncStatus", "hf_sync_status") or "")


def _normalise_row(row: dict) -> dict:
    """Keep both snake_case and camelCase aliases in memory."""
    project_id = _row_project_id(row)
    dataset_id = _row_dataset_id(row)
    file_name = _row_file_name(row)
    hf_path = _row_hf_path(row)
    hf_repo = _row_hf_repo(row)
    local_path = _row_local_path(row)

    if project_id:
        row["projectId"] = project_id
        row["project_id"] = project_id

    if dataset_id:
        row["datasetId"] = dataset_id
        row["dataset_id"] = dataset_id

    if file_name:
        row["fileName"] = file_name
        row["file_name"] = file_name

    if hf_path:
        row["hfPath"] = hf_path
        row["hf_path"] = hf_path

    if hf_repo:
        row["hfRepo"] = hf_repo
        row["hf_repo"] = hf_repo

    if local_path:
        row["localPath"] = local_path
        row["local_path"] = local_path

    return row


# ---------------------------------------------------------------------------
# Model storage
# ---------------------------------------------------------------------------

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

    repo = _row_model_hf_repo(row)
    path = _row_hf_path(row)

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

        logger.info("Hugging Face model download started repo=%s path=%s", repo, path)

        try:
            downloaded = file_storage.download_to_local(
                repo,
                path,
                repo_type=settings.model_repo_type,
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

    path = _row_hf_path(row)

    if not path:
        raise ValueError(f"Model {model_id} has no storage location")

    local_name = file_storage.model_cache_local_name_from_path(path)
    project_path = settings.model_files_dir / project_id / local_name
    global_path = settings.model_files_dir / local_name

    if project_path.exists() and project_path.stat().st_size > 0:
        return project_path

    if global_path.exists() and global_path.stat().st_size > 0:
        return global_path

    return download_model(model_id, project_id)


# ---------------------------------------------------------------------------
# Image storage
# ---------------------------------------------------------------------------

def _should_use_local_auto_label_image() -> bool:
    return (
        settings.auto_label_use_local_images
        and settings.local_storage_enabled
        and not settings.is_vercel
    )


def _resolve_hf_path_by_filename(row: dict, image_id: str) -> str | None:
    """
    Find image in Hugging Face repo by filename.

    Priority:
    1. Exact DB hfPath/hf_path if it exists in repo.
    2. Expected datasets/{project}/{dataset}/images/{fileName}.
    3. Any datasets/.../images/{fileName} match.
    """
    row = _normalise_row(row)

    file_name = _row_file_name(row)
    project_id = _row_project_id(row)
    dataset_id = _row_dataset_id(row)
    repo_id = _row_hf_repo(row)
    exact_hf_path = _row_hf_path(row)

    if not repo_id:
        logger.warning(
            "Cannot resolve HF path image_id=%s because repo is missing",
            image_id,
        )
        return None

    if not file_name:
        logger.warning(
            "Cannot resolve HF path image_id=%s because fileName/file_name is missing row_keys=%s",
            image_id,
            list(row.keys()),
        )
        return None

    expected_path = ""
    if project_id and dataset_id:
        expected_path = f"datasets/{project_id}/{dataset_id}/images/{file_name}"

    try:
        repo_files = file_storage._api().list_repo_files(
            repo_id=repo_id,
            repo_type=settings.dataset_repo_type,
        )

    except Exception as exc:
        logger.exception(
            "Failed to list HF repo files for image %s repo=%s repo_type=%s: %s",
            image_id,
            repo_id,
            settings.dataset_repo_type,
            exc,
        )
        return None

    file_set = set(repo_files)
    selected = None

    if exact_hf_path and exact_hf_path in file_set:
        selected = exact_hf_path

    elif expected_path and expected_path in file_set:
        selected = expected_path

    else:
        matches = [
            path
            for path in repo_files
            if path.startswith("datasets/")
            and "/images/" in path
            and Path(path).name == file_name
        ]

        if matches:
            def score(path: str):
                return (
                    0 if dataset_id and f"/{dataset_id}/images/" in path else 1,
                    0 if project_id and path.startswith(f"datasets/{project_id}/") else 1,
                    len(path),
                )

            matches.sort(key=score)
            selected = matches[0]

            logger.warning(
                "Resolved HF image path by filename image_id=%s file_name=%s selected=%s matches=%s",
                image_id,
                file_name,
                selected,
                matches[:10],
            )

    if not selected:
        logger.warning(
            "HF image not found by filename image_id=%s file_name=%s exact_hf_path=%s expected_path=%s repo=%s",
            image_id,
            file_name,
            exact_hf_path,
            expected_path,
            repo_id,
        )
        return None

    if selected != exact_hf_path:
        try:
            if project_id:
                update_image_storage_fields(
                    str(project_id),
                    image_id,
                    {
                        "hf_path": selected,
                        "hf_sync_status": "synced",
                        "storage_status": "remote_ready",
                        "last_error": None,
                    },
                )

            row["hfPath"] = selected
            row["hf_path"] = selected
            row["hfSyncStatus"] = "synced"
            row["hf_sync_status"] = "synced"
            row["storageStatus"] = "remote_ready"
            row["storage_status"] = "remote_ready"

        except Exception:
            logger.exception("Failed to update image hf_path for %s", image_id)

    return selected


def resolve_hf_path_for_image(row: dict, image_id: str) -> str | None:
    row = _normalise_row(row)

    hf_path = _row_hf_path(row)

    # Important: exact DB path wins.
    if hf_path:
        return hf_path

    return _resolve_hf_path_by_filename(row, image_id)


def resolve_image_path(row: dict, image_id: str) -> Path | None:
    row = _normalise_row(row)

    if _should_use_local_auto_label_image():
        local_path = _row_local_path(row)
        if local_path:
            candidate = Path(local_path)
            if candidate.exists() and candidate.is_file():
                logger.info("Auto-label using local image %s for %s", candidate, image_id)
                return candidate

        inferred = infer_dataset_image_local_path(row)
        if inferred is not None:
            logger.info("Auto-label using inferred local image %s for %s", inferred, image_id)
            return inferred

        logger.info("Auto-label local image missing or unavailable for %s", image_id)

    repo_id = _row_hf_repo(row)
    file_name = _row_file_name(row)
    original_hf_path = _row_hf_path(row)
    hf_path = resolve_hf_path_for_image(row, image_id)

    if not hf_path:
        logger.warning(
            "Image %s has no remote HF path file_name=%s repo=%s row_keys=%s",
            image_id,
            file_name,
            repo_id,
            list(row.keys()),
        )
        return None

    if not repo_id:
        logger.warning(
            "Image %s has hf_path but no hf_repo. hf_path=%s",
            image_id,
            hf_path,
        )
        return None

    logger.info(
        "Auto-label using exact HF image path image_id=%s file_name=%s repo=%s repo_type=%s hf_path=%s",
        image_id,
        file_name,
        repo_id,
        settings.dataset_repo_type,
        hf_path,
    )

    download_fn = (
        file_storage.download_to_temp
        if not settings.use_local_images_for_auto_label
        else file_storage.download_to_local
    )

    try:
        return download_fn(
            repo_id,
            hf_path,
            repo_type=file_storage.REPO_TYPE_DATASET,
        )

    except Exception as exc:
        message = str(exc).lower()

        if "404" in message or "not found" in message:
            logger.warning(
                "HF image missing image_id=%s path=%s; trying filename repair",
                image_id,
                hf_path,
            )

            alt_path = _resolve_hf_path_by_filename(row, image_id)

            if alt_path and alt_path != hf_path:
                try:
                    logger.info(
                        "Retrying image download with alternate HF path image_id=%s alt_path=%s",
                        image_id,
                        alt_path,
                    )
                    return download_fn(
                        repo_id,
                        alt_path,
                        repo_type=file_storage.REPO_TYPE_DATASET,
                    )

                except Exception as secondary_exc:
                    logger.warning(
                        "Alternate HF image download failed image_id=%s alt_path=%s error=%s",
                        image_id,
                        alt_path,
                        secondary_exc,
                    )

            project_id = _row_project_id(row)

            if project_id:
                try:
                    update_image_storage_fields(
                        project_id,
                        image_id,
                        {
                            "status": "missing_remote",
                            "storage_status": "missing_remote",
                            "hf_sync_status": "missing_remote",
                            "last_error": str(exc),
                        },
                    )
                except Exception:
                    logger.exception("Failed to mark image missing_remote for %s", image_id)

        logger.warning(
            "HF image unavailable image_id=%s file_name=%s original_hf_path=%s final_hf_path=%s error=%s",
            image_id,
            file_name,
            original_hf_path,
            hf_path,
            exc,
        )
        return None


def download_image(repo: str, path: str, image_id: str) -> Path:
    logger.debug("Downloading image %s from %s/%s", image_id, repo, path)

    return file_storage.download_to_local(
        repo,
        path,
        repo_type=file_storage.REPO_TYPE_DATASET,
    )


def download_image_by_id(project_id: str, image_id: str) -> Path:
    row = get_image(project_id, image_id)

    if not row:
        raise ValueError(f"Image {image_id} not found")

    row = _normalise_row(row)

    repo = _row_hf_repo(row)
    path = _row_hf_path(row)

    if not repo or not path:
        raise ValueError(f"Image {image_id} has no storage location")

    return download_image(repo, path, image_id)


def download_image_row(row: dict, image_id: str) -> Path:
    row = _normalise_row(row)

    resolved = resolve_image_path(row, image_id)

    if resolved is not None:
        return resolved

    repo = _row_hf_repo(row)
    path = _row_hf_path(row)

    if not repo or not path:
        raise ValueError(
            f"Image {image_id} has no storage location. "
            f"repo={repo} path={path} keys={list(row.keys())}"
        )

    raise FileNotFoundError(
        f"Image {image_id} missing locally and on Hugging Face repo={repo} path={path}"
    )


# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------

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