import json
import os
from functools import lru_cache

import firebase_admin
from firebase_admin import credentials, firestore, storage


@lru_cache(maxsize=1)
def init_firebase() -> None:
    if firebase_admin._apps:
        return

    project_id = os.environ.get("FIREBASE_PROJECT_ID", "")
    bucket = os.environ.get("FIREBASE_STORAGE_BUCKET", "")

    cred = None
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if sa_json:
        cred = credentials.Certificate(json.loads(sa_json))
    elif os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        cred = credentials.ApplicationDefault()

    if cred is None:
        raise RuntimeError(
            "Firebase credentials missing. Set GOOGLE_APPLICATION_CREDENTIALS "
            "or FIREBASE_SERVICE_ACCOUNT_JSON."
        )

    options = {"storageBucket": bucket} if bucket else {}
    firebase_admin.initialize_app(cred, options)


def get_db():
    init_firebase()
    return firestore.client()


def get_bucket():
    init_firebase()
    bucket_name = os.environ.get("FIREBASE_STORAGE_BUCKET", "").replace("gs://", "")
    return storage.bucket(bucket_name)
