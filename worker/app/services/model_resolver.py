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


def list_hf_model_files(project_id: str) -> list[str]:
    """List all model weight files for a project on Hugging Face."""
    repo_id = settings.model_repo_id
    if not repo_id:
        return []
    prefix = f"models/{project_id}/"
    found: list[str] = []
    seen: set[str] = set()
    for repo_type in _repo_types_to_try(settings.model_repo_type):
        try:
            files = file_storage._api().list_repo_files(repo_id=repo_id, repo_type=repo_type)
        except Exception as exc:
            logger.warning("HF list failed repo=%s type=%s: %s", repo_id, repo_type, exc)
            continue
        for path in files:
            if not path.startswith(prefix):
                continue
            if Path(path).suffix.lower() not in _MODEL_SUFFIXES:
                continue
            if path not in seen:
                seen.add(path)
                found.append(path)
    return found


def match_hf_file_for_model(
    model_name: str,
    hf_path: str,
    hf_files: list[str],
) -> str | None:
    """Pick the best HF path for a model name from available repo files."""
    if not hf_files:
        return None

    if hf_path and hf_path in hf_files:
        return hf_path

    stems = {s.lower() for s in _name_candidates(model_name, hf_path, Path(hf_path).name)}
    name_lower = model_name.strip().lower()

    for path in hf_files:
        if Path(path).stem.lower() in stems:
            return path

    for path in hf_files:
        fname = Path(path).name.lower()
        if name_lower and name_lower in fname:
            return path

    for path in hf_files:
        stem = Path(path).stem.lower()
        if name_lower and stem in name_lower:
            return path

    return None


def sync_project_models_from_hf(project_id: str) -> list[dict]:
    """Repair DB hf_path values by matching model names to files on Hugging Face."""
    from app.services.supabase_repo import list_models, update_model_fields

    hf_files = list_hf_model_files(project_id)
    if not hf_files:
        return []

    repairs: list[dict] = []
    for row in list_models(project_id):
        model_id = str(row["id"])
        model_name = str(row.get("modelName") or row.get("model_name") or "")
        hf_path = str(row.get("hfPath") or row.get("hf_path") or "")
        hf_repo = str(row.get("hfRepo") or row.get("hf_repo") or settings.model_repo_id)

        if hf_path and file_storage._repo_file_exists(
            hf_repo, settings.model_repo_type, hf_path
        ):
            continue

        matched = match_hf_file_for_model(model_name, hf_path, hf_files)
        if not matched:
            continue

        update_model_fields(
            project_id,
            model_id,
            {"hfRepo": hf_repo, "hfPath": matched},
        )
        repairs.append(
            {
                "modelId": model_id,
                "modelName": model_name,
                "oldPath": hf_path,
                "hfPath": matched,
            }
        )
        logger.info(
            "Repaired model HF path project=%s model=%s %s -> %s",
            project_id,
            model_name,
            hf_path,
            matched,
        )
    return repairs


