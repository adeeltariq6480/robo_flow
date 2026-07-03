import os
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Supabase (Postgres metadata only) ---
    supabase_url: str = Field(
        default="",
        validation_alias=AliasChoices(
            "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"
        ),
    )
    supabase_service_role_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"
        ),
    )

    # --- Legacy Firebase (optional — no longer used when Supabase is configured) ---
    firebase_project_id: str = Field(
        default="",
        validation_alias=AliasChoices(
            "FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
        ),
    )
    firebase_service_account_json: str = Field(
        default="",
        validation_alias=AliasChoices("FIREBASE_SERVICE_ACCOUNT_JSON"),
    )
    google_application_credentials: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_APPLICATION_CREDENTIALS"),
    )

    # --- Hugging Face Hub (binary file storage) ---
    hf_token: str = Field(default="", validation_alias=AliasChoices("HF_TOKEN"))
    hf_username: str = Field(default="", validation_alias=AliasChoices("HF_USERNAME"))
    hf_dataset_repo: str = Field(
        default="", validation_alias=AliasChoices("HF_DATASET_REPO")
    )
    hf_model_repo: str = Field(
        default="", validation_alias=AliasChoices("HF_MODEL_REPO")
    )
    model_dir: str = Field(default="", validation_alias=AliasChoices("MODEL_DIR"))
    dataset_local_dir: str = Field(
        default="",
        validation_alias=AliasChoices("DATASET_LOCAL_DIR"),
    )
    hf_home: str = Field(default="", validation_alias=AliasChoices("HF_HOME"))
    hf_hub_cache: str = Field(
        default="", validation_alias=AliasChoices("HF_HUB_CACHE")
    )
    transformers_cache: str = Field(
        default="", validation_alias=AliasChoices("TRANSFORMERS_CACHE")
    )
    torch_home: str = Field(default="", validation_alias=AliasChoices("TORCH_HOME"))
    railway_volume_mount_path: str = Field(
        default="",
        validation_alias=AliasChoices("RAILWAY_VOLUME_MOUNT_PATH"),
    )

    # --- Server ---
    worker_host: str = "0.0.0.0"
    worker_port: int = Field(
        default=8000, validation_alias=AliasChoices("WORKER_PORT", "PORT")
    )
    # Optional shared secret. When empty, the API is open (local no-auth mode).
    worker_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("WORKER_API_KEY", "ROBOT_AGENT_API_KEY"),
    )
    cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:3001",
        validation_alias=AliasChoices("CORS_ORIGINS"),
    )

    # --- Queue concurrency ---
    interactive_queue_workers: int = 1
    batch_queue_workers: int = 1
    compare_queue_workers: int = 1

    # --- Inference defaults ---
    default_confidence: float = 0.25
    default_iou: float = 0.45
    default_image_size: int = 640
    temp_dir: str = "./.worker-tmp"

    # --- Upload image QA ---
    upload_auto_portrait: bool = Field(
        default=True,
        validation_alias=AliasChoices("UPLOAD_AUTO_PORTRAIT"),
    )
    upload_reject_blurry: bool = Field(
        default=True,
        validation_alias=AliasChoices("UPLOAD_REJECT_BLURRY"),
    )
    upload_blur_threshold: float = Field(
        default=80.0,
        validation_alias=AliasChoices("UPLOAD_BLUR_THRESHOLD"),
        description="Laplacian variance minimum; lower = more rejections",
    )

    # --- Upload image QA (auto portrait + blur reject) ---
    upload_auto_portrait: bool = Field(
        default=True,
        validation_alias=AliasChoices("UPLOAD_AUTO_PORTRAIT"),
    )
    upload_reject_blurry: bool = Field(
        default=True,
        validation_alias=AliasChoices("UPLOAD_REJECT_BLURRY"),
    )
    upload_blur_threshold: float = Field(
        default=80.0,
        validation_alias=AliasChoices("UPLOAD_BLUR_THRESHOLD"),
        description="Laplacian variance below this is treated as blurry",
    )
    upload_blur_max_side: int = Field(
        default=800,
        validation_alias=AliasChoices("UPLOAD_BLUR_MAX_SIDE"),
    )
    upload_preprocess_workers: int = Field(
        default=6,
        validation_alias=AliasChoices("UPLOAD_PREPROCESS_WORKERS"),
    )
    upload_db_workers: int = Field(
        default=12,
        validation_alias=AliasChoices(
            "UPLOAD_DB_WORKERS", "UPLOAD_FIRESTORE_WORKERS"
        ),
    )
    max_image_size: int = Field(
        default=1280,
        validation_alias=AliasChoices("MAX_IMAGE_SIZE"),
    )
    hf_hub_disable_xet: bool = Field(
        default=True,
        validation_alias=AliasChoices("HF_HUB_DISABLE_XET"),
    )
    auto_label_use_local_images: bool = Field(
        default=True,
        validation_alias=AliasChoices("AUTO_LABEL_USE_LOCAL_IMAGES"),
    )
    hf_upload_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("HF_UPLOAD_ENABLED"),
    )

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url.strip() and self.supabase_service_role_key.strip())

    @property
    def hf_configured(self) -> bool:
        return bool(
            self.hf_token.strip()
            and self.dataset_repo_id
            and self.model_repo_id
        )

    @property
    def dataset_repo_id(self) -> str:
        if self.hf_dataset_repo:
            return self.hf_dataset_repo
        if self.hf_username:
            return f"{self.hf_username}/robo-flow-datasets"
        return ""

    @property
    def model_repo_id(self) -> str:
        if self.hf_model_repo:
            return self.hf_model_repo
        if self.hf_username:
            return f"{self.hf_username}/robo-flow-models"
        return ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def storage_base_path(self) -> Path:
        base = self.railway_volume_mount_path.strip() or "/tmp"
        return Path(base)

    @property
    def model_files_dir(self) -> Path:
        raw = self.model_dir.strip()
        return Path(raw) if raw else self.storage_base_path / "models"

    @property
    def dataset_files_dir(self) -> Path:
        raw = self.dataset_local_dir.strip()
        return Path(raw) if raw else self.storage_base_path / "datasets"

    @property
    def hf_cache_dir(self) -> Path:
        raw = self.hf_home.strip()
        return Path(raw) if raw else self.storage_base_path / "huggingface"

    @property
    def hf_hub_cache_dir(self) -> Path:
        raw = self.hf_hub_cache.strip()
        return Path(raw) if raw else self.hf_cache_dir / "hub"

    @property
    def torch_home_dir(self) -> Path:
        raw = self.torch_home.strip()
        return Path(raw) if raw else self.storage_base_path / "torch"

    @property
    def transformers_cache_dir(self) -> Path:
        raw = self.transformers_cache.strip()
        return Path(raw) if raw else self.hf_cache_dir


settings = Settings()

os.environ.setdefault("HF_HOME", str(settings.hf_cache_dir))
os.environ.setdefault("HF_HUB_CACHE", str(settings.hf_hub_cache_dir))
os.environ.setdefault("TRANSFORMERS_CACHE", str(settings.transformers_cache_dir))
os.environ.setdefault("TORCH_HOME", str(settings.torch_home_dir))
if settings.hf_hub_disable_xet:
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
