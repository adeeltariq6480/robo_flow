"""Short-lived in-memory relay for DB-free Colab stock checks."""
from __future__ import annotations

import time
import uuid
from typing import Any

TTL_SECONDS = 6 * 60 * 60
_sessions: dict[str, dict[str, Any]] = {}


def _prune() -> None:
    now = time.time()
    for key in [key for key, value in _sessions.items() if value["expires_at"] < now]:
        _sessions.pop(key, None)


def create(project_id: str, model_ids: list[str], urls: list[str], confidence: float, iou: float) -> str:
    _prune()
    session_id = uuid.uuid4().hex
    _sessions[session_id] = {
        "id": session_id, "project_id": project_id, "model_ids": model_ids,
        "urls": urls, "confidence": confidence, "iou": iou,
        "status": "waiting_for_colab", "processed": 0, "total": len(urls),
        "message": "Open Colab and click Runtime → Run all", "results": [],
        "error": None, "expires_at": time.time() + TTL_SECONDS,
    }
    return session_id


def get(session_id: str) -> dict[str, Any] | None:
    _prune()
    return _sessions.get(session_id)


def update(session_id: str, **fields: Any) -> dict[str, Any]:
    session = get(session_id)
    if not session:
        raise KeyError("Stock check session expired")
    session.update(fields)
    session["expires_at"] = time.time() + TTL_SECONDS
    return session


def public(session: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in session.items() if key not in {"project_id", "model_ids", "urls", "confidence", "iou", "expires_at"}}
