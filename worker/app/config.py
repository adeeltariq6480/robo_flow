from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    firebase_project_id: str = Field(
        validation_alias=AliasChoices("FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_PROJECT_ID")
    )
    firebase_storage_bucket: str = Field(
        validation_alias=AliasChoices(
            "FIREBASE_STORAGE_BUCKET", "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
        )
    )

    worker_host: str = "0.0.0.0"
    worker_port: int = Field(
        default=8000, validation_alias=AliasChoices("WORKER_PORT", "PORT")
    )
    worker_api_key: str = Field(
        default="dev-worker-key",
        validation_alias=AliasChoices("WORKER_API_KEY", "ROBOT_AGENT_API_KEY"),
    )

    interactive_queue_workers: int = 1
    batch_queue_workers: int = 1
    compare_queue_workers: int = 1

    default_confidence: float = 0.25
    default_iou: float = 0.45
    temp_dir: str = "./.worker-tmp"


settings = Settings()
