from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Mapping, Sequence, TypeVar

T = TypeVar("T")

_SHARED_APP_SERVER_CLIENT: Any = None
_SHARED_APP_SERVER_CLIENT_KEY: tuple[Any, ...] | None = None


def shared_client_key(
    *,
    workspace_root: str | Path,
    transport_mode: str,
    transport_url: str | None,
    codex_command: Sequence[str] | None,
    default_codex_command: Sequence[str],
    service_name: str,
    model: str | None,
    base_env: Mapping[str, str] | None,
    request_timeout_seconds: float,
    turn_timeout_seconds: float,
    init_timeout_seconds: float,
    tool_timeout_seconds: float,
) -> tuple[Any, ...]:
    env_items = tuple(sorted(dict(base_env or {}).items()))
    return (
        str(Path(workspace_root).resolve()),
        str(transport_mode),
        str(transport_url or ""),
        tuple(codex_command or default_codex_command),
        str(service_name),
        str(model or ""),
        env_items,
        float(request_timeout_seconds),
        float(turn_timeout_seconds),
        float(init_timeout_seconds),
        float(tool_timeout_seconds),
    )


def start_shared_client(
    *,
    client_factory: Callable[..., T],
    default_codex_command: Sequence[str],
    workspace_root: str | Path,
    transport_mode: str = "ws",
    transport_url: str | None = None,
    codex_command: Sequence[str] | None = None,
    service_name: str = "agent_runtime_app_server",
    model: str | None = None,
    base_env: Mapping[str, str] | None = None,
    request_timeout_seconds: float = 15.0,
    turn_timeout_seconds: float = 60.0,
    init_timeout_seconds: float = 45.0,
    tool_timeout_seconds: float = 15.0,
) -> T:
    global _SHARED_APP_SERVER_CLIENT, _SHARED_APP_SERVER_CLIENT_KEY
    key = shared_client_key(
        workspace_root=workspace_root,
        transport_mode=transport_mode,
        transport_url=transport_url,
        codex_command=codex_command,
        default_codex_command=default_codex_command,
        service_name=service_name,
        model=model,
        base_env=base_env,
        request_timeout_seconds=request_timeout_seconds,
        turn_timeout_seconds=turn_timeout_seconds,
        init_timeout_seconds=init_timeout_seconds,
        tool_timeout_seconds=tool_timeout_seconds,
    )
    if _SHARED_APP_SERVER_CLIENT is not None:
        if _SHARED_APP_SERVER_CLIENT_KEY != key:
            raise AppServerConnectionError("shared app-server client already started with different configuration")
        _SHARED_APP_SERVER_CLIENT.start()
        return _SHARED_APP_SERVER_CLIENT
    client = client_factory(
        workspace_root=workspace_root,
        transport_mode=transport_mode,
        transport_url=transport_url,
        codex_command=codex_command,
        service_name=service_name,
        model=model,
        base_env=base_env,
        request_timeout_seconds=request_timeout_seconds,
        turn_timeout_seconds=turn_timeout_seconds,
        init_timeout_seconds=init_timeout_seconds,
        tool_timeout_seconds=tool_timeout_seconds,
    )
    client.start()
    _SHARED_APP_SERVER_CLIENT = client
    _SHARED_APP_SERVER_CLIENT_KEY = key
    return client


def get_shared_client() -> Any:
    if _SHARED_APP_SERVER_CLIENT is None:
        raise RuntimeError("shared app-server client is not started")
    return _SHARED_APP_SERVER_CLIENT


def close_shared_client() -> None:
    global _SHARED_APP_SERVER_CLIENT, _SHARED_APP_SERVER_CLIENT_KEY
    if _SHARED_APP_SERVER_CLIENT is not None:
        _SHARED_APP_SERVER_CLIENT.close()
    _SHARED_APP_SERVER_CLIENT = None
    _SHARED_APP_SERVER_CLIENT_KEY = None