def sync_project_models_to_hf(project_id: str) -> dict:
    """Push model files from worker local disk to Hugging Face (one batch commit)."""
    from app.services.supabase_repo import list_models, update_model_fields

    file_storage.require_hf_model_upload()

    rows = list_models(project_id)
    local_dir = settings.model_files_dir / project_id
    payload: list[tuple[str, bytes]] = []
    seen_names: set[str] = set()
    linked: list[dict] = []
    skipped_on_hf: list[str] = []

    hf_files = list_hf_model_files(project_id)

    for row in rows:
        model_id = str(row["id"])
        model_name = str(row.get("modelName") or row.get("model_name") or "")
        hf_path = str(row.get("hfPath") or row.get("hf_path") or "")
        hf_repo = str(row.get("hfRepo") or row.get("hf_repo") or settings.model_repo_id)
        local_name = file_storage.model_cache_local_name_from_path(hf_path)

        if hf_path and file_storage._repo_file_exists(
            hf_repo, settings.model_repo_type, hf_path
        ):
            skipped_on_hf.append(model_name or model_id)
            continue

        matched_hf = match_hf_file_for_model(model_name, hf_path, hf_files)
        if matched_hf:
            update_model_fields(
                project_id,
                model_id,
                {"hfRepo": hf_repo, "hfPath": matched_hf},
            )
            skipped_on_hf.append(model_name or model_id)
            continue

        local_file = find_local_model_file(project_id, model_name, hf_path, local_name)
        if local_file is None or not local_file.is_file():
            continue
        if local_file.name in seen_names:
            continue
        seen_names.add(local_file.name)
        payload.append((local_file.name, local_file.read_bytes()))
        linked.append(
            {
                "modelId": model_id,
                "modelName": model_name,
                "fileName": local_file.name,
            }
        )

    if local_dir.exists():
        for path in local_dir.iterdir():
            if not path.is_file() or path.stat().st_size <= 0:
                continue
            if path.name in seen_names:
                continue
            payload.append((path.name, path.read_bytes()))
            seen_names.add(path.name)
            linked.append({"modelId": None, "modelName": path.stem, "fileName": path.name})

    if not payload:
        return {
            "uploaded": 0,
            "skippedAlreadyOnHf": len(skipped_on_hf),
            "message": (
                "No local model files found on worker disk to push. "
                "Re-upload models from the Models page."
            ),
        }

    loc = file_storage.upload_model_files_batch(project_id, payload)

    updated = 0
    for item in linked:
        model_id = item.get("modelId")
        if not model_id:
            continue
        hf_path = file_storage.model_path(project_id, item["fileName"])
        update_model_fields(
            project_id,
            str(model_id),
            {"hfRepo": loc["hfRepo"], "hfPath": hf_path},
        )
        updated += 1

    return {
        "uploaded": len(payload),
        "dbUpdated": updated,
        "skippedAlreadyOnHf": len(skipped_on_hf),
        "hfRepo": loc.get("hfRepo"),
        "repoType": loc.get("repoType"),
        "files": [name for name, _ in payload],
        "message": f"Pushed {len(payload)} model file(s) to Hugging Face.",
    }


def migrate_project_models_from_dataset_repo(project_id: str) -> dict:
    """Move model weights mistakenly stored in the HF dataset repo into the model repo."""
    from huggingface_hub import hf_hub_download
    from app.services.supabase_repo import list_models, update_model_fields

    file_storage.require_hf_model_upload()
    repo_id = settings.model_repo_id
    if not repo_id:
        return {"migrated": 0, "message": "HF_MODEL_REPO not configured"}

    prefix = f"models/{project_id}/"
    dataset_type = file_storage.REPO_TYPE_DATASET
    model_type = settings.model_repo_type

    try:
        dataset_files = file_storage._api().list_repo_files(
            repo_id=repo_id, repo_type=dataset_type
        )
    except Exception as exc:
        logger.warning("Model migration: could not list dataset repo: %s", exc)
        return {"migrated": 0, "error": str(exc)}

    candidates = [
        path
        for path in dataset_files
        if path.startswith(prefix) and Path(path).suffix.lower() in _MODEL_SUFFIXES
    ]
    if not candidates:
        return {"migrated": 0, "message": "No model files in dataset repo to migrate"}

    payload: list[tuple[str, bytes]] = []
    migrated_paths: list[str] = []
    skipped = 0

    for path in candidates:
        if file_storage._repo_file_exists(repo_id, model_type, path):
            skipped += 1
            continue
        try:
            local = hf_hub_download(
                repo_id=repo_id,
                filename=path,
                repo_type=dataset_type,
                token=settings.hf_token,
            )
            file_name = Path(path).name
            payload.append((file_name, Path(local).read_bytes()))
            migrated_paths.append(path)
        except Exception as exc:
            logger.warning("Model migration download failed path=%s: %s", path, exc)

    if not payload:
        return {
            "migrated": 0,
            "skippedAlreadyOnModelRepo": skipped,
            "message": "Model files already on model repo or download failed.",
        }

    loc = file_storage.upload_model_files_batch(project_id, payload)

    rows = list_models(project_id)
    updated = 0
    for row in rows:
        model_id = str(row["id"])
        hf_path = str(row.get("hfPath") or row.get("hf_path") or "")
        file_name = Path(hf_path).name if hf_path else ""
        if file_name and any(file_name == Path(p).name for p in migrated_paths):
            update_model_fields(
                project_id,
                model_id,
                {
                    "hfRepo": loc["hfRepo"],
                    "hfPath": file_storage.model_path(project_id, file_name),
                },
            )
            updated += 1

    return {
        "migrated": len(payload),
        "dbUpdated": updated,
        "skippedAlreadyOnModelRepo": skipped,
        "hfRepo": loc.get("hfRepo"),
        "repoType": loc.get("repoType"),
        "files": [name for name, _ in payload],
        "message": (
            f"Migrated {len(payload)} model file(s) from dataset repo to model repo."
        ),
    }


