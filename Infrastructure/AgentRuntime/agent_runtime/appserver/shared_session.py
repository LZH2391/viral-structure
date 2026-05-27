from __future__ import annotations

import atexit
from pathlib import Path
from typing import TYPE_CHECKING, Mapping, Sequence

from .events import TurnRunResult
from .shared_client import close_shared_client, get_shared_client, start_shared_client

if TYPE_CHECKING:
    from .client import AppServerSessionClient


def _client_symbols():
    from .client import (
        DEFAULT_CODEX_APP_SERVER_COMMAND,
        AppServerConnectionError,
        AppServerSessionClient,
    )

    return DEFAULT_CODEX_APP_SERVER_COMMAND, AppServerConnectionError, AppServerSessionClient


def start_shared_app_server_client(
    *,
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
) -> "AppServerSessionClient":
    default_command, connection_error, session_client = _client_symbols()
    try:
        return start_shared_client(
            client_factory=session_client,
            default_codex_command=default_command,
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
    except RuntimeError as exc:
        raise connection_error(str(exc)) from exc


def get_shared_app_server_client() -> "AppServerSessionClient":
    _, connection_error, _ = _client_symbols()
    try:
        return get_shared_client()
    except RuntimeError as exc:
        raise connection_error(str(exc)) from exc


def close_shared_app_server_client() -> None:
    close_shared_client()


atexit.register(close_shared_app_server_client)


def _create_session_client(
    *,
    workspace_root: str | Path,
    transport_mode: str,
    transport_url: str | None,
    codex_command: Sequence[str] | None,
    service_name: str,
    model: str | None,
    base_env: Mapping[str, str] | None,
    request_timeout_seconds: float,
    turn_timeout_seconds: float,
    init_timeout_seconds: float,
    tool_timeout_seconds: float,
) -> "AppServerSessionClient":
    _, _, session_client = _client_symbols()
    return session_client(
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


def collect_turn_result(
    *,
    workspace_root: str | Path,
    thread_id: str,
    turn_id: str,
    return_thread_state: bool = False,
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
) -> TurnRunResult:
    client = _create_session_client(
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
    try:
        return client.collect_turn_result(
            thread_id=thread_id,
            turn_id=turn_id,
            return_thread_state=return_thread_state,
        )
    finally:
        client.close()


def wait_turn_result(
    *,
    workspace_root: str | Path,
    thread_id: str,
    turn_id: str,
    timeout_seconds: float | None = None,
    return_thread_state: bool = False,
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
) -> TurnRunResult:
    client = _create_session_client(
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
    try:
        return client.wait_turn_result(
            thread_id=thread_id,
            turn_id=turn_id,
            timeout_seconds=timeout_seconds,
            return_thread_state=return_thread_state,
        )
    finally:
        client.close()
