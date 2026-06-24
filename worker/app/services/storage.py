import tempfile
from pathlib import Path
from uuid import UUID

from app.config import settings
from app.services.supabase_client import get_supabase


def ensure_temp_dir() -> Path:
    path = Path(settings.temp_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def download_model(model_id: UUID, project_id: UUID) -> Path:
    """Download model from Supabase storage to a local temp file."""
    sb = get_supabase()
    row = (
        sb.table("models")
        .select("file_path, name, format")
        .eq("id", str(model_id))
        .eq("project_id", str(project_id))
        .single()
        .execute()
    )
    if not row.data:
        raise ValueError(f"Model {model_id} not found in project {project_id}")

    file_path = row.data["file_path"]
    ext = Path(file_path).suffix or ".pt"
    local = ensure_temp_dir() / f"model_{model_id}{ext}"

    data = sb.storage.from_(settings.models_bucket).download(file_path)
    local.write_bytes(data)
    return local


def download_dataset_image(file_path: str, dataset_file_id: UUID) -> Path:
    """Download a dataset image from Supabase storage."""
    ext = Path(file_path).suffix or ".jpg"
    local = ensure_temp_dir() / f"img_{dataset_file_id}{ext}"
    sb = get_supabase()
    data = sb.storage.from_(settings.datasets_bucket).download(file_path)
    local.write_bytes(data)
    return local


def get_project_class_map(project_id: UUID) -> dict[str, str]:
    """Map class name -> class id for a project."""
    sb = get_supabase()
    rows = (
        sb.table("classes")
        .select("id, name")
        .eq("project_id", str(project_id))
        .execute()
    )
    return {r["name"]: r["id"] for r in (rows.data or [])}


def build_class_name_map(project_id: UUID, user_map: dict[str, str]) -> dict[str, str]:
    """Merge user-provided YOLO->project name map with project classes."""
    project_classes = get_project_class_map(project_id)
    result: dict[str, str] = {}

    for yolo_name, project_name in user_map.items():
        if project_name in project_classes:
            result[yolo_name] = project_name

    return result
