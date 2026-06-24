import tempfile
from pathlib import Path
from uuid import UUID

from app.config import settings
from app.services.firebase_client import get_bucket
from app.services.firestore_repo import get_image, get_model, list_classes


def ensure_temp_dir() -> Path:
    path = Path(settings.temp_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def download_model(model_id: UUID, project_id: UUID) -> Path:
    row = get_model(str(project_id), str(model_id))
    if not row:
        raise ValueError(f"Model {model_id} not found in project {project_id}")

    storage_path = row["storagePath"]
    ext = Path(storage_path).suffix or ".pt"
    local = ensure_temp_dir() / f"model_{model_id}{ext}"

    blob = get_bucket().blob(storage_path)
    blob.download_to_filename(str(local))
    return local


def download_dataset_image(storage_path: str, image_id: UUID) -> Path:
    ext = Path(storage_path).suffix or ".jpg"
    local = ensure_temp_dir() / f"img_{image_id}{ext}"
    blob = get_bucket().blob(storage_path)
    blob.download_to_filename(str(local))
    return local


def download_image_by_id(project_id: UUID, image_id: UUID) -> Path:
    row = get_image(str(project_id), str(image_id))
    if not row:
        raise ValueError(f"Image {image_id} not found")
    return download_dataset_image(row["storagePath"], image_id)


def get_project_class_map(project_id: UUID) -> dict[str, str]:
    from app.services.firestore_repo import get_project_class_map as _map

    return _map(str(project_id))


def build_class_name_map(project_id: UUID, user_map: dict[str, str]) -> dict[str, str]:
    project_classes = get_project_class_map(project_id)
    result: dict[str, str] = {}
    for yolo_name, project_name in user_map.items():
        if project_name in project_classes:
            result[yolo_name] = project_name
    return result
