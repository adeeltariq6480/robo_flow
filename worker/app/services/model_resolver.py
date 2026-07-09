"""Universal model weight resolution — local, Hugging Face, Ultralytics hub."""

import logging
import re
import shutil
from pathlib import Path

from huggingface_hub.utils import HfHubHTTPError

from app.config import settings
from app.services import hf_storage as file_storage

logger = logging.getLogger(__name__)

_MODEL_SUFFIXES = (".pt", ".pth", ".onnx")

_PRETRAINED_RE = re.compile(
    r"^yolo(v)?(3|5|7|8|9|10|11)([nsmlxbtc])?(\.pt)?$",
    re.IGNORECASE,
)


def _stem(value: str) -> str:
    return Path(value.strip()).stem if value else ""


def _name_candidates(model_name: str, hf_path: str, local_name: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in (model_name, hf_path, local_name, Path(hf_path).name if hf_path else ""):
        stem = _stem(raw)
        if not stem or stem in seen:
            continue
        seen.add(stem)
        out.append(stem)
    return out


def is_ultralytics_pretrained_name(name: str) -> bool:
    stem = _stem(name).lower()
    if not stem:
        return False
    if _PRETRAINED_RE.match(stem):
        return True
    return stem.startswith("yolo")


def find_local_model_file(
    project_id: str,
    model_name: str,
    hf_path: str,
    local_name: str,
) -> Path | None:
    """Find a model file on disk by model name, HF path, or fuzzy filename match."""
    stems = {s.lower() for s in _name_candidates(model_name, hf_path, local_name)}
    search_dirs = [
        settings.model_files_dir / project_id,
        settings.model_files_dir,
    ]
    best: Path | None = None
    for directory in search_dirs:
        if not directory.exists():
            continue
        for path in directory.iterdir():
            if not path.is_file() or path.suffix.lower() not in _MODEL_SUFFIXES:
                continue
            if path.stat().st_size == 0:
                continue
            stem = path.stem.lower()
            if stem in stems:
                logger.info("Universal local model match: %s", path)
                return path
            if model_name and model_name.lower() in path.name.lower():
                if best is None:
                    best = path
    if best is not None:
        logger.info("Universal local model fuzzy match: %s", best)
    return best


def find_hf_model_path(
    project_id: str,
    model_name: str,
    hf_repo: str,
    hf_path: str,
    local_name: str,
) -> tuple[str, str] | None:
    """Search HF repo for a model file matching name/path hints."""
    stems = {s.lower() for s in _name_candidates(model_name, hf_path, local_name)}
    prefix = f"models/{project_id}/"

    for repo_type in _repo_types_to_try(settings.model_repo_type):
        try:
            files = file_storage._api().list_repo_files(repo_id=hf_repo, repo_type=repo_type)
        except Exception as exc:
            logger.warning("HF list failed repo=%s type=%s: %s", hf_repo, repo_type, exc)
            continue

        exact = [
            candidate
            for candidate in files
            if candidate.startswith(prefix)
            and Path(candidate).suffix.lower() in _MODEL_SUFFIXES
            and Path(candidate).stem.lower() in stems
        ]
        if exact:
            exact.sort(key=len)
            selected = exact[0]
            logger.info("Universal HF model match repo=%s type=%s path=%s", hf_repo, repo_type, selected)
            return repo_type, selected

        fuzzy = [
            candidate
            for candidate in files
            if candidate.startswith(prefix)
            and Path(candidate).suffix.lower() in _MODEL_SUFFIXES
            and model_name
            and model_name.lower() in Path(candidate).name.lower()
        ]
        if fuzzy:
            fuzzy.sort(key=len)
            selected = fuzzy[0]
            logger.info("Universal HF fuzzy match repo=%s type=%s path=%s", hf_repo, repo_type, selected)
            return repo_type, selected

    return None


def download_ultralytics_pretrained(model_name: str, project_id: str) -> Path:
    """Download official Ultralytics weights into the project model cache."""
    stem = _stem(model_name)
    weight_file = f"{stem}.pt"
    dest = settings.model_files_dir / project_id / weight_file
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        logger.info("Ultralytics pretrained already cached: %s", dest)
        return dest

    from ultralytics.utils.downloads import attempt_download_asset

    logger.info("Downloading Ultralytics weights: %s", weight_file)
    downloaded = attempt_download_asset(weight_file)
    source = Path(downloaded)
    if not source.is_absolute():
        source = Path.cwd() / source
    if not source.exists() or source.stat().st_size == 0:
        raise FileNotFoundError(
            f"Ultralytics could not download weights for {weight_file}"
        )

    shutil.copy2(source, dest)
    logger.info("Ultralytics weights cached at %s", dest)
    return dest


def try_download_public_weights(project_id: str, *names: str) -> Path | None:
    """Try Ultralytics/GitHub asset download for several name hints."""
    for name in names:
        if not name:
            continue
        stem = _stem(name)
        if not stem:
            continue
        try:
            return download_ultralytics_pretrained(stem, project_id)
        except Exception as exc:
            logger.debug("Public weight download failed for %s: %s", stem, exc)
    return None


def resolve_model_path_in_repo(
    repo_id: str,
    repo_type: str,
    hf_path: str,
    *,
    project_id: str | None = None,
) -> str | None:
    if file_storage._repo_file_exists(repo_id, repo_type, hf_path):
        return hf_path

    base = Path(hf_path.replace("\\", "/")).name
    if not base:
        return None

    try:
        files = file_storage._api().list_repo_files(repo_id=repo_id, repo_type=repo_type)
    except Exception as exc:
        logger.warning("HF list failed for model path repair repo=%s: %s", repo_id, exc)
        return None

    prefix = f"models/{project_id}/" if project_id else "models/"
    matches = [
        candidate
        for candidate in files
        if Path(candidate).name == base
        and (not project_id or candidate.startswith(prefix) or f"/{project_id}/" in candidate)
    ]
    if not matches:
        matches = [candidate for candidate in files if Path(candidate).name == base]
    if not matches:
        return None

    matches.sort(key=len)
    selected = matches[0]
    if selected != hf_path:
        logger.info(
            "Resolved model HF path by filename repo=%s type=%s stored=%s selected=%s",
            repo_id,
            repo_type,
            hf_path,
            selected,
        )
    return selected


def _repo_types_to_try(primary: str) -> list[str]:
    order = [primary]
    for candidate in (settings.model_repo_type, settings.dataset_repo_type):
        if candidate not in order:
            order.append(candidate)
    return order


def _hf_download_path(
    repo_id: str,
    hf_path: str,
    *,
    project_id: str,
    local_name: str,
    repo_type: str | None = None,
) -> Path | None:
    types = [repo_type] if repo_type else _repo_types_to_try(settings.model_repo_type)
    last_404: Exception | None = None
    project_local_name = f"{project_id}/{local_name}"

    for rt in types:
        if not rt:
            continue
        resolved_path = resolve_model_path_in_repo(
            repo_id, rt, hf_path, project_id=project_id
        )
        if not resolved_path:
            continue
        try:
            return file_storage.download_to_local(
                repo_id,
                resolved_path,
                repo_type=rt,
                local_name=project_local_name,
            )
        except HfHubHTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status == 404:
                last_404 = exc
                continue
            raise
        except Exception as exc:
            detail = str(exc).lower()
            if "404" in detail or "not found" in detail:
                last_404 = exc
                continue
            raise

    if last_404 is not None:
        raise last_404
    return None


def _sync_pretrained_to_hf(project_id: str, dest: Path) -> None:
    if not file_storage.hf_model_upload_enabled():
        return
    try:
        file_storage.upload_model_file(
            project_id,
            dest.name,
            dest.read_bytes(),
            skip_if_exists=True,
        )
    except Exception as sync_exc:
        logger.warning("Could not sync model to HF: %s", sync_exc)


def resolve_model_weights(
    *,
    project_id: str,
    model_id: str,
    model_name: str,
    hf_repo: str,
    hf_path: str,
    local_name: str,
    existing_local: Path | None,
) -> Path:
    """Universal resolver: local scan → HF → public Ultralytics weights."""
    if existing_local is not None:
        return existing_local

    discovered = find_local_model_file(project_id, model_name, hf_path, local_name)
    if discovered is not None:
        return discovered

    try:
        downloaded = _hf_download_path(
            hf_repo,
            hf_path,
            project_id=project_id,
            local_name=local_name,
        )
        if downloaded is not None:
            return downloaded
    except HfHubHTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status != 404:
            raise RuntimeError(f"Model download failed for {model_id}: {exc}") from exc
        logger.warning("HF path missing repo=%s path=%s — searching repo", hf_repo, hf_path)
    except Exception as exc:
        detail = str(exc).lower()
        if "404" not in detail and "not found" not in detail:
            raise RuntimeError(f"Model download failed for {model_id}: {exc}") from exc

    hf_match = find_hf_model_path(project_id, model_name, hf_repo, hf_path, local_name)
    if hf_match is not None:
        repo_type, matched_path = hf_match
        matched_local = file_storage.model_cache_local_name_from_path(matched_path)
        try:
            downloaded = _hf_download_path(
                hf_repo,
                matched_path,
                project_id=project_id,
                local_name=matched_local,
                repo_type=repo_type,
            )
            if downloaded is not None:
                return downloaded
        except Exception as exc:
            logger.warning("HF universal match download failed: %s", exc)

    public = try_download_public_weights(
        project_id,
        model_name,
        local_name,
        Path(hf_path).name,
        hf_path,
    )
    if public is not None:
        _sync_pretrained_to_hf(project_id, public)
        return public

    raise FileNotFoundError(
        f"Model '{model_name}' file not found. Upload a .pt/.onnx file from Models page "
        f"(repo={hf_repo} path={hf_path}). Worker tried local disk, Hugging Face, and public YOLO weights."
    )
