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


def _get_first(row: dict, *keys: str):
    """Return first non-empty value from snake_case/camelCase aliases."""
    for key in keys:
        value = row.get(key)
        if value is not None and value != "":
            return value
    return None


def _row_project_id(row: dict) -> str:
    return str(_get_first(row, "project_id", "projectId") or "")


def _row_dataset_id(row: dict) -> str:
    return str(_get_first(row, "dataset_id", "datasetId") or "")


def _row_file_name(row: dict) -> str:
    return str(_get_first(row, "file_name", "fileName", "filename", "name") or "")


def _row_hf_path(row: dict) -> str:
    return str(_get_first(row, "hf_path", "hfPath") or "")


def _row_hf_repo(row: dict) -> str:
    return str(_get_first(row, "hf_repo", "hfRepo") or settings.dataset_repo_id or "")


def _row_local_path(row: dict) -> str:
    return str(_get_first(row, "local_path", "localPath") or "")


def _normalise_row(row: dict) -> dict:
    """Keep both snake_case and camelCase aliases in memory."""
    project_id = _row_project_id(row)
    dataset_id = _row_dataset_id(row)
    file_name = _row_file_name(row)
    hf_path = _row_hf_path(row)
    hf_repo = _row_hf_repo(row)
    local_path = _row_local_path(row)

    if project_id:
        row["project_id"] = row["projectId"] = project_id
    if dataset_id:
        row["dataset_id"] = row["datasetId"] = dataset_id
    if file_name:
        row["file_name"] = row["fileName"] = file_name
    if hf_path:
        row["hf_path"] = row["hfPath"] = hf_path
    if hf_repo:
        row["hf_repo"] = row["hfRepo"] = hf_repo
    if local_path:
        row["local_path"] = row["localPath"] = local_path

    return row


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

    repo = row.get("hfRepo") or row.get("hf_repo") or settings.model_repo_id
    path = row.get("hfPath") or row.get("hf_path")

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

    path = row.get("hfPath") or row.get("hf_path")

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


def _should_use_local_auto_label_image() -> bool:
    return (
        settings.auto_label_use_local_images
        and settings.local_storage_enabled
        and not settings.is_vercel
    )


def _resolve_hf_path_by_filename(row: dict, image_id: str) -> str | None:
    """
    Find image in HF repo by filename.

    Priority:
    1. Exact DB hf_path.
    2. Expected dataset path.
    3. Any file under datasets/.../images/ with same filename.
    """
    row = _normalise_row(row)

    file_name = _row_file_name(row)
    project_id = _row_project_id(row)
    dataset_id = _row_dataset_id(row)
    repo_id = _row_hf_repo(row)

    if not file_name or not repo_id:
        logger.warning(
            "Cannot resolve HF image by filename image_id=%s file_name=%s repo_id=%s project_id=%s dataset_id=%s",
            image_id,
            file_name,
            repo_id,
            project_id,
            dataset_id,
        )
        return None

    exact_hf_path = _row_hf_path(row)
    expected_prefix = (
        f"datasets/{project_id}/{dataset_id}/images/"
        if project_id and dataset_id
        else ""
    )
    expected_path = f"{expected_prefix}{file_name}" if expected_prefix else ""

    try:
        repo_files = file_storage._api().list_repo_files(
            repo_id=repo_id,
            repo_type=settings.dataset_repo_type,
        )
    except Exception as exc:
        logger.exception("Failed to list HF repo files for image %s: %s", image_id, exc)
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
            if Path(path).name == file_name
            and "/images/" in path
            and path.startswith("datasets/")
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
                "Resolved HF image path by filename image_id=%s file_name=%s selected=%s all_matches=%s",
                image_id,
                file_name,
                selected,
                matches[:10],
            )

    if not selected:
        logger.warning(
            "HF image not found by filename image_id=%s file_name=%s exact=%s expected=%s repo=%s repo_type=%s",
            image_id,
            file_name,
            exact_hf_path,
            expected_path,
            repo_id,
            settings.dataset_repo_type,
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
                        "storage_status": "remote_ready",
                        "hf_sync_status": "synced",
                        "last_error": None,
                    },
                )

            row["hf_path"] = row["hfPath"] = selected

        except Exception:
            logger.exception("Failed to update image hf_path for %s", image_id)

    return selected


def resolve_hf_path_for_image(row: dict, image_id: str) -> str | None:
    row = _normalise_row(row)

    hf_path = _row_hf_path(row)

    if hf_path:
        return hf_path

    return _resolve_hf_path_by_filename(row, image_id)


def resolve_image_path(row: dict, image_id: str) -> Path | None:
    row = _normalise_row(row)

    local_path = _row_local_path(row)

    if _should_use_local_auto_label_image() and local_path:
        candidate = Path(local_path)

        if candidate.exists() and candidate.is_file():
            logger.info("Auto-label using local image %s for %s", candidate, image_id)
            return candidate

        logger.info("Auto-label local image missing or unavailable for %s", image_id)

    repo_id = _row_hf_repo(row)
    file_name = _row_file_name(row)
    original_hf_path = _row_hf_path(row)
    hf_path = resolve_hf_path_for_image(row, image_id)

    if not hf_path:
        logger.warning(
            "Image %s has no remote HF path file_name=%s repo=%s",
            image_id,
            file_name,
            repo_id,
        )
        return None

    logger.info(
        "Auto-label using exact HF path image_id=%s file_name=%s repo=%s repo_type=%s hf_path=%s",
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
                "HF image missing for %s path=%s; trying filename repair",
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
                        "Alternate HF image download failed for %s alt_path=%s: %s",
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
    resolved = resolve_image_path(row, image_id)

    if resolved is not None:
        return resolved

    row = _normalise_row(row)

    repo = _row_hf_repo(row)
    path = _row_hf_path(row)

    if not repo or not path:
        raise ValueError(f"Image {image_id} has no storage location")

    raise FileNotFoundError(
        f"Image {image_id} missing locally and on Hugging Face path={path}"
    )


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