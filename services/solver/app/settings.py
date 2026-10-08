from __future__ import annotations

from functools import cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
API_HANDSHAKE_TIMEOUT_S = 30.0


def resolve_under_package(path: Path) -> Path:
    anchored = path if path.is_absolute() else PACKAGE_ROOT / path
    return anchored.expanduser().resolve()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PACKAGE_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        validate_default=True,
    )

    sera_env: Literal["dev", "demo", "prod"] = "dev"
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    log_format: Literal["console", "json"] = "console"

    solver_host: str = Field(default="0.0.0.0", min_length=1)
    solver_port: int = Field(default=8000, ge=1, le=65535)
    solver_workers: int = Field(default=1, ge=1, le=32)

    default_solver: Literal["highs", "scip"] = "highs"
    scip_enabled: bool = False
    plan_time_limit_s: float = Field(default=25.0, gt=0.0, lt=API_HANDSHAKE_TIMEOUT_S)

    experiment_max_runs: int = Field(default=5000, ge=1, le=1_000_000)
    experiment_max_concurrency: int = Field(default=2, ge=1, le=64)
    experiment_results_dir: Path = Path("../../experiments/results")
    seed_base: int = Field(default=1000, ge=0)

    otel_exporter_otlp_endpoint: str = ""
    prometheus_enabled: bool = False

    @property
    def is_production(self) -> bool:
        return self.sera_env == "prod"

    @property
    def results_dir(self) -> Path:
        return resolve_under_package(self.experiment_results_dir)

    @model_validator(mode="after")
    def _require_consistent_configuration(self) -> Self:
        if self.default_solver == "scip" and not self.scip_enabled:
            raise ValueError("default_solver=scip requires scip_enabled=true")
        if self.is_production and self.log_format != "json":
            raise ValueError("prod environment requires log_format=json")
        if self.experiment_max_concurrency > self.experiment_max_runs:
            raise ValueError("experiment_max_concurrency cannot exceed experiment_max_runs")
        return self


@cache
def get_settings() -> Settings:
    return Settings()
