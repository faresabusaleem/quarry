"""Runtime settings, read from environment variables and an optional .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", env_prefix="QUARRY_", extra="ignore", populate_by_name=True
    )

    db_path: Path = ROOT / "data" / "quarry.duckdb"
    trace_dir: Path = ROOT / "traces"

    # LLM provider. "gemini" uses the Gemini API free tier, "ollama" a local model.
    provider: Literal["gemini", "ollama", "fake"] = "ollama"
    model: str | None = None  # defaults per provider, see quarry.llm.factory
    gemini_api_key: SecretStr | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_timeout_s: float = 120.0  # per request
    gemini_rpm: int = 10  # client-side pacing; the server-side quota is shown in AI Studio
    ollama_host: str = "http://localhost:11434"
    ollama_think: bool = False

    # Agent budgets (per run).
    max_steps: int = 14
    max_total_tokens: int = 120_000
    # Wall-clock limit; 0 means none. A host that cuts requests off (Vercel: 300 s) sets one
    # below its limit so a slow run still ends with an answer built from what it found.
    max_run_seconds: float = 0
    context_token_limit: int = 24_000  # compact older turns above this estimate

    # SQL guardrails.
    sql_row_limit: int = 1_000
    sql_preview_rows: int = 25
    sql_timeout_s: float = 15.0
    duckdb_memory_limit: str = "2GB"

    # Python sandbox.
    python_enabled: bool = True
    python_timeout_s: float = 10.0
    python_memory_mb: int = 512

    # Public API protection.
    rate_limit_per_ip_hour: int = 20
    rate_limit_global_day: int = 400
    cors_origins: list[str] = ["http://localhost:3000"]
    trust_proxy: bool = False  # read the client IP from X-Forwarded-For (behind a proxy only)


@lru_cache
def get_settings() -> Settings:
    return Settings()
