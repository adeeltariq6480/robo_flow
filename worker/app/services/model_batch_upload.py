"""Stage multiple model files locally, then push to Hugging Face in one commit."""

import logging
import shutil
import threading
from pathlib import Path
from uuid import uuid4

from app.config import settings
from app.services import hf_storage
from app.services import supabase_repo as repo

logger = logging.getLogger(__name__)

_sessions: dict[str, dict] = {}
_lock = threading.Lock()


def _temp_root() -> Path:
    path = Path(settings.temp_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def init_batch(project_id: str) -> str:
    session_id = uuid4().hex
    session_dir = _temp_root() / f"model-batch-{session_id}"
    session_dir.mkdir(parents=True, exist_ok=True)
    with _lock:
        _sessions[session_id] = {
            "project_id": project_id,
            "dir": session_dir,
            "items": [],
        }
    return session_id


def stage_model(
    session_id: str,
    file_name: str,
    data: bytes,
    *,
    model_name: str,
    model_version: str,
    model_type: str,
    description: str | None,
) -> None:
    with _lock:
        session = _sessions.get(session_id)
        if not session:
            raise ValueError("Invalid or expired model batch session")

    safe_name = file_name.replace("\\", "/").rsplit("/", 1)[-1].strip() or "model.pt"
    target = session["dir"] / safe_name
    target.write_bytes(data)

    with _lock:
        session["items"].append(
            {
                "file_name": safe_name,
                "file_size": len(data),
                "meta": {
                    "modelName": model_name,
                    "modelVersion": model_version,
                    "modelType": model_type,
                    "description": description,
                },
            }
        )


def finalize_batch(session_id: str) -> list[dict]:
    with _lock:
        session = _sessions.pop(session_id, None)
    if not session:
        raise ValueError("Invalid or expired model batch session")

    session_dir: Path = session["dir"]
    try:
        items = session["items"]
        if not items:
            raise ValueError("No models staged in batch session")

        payload: list[tuple[str, bytes]] = []
        for item in items:
            path = session_dir / item["file_name"]
            if not path.exists():
                raise ValueError(f"Staged model file missing: {item['file_name']}")
            payload.append((item["file_name"], path.read_bytes()))

        loc = hf_storage.upload_model_files_batch(session["project_id"], payload)

        created: list[dict] = []
        for item in items:
            meta = item["meta"]
            created.append(
                repo.create_model(
                    session["project_id"],
                    {
                        "modelName": meta["modelName"],
                        "modelVersion": meta["modelVersion"],
                        "modelType": meta["modelType"],
                        "description": meta.get("description"),
                        "hfRepo": loc["hfRepo"],
                        "hfPath": hf_storage.model_path(
                            session["project_id"], item["file_name"]
                        ),
                        "fileSize": item["file_size"],
                    },
                )
            )

        logger.info(
            "Model batch committed to HF project=%s count=%d repo=%s",
            session["project_id"],
            len(created),
            loc.get("hfRepo"),
        )
        return created
    finally:
        shutil.rmtree(session_dir, ignore_errors=True)
