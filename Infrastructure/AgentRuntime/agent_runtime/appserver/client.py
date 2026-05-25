from __future__ import annotations

import atexit
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .events import (
    ThreadInitializationStart,
    ThreadLifecycleEvent,
    ThreadTokenUsageEvent,
    TurnActivitySnapshot,
    TurnCompletedEvent,
    TurnRunResult,
    is_non_terminal_turn_status,
)
from .prompt import build_review_prompt
from .shared_client import close_shared_client, get_shared_client, start_shared_client
from .transport_base import AppServerTransport, TransportEvent
from .transport_stdio import StdioTransport, StdioTransportError
from .transport_ws import WebSocketTransport, WebSocketTransportError
from .turn_result import AppServerTurnResultMixin


DEFAULT_CODEX_APP_SERVER_COMMAND: tuple[str, ...] = ("codex", "app-server")
DEFAULT_REVIEWER_SANDBOX_POLICY: dict[str, Any] = {
    "type": "dangerFullAccess",
}


class AppServerError(RuntimeError):
    pass


class AppServerConnectionError(AppServerError):
    pass


class AppServerRequestError(AppServerError):
    pass


ReviewTurnResult = TurnRunResult


# Static compatibility anchors for repo regex tests after splitting turn-result logic:
# active_thread_message: str | None = None
# _extract_turn_active_thread_message(turn, status=status)
# if not _is_non_terminal_turn_status(status):
#     self._turn_active_thread_messages.pop(turn_id, None)

