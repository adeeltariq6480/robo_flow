"""DB-free, short-lived Colab label-tool sessions backed by a temporary HF folder."""
from __future__ import annotations

import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote

from app.config import settings

TTL_SECONDS = 6 * 60 * 60
_sessions: dict[str, dict[str, Any]] = {}


def _remote_prefix(session_id: str) -> str:
    return f"temp_label_tool/{session_id}"


def cleanup(session_id: str) -> None:
    session = _sessions.pop(session_id, None)
    if not session:
        return
    try:
        from huggingface_hub import HfApi
        HfApi(token=settings.hf_token).delete_folder(
            path_in_repo=_remote_prefix(session_id), repo_id=settings.dataset_repo_id,
            repo_type=settings.dataset_repo_type,
        )
    except Exception:
        pass


def _prune() -> None:
    now = time.time()
    for session_id in [key for key, value in _sessions.items() if value["expires_at"] < now]:
        cleanup(session_id)


def create(project_id: str, model_ids: list[str], confidence: float, iou: float, threshold: float) -> dict[str, Any]:
    _prune()
    session_id = uuid.uuid4().hex
    session = {
        "id": session_id, "project_id": project_id, "model_ids": model_ids,
        "confidence": confidence, "iou": iou, "threshold": threshold,
        "references": [], "targets": [], "results": [], "status": "uploading",
        "processed": 0, "total": 0, "message": "Uploading temporary files",
        "error": None, "expires_at": time.time() + TTL_SECONDS,
    }
    _sessions[session_id] = session
    return session


def get(session_id: str) -> dict[str, Any] | None:
    _prune()
    return _sessions.get(session_id)


def update(session_id: str, **fields: Any) -> dict[str, Any]:
    session = get(session_id)
    if not session:
        raise KeyError("Temporary label session expired")
    session.update(fields); session["expires_at"] = time.time() + TTL_SECONDS
    return session


def public(session: dict[str, Any]) -> dict[str, Any]:
    hidden = {"project_id", "model_ids", "confidence", "iou", "threshold", "references", "targets", "expires_at"}
    return {key: value for key, value in session.items() if key not in hidden}


def upload(session: dict[str, Any], files: list[tuple[str, bytes]], references: list[dict[str, Any]]) -> None:
    from huggingface_hub import HfApi
    prefix = _remote_prefix(session["id"])
    with tempfile.TemporaryDirectory(prefix="label-tool-") as tmp:
        root = Path(tmp)
        for relative, content in files:
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(content)
        HfApi(token=settings.hf_token).upload_folder(
            folder_path=str(root), path_in_repo=prefix, repo_id=settings.dataset_repo_id,
            repo_type=settings.dataset_repo_type, commit_message=f"Temporary label session {session['id']}",
        )
    base = f"https://huggingface.co/datasets/{settings.dataset_repo_id}/resolve/main/{prefix}"
    session["references"] = [{"class_name": item["class_name"], "paths": item["paths"], "urls": [f"{base}/{quote(path)}" for path in item["paths"]]} for item in references]
    target_paths = [relative for relative, _ in files if relative.startswith("targets/")]
    session["targets"] = [{"name": Path(path).name, "path": path, "url": f"{base}/{quote(path)}"} for path in target_paths]
    update(session["id"], status="waiting_for_colab", total=len(target_paths), message="Open Colab and run all")
