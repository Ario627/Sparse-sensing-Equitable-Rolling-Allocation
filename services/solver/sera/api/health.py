from __future__ import annotations

from fastapi import APIRouter

from sera.api.deps import RuntimeDep, solver_version
from sera.api.schemas import HealthResponse, HealthStatus

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(runtime: RuntimeDep) -> HealthResponse:
    status: HealthStatus = "ok" if runtime.registry.is_running else "degraded"
    return HealthResponse(
        status=status,
        version=solver_version(),
        uptime_s=runtime.uptime_seconds(),
        active_experiments=runtime.registry.active_count(),
    )
