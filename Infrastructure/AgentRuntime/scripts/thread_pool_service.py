from __future__ import annotations

import argparse
from contextlib import asynccontextmanager
import sys
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_runtime.threadpool import (  # noqa: E402
    AcquireLeaseRequest,
    DiscardThreadRequest,
    ForceUpdateSeedsRequest,
    ReleaseLeaseRequest,
    TouchLeaseRequest,
    ThreadPoolManager,
)
from agent_runtime.uvicorn_logging import build_uvicorn_log_config  # noqa: E402
from pydantic import BaseModel, ConfigDict  # noqa: E402


SERVICE_VERSION = "0.1.0"


class UpdateThreadPoolConfigRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    discard_on_release: bool


class ReleaseOwnerLeasesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner_id: str


def create_app(
    *,
    workspace_root: str | Path,
    config_path: str | Path | None = None,
    host: str = "127.0.0.1",
    port: int = 8767,
    transport_url: str = "ws://127.0.0.1:8146",
    manager: ThreadPoolManager | None = None,
    background_recover: bool = True,
) -> FastAPI:
    resolved_config = Path(config_path).resolve() if config_path else (
        Path(__file__).resolve().parents[2] / "ThreadPool" / "thread_roles.json"
    )
    service_manager = manager or ThreadPoolManager(
        workspace_root=workspace_root,
        config_path=resolved_config,
        transport_url=transport_url,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        service_manager.start(background_recover=background_recover)
        app.state.thread_pool_manager = service_manager
        try:
            yield
        finally:
            service_manager.close()

    app = FastAPI(title="Role Thread Pool Service", version=SERVICE_VERSION, lifespan=lifespan)

    @app.get("/health")
    def health() -> dict[str, Any]:
        return service_manager.health_payload()

    @app.get("/config")
    def get_config() -> dict[str, Any]:
        return service_manager.config_payload()

    @app.post("/config")
    def update_config(request: UpdateThreadPoolConfigRequest) -> dict[str, Any]:
        return service_manager.update_config(discard_on_release=request.discard_on_release)

    @app.post("/maintenance/force-update-seeds")
    def force_update_seeds(request: ForceUpdateSeedsRequest) -> dict[str, Any]:
        try:
            return service_manager.force_update_seeds(reason=request.reason, roles=request.roles)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/roles/{role}/status")
    def role_status(role: str) -> dict[str, Any]:
        try:
            return service_manager.get_role_status(role)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/leases/acquire")
    def acquire_lease(request: AcquireLeaseRequest) -> dict[str, Any]:
        try:
            return service_manager.acquire(role=request.role, owner_id=request.owner_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.post("/leases/{lease_id}/touch")
    def touch_lease(lease_id: str, request: TouchLeaseRequest) -> dict[str, Any]:
        try:
            return service_manager.touch(lease_id=lease_id, owner_id=request.owner_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/leases/{lease_id}/release")
    def release_lease(lease_id: str, request: ReleaseLeaseRequest) -> dict[str, Any]:
        try:
            return service_manager.release(lease_id=lease_id, owner_id=request.owner_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/leases/release-owner")
    def release_owner_leases(request: ReleaseOwnerLeasesRequest) -> dict[str, Any]:
        try:
            return service_manager.release_owner_leases(owner_id=request.owner_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/threads/{thread_id}/discard")
    def discard_thread(thread_id: str, request: DiscardThreadRequest) -> dict[str, Any]:
        try:
            return service_manager.discard_thread(thread_id=thread_id, reason=request.reason)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the role thread pool service.")
    parser.add_argument("--workspace-root", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument(
        "--config-path",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "ThreadPool" / "thread_roles.json",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--transport-url", default="ws://127.0.0.1:8146")
    args = parser.parse_args(argv)

    app = create_app(
        workspace_root=args.workspace_root,
        config_path=args.config_path,
        host=args.host,
        port=args.port,
        transport_url=args.transport_url,
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="info", log_config=build_uvicorn_log_config())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
