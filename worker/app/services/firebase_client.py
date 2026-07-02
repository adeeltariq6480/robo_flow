"""Firebase Admin init — Firestore only (no Firebase Storage)."""

import json
import os
import threading
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

from app.config import settings

_init_lock = threading.Lock()


def _resolve_credentials_path(path: str) -> str:
    candidate = Path(path)
    if candidate.is_file():
        return str(candidate)
    worker_relative = Path(__file__).resolve().parents[2] / path
    if worker_relative.is_file():
        return str(worker_relative)
    return path


def init_firebase() -> None:
    if firebase_admin._apps:
        return

    with _init_lock:
        if firebase_admin._apps:
            return

        cred = None
        if settings.firebase_service_account_json.strip():
            cred = credentials.Certificate(
                json.loads(settings.firebase_service_account_json)
            )
        elif settings.google_application_credentials.strip():
            cred = credentials.Certificate(
                _resolve_credentials_path(settings.google_application_credentials)
            )
        elif os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
            cred = credentials.Certificate(
                _resolve_credentials_path(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
            )

        if cred is None:
            raise RuntimeError(
                "Firebase credentials missing. Set FIREBASE_SERVICE_ACCOUNT_JSON "
                "or GOOGLE_APPLICATION_CREDENTIALS for the backend."
            )

        try:
            firebase_admin.initialize_app(
                cred, {"projectId": settings.firebase_project_id}
            )
        except ValueError as exc:
            # Another thread may have initialized between our checks.
            if not firebase_admin._apps:
                raise RuntimeError(str(exc)) from exc


def get_db():
    init_firebase()
    return firestore.client()