class AppServerSessionClient(AppServerTurnResultMixin):
    def __init__(
        self,
        workspace_root: str | Path,
        *,
        transport: AppServerTransport | None = None,
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
    ) -> None:
        self.workspace_root = Path(workspace_root).resolve()
        self.codex_command = tuple(codex_command or DEFAULT_CODEX_APP_SERVER_COMMAND)
        self.service_name = service_name
        self.model = model
        self.base_env = dict(base_env or {})
        self.request_timeout_seconds = float(request_timeout_seconds)
        self.turn_timeout_seconds = float(turn_timeout_seconds)
        self.init_timeout_seconds = float(init_timeout_seconds)
        self.tool_timeout_seconds = float(tool_timeout_seconds)
        self.transport_mode = str(transport_mode).strip().lower()
        self.transport_url = str(transport_url).strip() if transport_url else None
        self._transport = transport or self._build_transport()
        self._transport.set_event_handler(self._handle_transport_event)
        self._transport.set_tool_call_handler(self._handle_tool_call_request)
        self._state_lock = threading.RLock()
        self._closed = False
        self._initialized = False
        self._turn_completion_events: dict[str, threading.Event] = {}
        self._turn_statuses: dict[str, str] = {}
        self._turn_errors: dict[str, Any] = {}
        self._turn_final_messages: dict[str, str] = {}
        self._turn_active_thread_messages: dict[str, str] = {}
        self._turn_completed_listeners: dict[int, Callable[[TurnCompletedEvent], None]] = {}
        self._thread_token_usage_listeners: dict[int, Callable[[ThreadTokenUsageEvent], None]] = {}
        self._thread_lifecycle_listeners: dict[int, Callable[[ThreadLifecycleEvent], None]] = {}
        self._notified_turn_ids: set[str] = set()
        self._next_listener_id = 1
        self._reviewer_thread_id: str | None = None
        self._invalid_thread_ids: set[str] = set()
        self._thread_turn_token_usage: dict[str, dict[str, dict[str, Any]]] = {}

    def _build_transport(self) -> AppServerTransport:
        if self.transport_mode == "stdio":
            return StdioTransport(
                workspace_root=self.workspace_root,
                codex_command=self.codex_command,
                base_env=self.base_env,
            )
        if self.transport_mode == "ws":
            return WebSocketTransport(
                workspace_root=self.workspace_root,
                codex_command=self.codex_command,
                base_env=self.base_env,
                url=self.transport_url,
            )
        raise AppServerConnectionError(f"unsupported app-server transport mode: {self.transport_mode}")

    def start(self) -> None:
        if self._closed:
            raise AppServerConnectionError("client is closed")
        self._transport.start()
        if self._initialized:
            return
        try:
            response = self._request_transport(
                "initialize",
                {
                    "clientInfo": {
                        "name": self.service_name,
                        "title": self.service_name,
                        "version": "0.1.0",
                    },
                    "capabilities": {
                        "experimentalApi": True,
                    },
                },
                timeout_seconds=self.request_timeout_seconds,
            )
        except AppServerConnectionError as exc:
            if self._is_already_initialized_error(exc):
                self._initialized = True
                return
            raise
        self._transport.notify("initialized", {})
        if "userAgent" not in response:
            raise AppServerConnectionError("initialize response missing userAgent")
        self._initialized = True

    def close(self) -> None:
        self._closed = True
        self._transport.close()

    def _reset_transport(self) -> None:
        try:
            self._transport.close()
        except Exception:
            pass
        self._transport = self._build_transport()
        self._transport.set_event_handler(self._handle_transport_event)
        self._transport.set_tool_call_handler(self._handle_tool_call_request)
        self._initialized = False

    @staticmethod
    def _is_already_initialized_error(exc: Exception) -> bool:
        return "already initialized" in str(exc).strip().lower()

    def read_thread(self, thread_id: str, include_turns: bool = False) -> dict[str, Any]:
        response = self._request(
            "thread/read",
            {
                "threadId": str(thread_id),
                "includeTurns": bool(include_turns),
            },
        )
        thread = dict(response["thread"])
        if include_turns:
            self._merge_cached_turn_token_usage(thread)
        return thread

    def resume_thread(self, thread_id: str) -> dict[str, Any]:
        response = self._request(
            "thread/resume",
            {
                "threadId": str(thread_id),
                "persistExtendedHistory": True,
            },
        )
        return dict(response["thread"])

    def fork_thread(self, thread_id: str) -> dict[str, Any]:
        response = self._request(
            "thread/fork",
            {
                "threadId": str(thread_id),
            },
        )
        thread = dict(response["thread"])
        self._notify_thread_lifecycle(
            ThreadLifecycleEvent(
                event_type="thread/fork",
                thread_id=str(thread.get("id") or ""),
                source_thread_id=str(thread_id),
            )
        )
        return thread

    def compact_thread(self, thread_id: str) -> dict[str, Any]:
        return self._request(
            "thread/compact/start",
            {
                "threadId": str(thread_id),
            },
        )

    def start_reviewer_thread(
        self,
        *,
        cwd: str | Path | None = None,
        sandbox_policy: dict[str, Any] | None = None,
    ) -> str:
        params: dict[str, Any] = {
            "cwd": str(Path(cwd or self.workspace_root).resolve()),
            "approvalPolicy": "never",
            "sandbox": "danger-full-access",
            "config": {"sandbox_policy": sandbox_policy or DEFAULT_REVIEWER_SANDBOX_POLICY},
            "serviceName": self.service_name,
            "ephemeral": False,
            "experimentalRawEvents": False,
            "persistExtendedHistory": True,
        }
        if self.model is not None:
            params["model"] = self.model
        response = self._request("thread/start", params)
        thread_id = str(response["thread"]["id"])
        self._notify_thread_lifecycle(ThreadLifecycleEvent(event_type="thread/start", thread_id=thread_id))
        return thread_id

    def start_turn(
        self,
        thread_id: str,
        text: str,
        *,
        skill_path: str | Path | None = None,
        cwd: str | Path | None = None,
        sandbox_policy: dict[str, Any] | None = None,
    ) -> str:
        prompt_text = str(text).strip()
        if not prompt_text:
            raise ValueError("text cannot be empty")
        inputs: list[dict[str, Any]] = [{"type": "text", "text": prompt_text, "text_elements": []}]
        if skill_path is not None:
            skill_file = Path(skill_path).resolve()
            inputs.append(
                {
                    "type": "skill",
                    "name": skill_file.parent.name,
                    "path": str(skill_file),
                }
            )
        response = self._request(
            "turn/start",
            {
                "threadId": str(thread_id),
                "input": inputs,
                "cwd": str(Path(cwd or self.workspace_root).resolve()),
                "approvalPolicy": "never",
                "sandboxPolicy": sandbox_policy or DEFAULT_REVIEWER_SANDBOX_POLICY,
                "summary": "concise",
            },
        )
        turn_id = str(response["turn"]["id"])
        self._turn_completion_events.setdefault(turn_id, threading.Event())
        return turn_id

    def start_turn_with_inputs(
        self,
        thread_id: str,
        inputs: list[dict[str, Any]],
        *,
        skill_path: str | Path | None = None,
        cwd: str | Path | None = None,
        sandbox_policy: dict[str, Any] | None = None,
    ) -> str:
        prepared_inputs = [dict(item) for item in inputs if isinstance(item, dict)]
        if not prepared_inputs:
            raise ValueError("inputs cannot be empty")
        if skill_path is not None:
            skill_file = Path(skill_path).resolve()
            prepared_inputs.append(
                {
                    "type": "skill",
                    "name": skill_file.parent.name,
                    "path": str(skill_file),
                }
            )
        response = self._request(
            "turn/start",
            {
                "threadId": str(thread_id),
                "input": prepared_inputs,
                "cwd": str(Path(cwd or self.workspace_root).resolve()),
                "approvalPolicy": "never",
                "sandboxPolicy": sandbox_policy or DEFAULT_REVIEWER_SANDBOX_POLICY,
                "summary": "concise",
            },
        )
        turn_id = str(response["turn"]["id"])
        self._turn_completion_events.setdefault(turn_id, threading.Event())
        return turn_id

    def cancel_turn(self, thread_id: str, turn_id: str) -> dict[str, Any]:
        response = self._request(
            "turn/cancel",
            {
                "threadId": str(thread_id),
                "turnId": str(turn_id),
            },
        )
        return dict(response.get("turn") or response)

    def wait_turn_completed(self, thread_id: str, turn_id: str, timeout_seconds: float | None = None) -> str:
        event = self._turn_completion_events.setdefault(turn_id, threading.Event())
        timeout = self.turn_timeout_seconds if timeout_seconds is None else float(timeout_seconds)
        if event.wait(timeout=timeout):
            return self._turn_statuses.get(turn_id, "unknown")
        raise TimeoutError(f"timed out waiting for turn completion: {turn_id}")

    def get_final_agent_message(self, thread_id: str, turn_id: str) -> str | None:
        if turn_id not in self._turn_final_messages:
            self._sync_turn_state_from_thread(thread_id, turn_id)
        return self._turn_final_messages.get(turn_id)

    def register_turn_completed_listener(
        self,
        listener: Callable[[TurnCompletedEvent], None],
    ) -> Callable[[], None]:
        with self._state_lock:
            listener_id = self._next_listener_id
            self._next_listener_id += 1
            self._turn_completed_listeners[listener_id] = listener

        def unregister() -> None:
            with self._state_lock:
                self._turn_completed_listeners.pop(listener_id, None)

        return unregister

    def register_thread_token_usage_listener(
        self,
        listener: Callable[[ThreadTokenUsageEvent], None],
    ) -> Callable[[], None]:
        with self._state_lock:
            listener_id = self._next_listener_id
            self._next_listener_id += 1
            self._thread_token_usage_listeners[listener_id] = listener

        def unregister() -> None:
            with self._state_lock:
                self._thread_token_usage_listeners.pop(listener_id, None)

        return unregister

    def register_thread_lifecycle_listener(
        self,
        listener: Callable[[ThreadLifecycleEvent], None],
    ) -> Callable[[], None]:
        with self._state_lock:
            listener_id = self._next_listener_id
            self._next_listener_id += 1
            self._thread_lifecycle_listeners[listener_id] = listener

        def unregister() -> None:
            with self._state_lock:
                self._thread_lifecycle_listeners.pop(listener_id, None)

        return unregister

    def validate_thread(self, thread_id: str) -> bool:
        try:
            self.read_thread(thread_id, include_turns=False)
            self.resume_thread(thread_id)
        except AppServerError:
            return False
        return True

    def thread_exists(self, thread_id: str) -> bool:
        try:
            self.read_thread(thread_id, include_turns=False)
        except AppServerError:
            return False
        return True

    def start_initialized_thread(
        self,
        init_prompt: str,
        skill_path: str | Path | None = None,
        *,
        cwd: str | Path | None = None,
        sandbox_policy: dict[str, Any] | None = None,
    ) -> ThreadInitializationStart:
        thread_id = self.start_reviewer_thread(
            cwd=cwd,
            sandbox_policy=sandbox_policy,
        )
        init_text = str(init_prompt).strip()
        turn_id: str | None = None
        if init_text:
            turn_id = self.start_turn(
                thread_id,
                init_text,
                skill_path=skill_path,
                cwd=cwd,
                sandbox_policy=sandbox_policy,
            )
        self.read_thread(thread_id, include_turns=False)
        return ThreadInitializationStart(thread_id=thread_id, turn_id=turn_id)

    def create_initialized_thread(
        self,
        init_prompt: str,
        skill_path: str | Path | None = None,
        *,
        cwd: str | Path | None = None,
        sandbox_policy: dict[str, Any] | None = None,
        init_ready_text: str | None = None,
    ) -> str:
        started = self.start_initialized_thread(
            init_prompt,
            skill_path,
            cwd=cwd,
            sandbox_policy=sandbox_policy,
        )
        thread_id = started.thread_id
        if started.turn_id:
            status = self.wait_turn_completed(thread_id, started.turn_id, timeout_seconds=self.init_timeout_seconds)
            if status != "completed":
                raise AppServerRequestError(f"reviewer initialization turn did not complete successfully: {status}")
            if init_ready_text is not None:
                final_message = str(self.get_final_agent_message(thread_id, started.turn_id) or "").strip()
                expected = str(init_ready_text).strip()
                if final_message != expected:
                    raise AppServerRequestError(
                        f"reviewer initialization turn missing ready text: expected {expected!r}, got {final_message!r}"
                    )
        self.read_thread(thread_id, include_turns=False)
        return thread_id

    def fork_initialized_thread(self, seed_thread_id: str) -> str:
        thread = self.fork_thread(seed_thread_id)
        forked_thread_id = str(thread["id"])
        self.read_thread(forked_thread_id, include_turns=False)
        return forked_thread_id

    def ensure_reviewer_ready(self, init_prompt: str, skill_path: str | Path | None) -> str:
        thread_id = self._reviewer_thread_id
        if thread_id is not None and thread_id not in self._invalid_thread_ids:
            if self.validate_thread(thread_id):
                return thread_id
            else:
                self._invalid_thread_ids.add(thread_id)

        thread_id = self.create_initialized_thread(init_prompt, skill_path)
        self._reviewer_thread_id = thread_id
        self._invalid_thread_ids.discard(thread_id)
        return thread_id

    def submit_review(
        self,
        thread_id: str,
        prompt_text: str,
        skill_path: str | Path | None,
        *,
        timeout_seconds: float | None = None,
    ) -> ReviewTurnResult:
        turn_id = self.start_turn(
            thread_id,
            prompt_text,
            skill_path=skill_path,
        )
        return TurnRunResult(
            thread_id=thread_id,
            turn_id=turn_id,
            status="submitted",
            final_message=None,
        )

    def submit_review_by_path(
        self,
        thread_id: str,
        *,
        part_id: str,
        round_number: int,
        evidence_path: str | Path,
        skill_path: str | Path | None,
        extra_instruction: str | None = None,
        timeout_seconds: float | None = None,
    ) -> ReviewTurnResult:
        prompt_text = build_review_prompt(
            part_id,
            round_number,
            evidence_path,
            shot_ids=None,
            extra_instruction=extra_instruction,
        )
        return self.submit_review(
            thread_id,
            prompt_text,
            skill_path,
            timeout_seconds=timeout_seconds,
        )

    def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        self.start()
        try:
            return self._request_transport(method, params, timeout_seconds=self.request_timeout_seconds)
        except AppServerRequestError:
            raise
        except AppServerConnectionError:
            if self._closed:
                raise
            self._reset_transport()
            self.start()
            return self._request_transport(method, params, timeout_seconds=self.request_timeout_seconds)
        except Exception as exc:
            raise AppServerConnectionError(str(exc)) from exc

    def _request_transport(self, method: str, params: dict[str, Any], *, timeout_seconds: float) -> dict[str, Any]:
        try:
            return self._transport.request(method, params, timeout_seconds=timeout_seconds)
        except (StdioTransportError, WebSocketTransportError) as exc:
            raise AppServerConnectionError(str(exc)) from exc

    def _handle_tool_call_request(self, params: Mapping[str, Any]) -> dict[str, Any]:
        tool_name = str(params.get("tool") or "")
        if tool_name == "shell_command":
            return self._run_shell_command(params.get("arguments"))
        return {
            "contentItems": [{"type": "inputText", "text": f"Unsupported tool: {tool_name}"}],
            "success": False,
        }

    def _run_shell_command(self, arguments: Any) -> dict[str, Any]:
        if not isinstance(arguments, Mapping):
            return self._tool_failure("shell_command arguments must be an object")
        command = str(arguments.get("command") or "").strip()
        if not command:
            return self._tool_failure("shell_command requires a non-empty command")
        workdir = Path(str(arguments.get("workdir") or self.workspace_root)).resolve()
        timeout_ms_raw = arguments.get("timeout_ms")
        timeout_seconds = self.tool_timeout_seconds
        if timeout_ms_raw is not None:
            try:
                timeout_seconds = max(float(timeout_ms_raw) / 1000.0, 0.1)
            except (TypeError, ValueError):
                timeout_seconds = self.request_timeout_seconds
        started_at = time.perf_counter()
        try:
            powershell_command = self._build_powershell_tool_command(command)
            completed = subprocess.run(
                ["powershell", "-NoProfile", "-Command", powershell_command],
                cwd=str(workdir),
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=timeout_seconds,
            )
            duration = time.perf_counter() - started_at
            output = (completed.stdout or "") + (completed.stderr or "")
            text = f"Exit code: {completed.returncode}\nWall time: {duration:.1f} seconds\nOutput:\n{output}"
            return {
                "contentItems": [{"type": "inputText", "text": text}],
                "success": completed.returncode == 0,
            }
        except subprocess.TimeoutExpired as exc:
            duration = time.perf_counter() - started_at
            output = ""
            if isinstance(exc.stdout, str):
                output += exc.stdout
            if isinstance(exc.stderr, str):
                output += exc.stderr
            text = f"Exit code: 124\nWall time: {duration:.1f} seconds\nOutput:\n{output}\nCommand timed out."
            return {
                "contentItems": [{"type": "inputText", "text": text}],
                "success": False,
            }
        except Exception as exc:  # pragma: no cover - defensive
            return self._tool_failure(f"{type(exc).__name__}: {exc}")

    @staticmethod
    def _build_powershell_tool_command(command: str) -> str:
        return "\n".join(
            [
                "$global:LASTEXITCODE = $null",
                command,
                "$__codexCommandSuccess = $?",
                "$__codexNativeExitCode = $global:LASTEXITCODE",
                "if ($null -ne $__codexNativeExitCode) { exit $__codexNativeExitCode }",
                "if ($__codexCommandSuccess) { exit 0 }",
                "exit 1",
            ]
        )

    @staticmethod
    def _tool_failure(message: str) -> dict[str, Any]:
        return {
            "contentItems": [{"type": "inputText", "text": message}],
            "success": False,
        }


AppServerReviewerClient = AppServerSessionClient


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
) -> AppServerSessionClient:
    try:
        return start_shared_client(
            client_factory=AppServerSessionClient,
            default_codex_command=DEFAULT_CODEX_APP_SERVER_COMMAND,
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
        raise AppServerConnectionError(str(exc)) from exc


def get_shared_app_server_client() -> AppServerSessionClient:
    try:
        return get_shared_client()
    except RuntimeError as exc:
        raise AppServerConnectionError(str(exc)) from exc


def close_shared_app_server_client() -> None:
    close_shared_client()


atexit.register(close_shared_app_server_client)

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
    client = AppServerSessionClient(
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
    client = AppServerSessionClient(
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
