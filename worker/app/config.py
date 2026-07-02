from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Supabase (Postgres metadata + Storage) ---
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

    # --- Legacy Hugging Face (optional — superseded by Supabase Storage) ---
    hf_token: str = Field(default="", validation_alias=AliasChoices("HF_TOKEN"))
    hf_username: str = Field(default="", validation_alias=AliasChoices("HF_USERNAME"))
    hf_dataset_repo: str = Field(
        default="", validation_alias=AliasChoices("HF_DATASET_REPO")
    )
    hf_model_repo: str = Field(
        default="", validation_alias=AliasChoices("HF_MODEL_REPO")
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

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url.strip() and self.supabase_service_role_key.strip())

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


settings = Settings()