def check_model_available(
    project_id: str,
    model_id: str,
    *,
    model_row: dict | None = None,
) -> dict:
    """Lightweight check whether model weights exist (local or HF)."""
    from app.services.supabase_repo import get_model

    row = model_row or get_model(project_id, model_id)
    if not row:
        return {"available": False, "error": "Model not found in database"}

    model_name = str(row.get("modelName") or row.get("model_name") or "")
    hf_path = str(row.get("hfPath") or row.get("hf_path") or "")
    hf_repo = str(row.get("hfRepo") or row.get("hf_repo") or settings.model_repo_id)
    local_name = file_storage.model_cache_local_name_from_path(hf_path)

    local = find_local_model_file(project_id, model_name, hf_path, local_name)
    if local is not None:
        return {"available": True, "source": "local", "path": str(local)}

    hf_files = list_hf_model_files(project_id)
    matched = match_hf_file_for_model(model_name, hf_path, hf_files)
    if matched:
        return {"available": True, "source": "huggingface", "hfPath": matched}

    if hf_path and hf_repo:
        for repo_type in _repo_types_to_try(settings.model_repo_type):
            if file_storage._repo_file_exists(hf_repo, repo_type, hf_path):
                return {"available": True, "source": "huggingface", "hfPath": hf_path}

    if is_ultralytics_pretrained_name(model_name) or is_ultralytics_pretrained_name(local_name):
        return {"available": True, "source": "ultralytics_pretrained", "modelName": model_name}

    return {
        "available": False,
        "error": (
            f"Model '{model_name}' file missing. Upload .pt/.onnx from Models page "
            f"(expected HF path: {hf_path or 'unknown'})."
        ),
    }


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
    """Model weight lookups — model namespace only (not dataset repo)."""
    model_type = file_storage.REPO_TYPE_MODEL
    order: list[str] = []
    for candidate in (primary, settings.model_repo_type, model_type):
        if candidate and candidate not in order:
            order.append(candidate)
    return order or [model_type]


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

    hf_files = list_hf_model_files(project_id)
    matched = match_hf_file_for_model(model_name, hf_path, hf_files)
    if matched:
        matched_local = file_storage.model_cache_local_name_from_path(matched)
        try:
            downloaded = _hf_download_path(
                hf_repo,
                matched,
                project_id=project_id,
                local_name=matched_local,
            )
            if downloaded is not None:
                from app.services.supabase_repo import update_model_fields

                if matched != hf_path:
                    update_model_fields(
                        project_id,
                        model_id,
                        {"hfRepo": hf_repo, "hfPath": matched},
                    )
                return downloaded
        except Exception as exc:
            logger.warning("HF universal match download failed: %s", exc)

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
