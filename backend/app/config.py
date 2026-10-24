"""Settings, read from the environment (or backend/.env). Secrets live here and nowhere else:
the app never sees an R2 or Groq key, it asks this backend for short-lived links instead."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"  # "production" turns off dev-mode email logging
    secret_key: str  # JWT signing key: openssl rand -hex 32
    # Log in once per device: the app keeps reading offline, so a short token would lock you out
    token_days: int = 365
    database_url: str
    cors_origins: str = "http://localhost:5173"  # comma-separated

    # R2 bucket with the books and dictionaries (bucket-scoped token)
    r2_account_id: str = ""
    r2_endpoint: str = ""  # empty = https://<account>.r2.cloudflarestorage.com; set for tests (moto)
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "pico-library"
    download_url_seconds: int = 3600
    upload_url_seconds: int = 3600

    groq_api_key: str = ""
    groq_model: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
