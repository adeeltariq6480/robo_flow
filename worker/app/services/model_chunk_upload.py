"""Chunked model uploads — reassemble on disk then push to Hugging Face Hub."""

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


def init_session(
    project_id: str,
    file_name: str,
    total_chunks: int,
    *,
    model_name: str,
    model_version: str,
    model_type: str,
    description: str | None,
    file_size: int,
) -> str:
    if total_chunks < 1:
        raise ValueError("total_chunks must be at least 1")

    session_id = uuid4().hex
    session_dir = _temp_root() / f"model-chunk-{session_id}"
    session_dir.mkdir(parents=True, exist_ok=True)

    with _lock:
        _sessions[session_id] = {
            "project_id": project_id,
            "file_name": file_name,
            "total_chunks": total_chunks,
            "file_size": file_size,
            "dir": session_dir,
            "received": set(),
            "meta": {
                "modelName": model_name,
                "modelVersion": model_version,
                "modelType": model_type,
                "description": description,
            },
        }
    return session_id


def save_chunk(session_id: str, chunk_index: int, data: bytes) -> None:
    with _lock:
        session = _sessions.get(session_id)
        if not session:
            raise ValueError("Invalid or expired upload session")

    if chunk_index < 0 or chunk_index >= session["total_chunks"]:
        raise ValueError("chunk_index out of range")

    chunk_path = session["dir"] / f"{chunk_index:06d}.part"
    chunk_path.write_bytes(data)

    with _lock:
        session["received"].add(chunk_index)


def finalize_session(session_id: str) -> dict:
    with _lock:
        session = _sessions.pop(session_id, None)
    if not session:
        raise ValueError("Invalid or expired upload session")

    session_dir: Path = session["dir"]
    try:
        total = session["total_chunks"]
        if len(session["received"]) != total:
            missing = total - len(session["received"])
            raise ValueError(f"Upload incomplete — {missing} chunk(s) missing")

        assembled = session_dir / session["file_name"]
        with assembled.open("wb") as out:
            for i in range(total):
                part = session_dir / f"{i:06d}.part"
                if not part.exists():
                    raise ValueError(f"Missing chunk {i}")
                out.write(part.read_bytes())

        data = assembled.read_bytes()
        loc = hf_storage.upload_model_file(
            session["project_id"], session["file_name"], data
        )
        meta = session["meta"]
        return repo.create_model(
            session["project_id"],
            {
                "modelName": meta["modelName"],
                "modelVersion": meta["modelVersion"],
                "modelType": meta["modelType"],
                "description": meta.get("description"),
                "hfRepo": loc["hfRepo"],
                "hfPath": loc["hfPath"],
                "fileSize": len(data),
            },
        )
    finally:
        shutil.rmtree(session_dir, ignore_errors=True)
