from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str = Field(
        validation_alias=AliasChoices("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
    )
    supabase_service_role_key: str = Field(
        validation_alias=AliasChoices(
            "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"
        )
    )

    worker_host: str = "0.0.0.0"
    worker_port: int = 8000
    worker_api_key: str = Field(
        default="dev-worker-key",
        validation_alias=AliasChoices("WORKER_API_KEY", "ROBOT_AGENT_API_KEY"),
    )

    # Queue concurrency limits
    interactive_queue_workers: int = 1
    batch_queue_workers: int = 1
    compare_queue_workers: int = 1

    # YOLO defaults
    default_confidence: float = 0.25
    default_iou: float = 0.45
    temp_dir: str = "./.worker-tmp"

    models_bucket: str = "models"
    datasets_bucket: str = "datasets"


settings = Settings()
