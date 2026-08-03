from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings

_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    database_url: str | None = Field(default=None, alias="AION_DATABASE_URL")
    storage_bucket: str = Field(default="aion-datasets", alias="AION_STORAGE_BUCKET")
    platform_admin_emails: str = Field(default="", alias="AION_PLATFORM_ADMIN_EMAILS")
    allowed_origins: str = Field(default="http://localhost:3000", alias="AION_ALLOWED_ORIGINS")

    # Convención nativa de Supabase (sin prefijo AION_, para copiar/pegar directo del dashboard)
    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")
    supabase_jwt_secret: str = Field(default="", alias="SUPABASE_JWT_SECRET")

    class Config:
        populate_by_name = True
        env_file = str(_ENV_FILE)
        env_file_encoding = "utf-8"
        extra = "ignore"

    @property
    def platform_admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.platform_admin_emails.split(",") if e.strip()}

    @property
    def allowed_origin_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
