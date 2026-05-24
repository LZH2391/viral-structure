from __future__ import annotations

import atexit
import json
import re
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .prompt import build_review_prompt
from .transport_base import AppServerTransport, TransportEvent
from .transport_stdio import StdioTransport, StdioTransportError
from .transport_ws import WebSocketTransport, WebSocketTransportError


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


@dataclass(frozen=True)
class TurnRunResult:
    thread_id: str
    turn_id: str
    status: str
    final_message: str | None
    active_thread_message: str | None = None
    thread_state: dict[str, Any] | None = None


@dataclass(frozen=True)
class ThreadInitializationStart:
    thread_id: str
    turn_id: str | None


@dataclass(frozen=True)
class TurnCompletedEvent:
    turn_id: str
    status: str
    error: Any = None
    final_message: str | None = None


@dataclass(frozen=True)
class ThreadTokenUsageEvent:
    thread_id: str
    turn_id: str
    token_usage: dict[str, Any]


@dataclass(frozen=True)
class TurnActivitySnapshot:
    thread_id: str
    turn_id: str
    status: str | None
    first_activity_seen: bool
    item_count: int
    effective_item_count: int
    last_token_usage: dict[str, Any] | None = None


@dataclass(frozen=True)
class ThreadLifecycleEvent:
    event_type: str
    thread_id: str
    source_thread_id: str | None = None


ReviewTurnResult = TurnRunResult

_SHARED_APP_SERVER_CLIENT: "AppServerSessionClient | None" = None
_SHARED_APP_SERVER_CLIENT_KEY: tuple[Any, ...] | None = None
_NON_TERMINAL_TURN_STATUSES = {"created", "pending", "queued", "submitted", "running", "inprogress", "in_progress"}


class AppServerSessionClient:
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

    def collect_turn_result(
        self,
        *,
        thread_id: str,
        turn_id: str,
        return_thread_state: bool = False,
    ) -> TurnRunResult:
        cached_status = self._turn_statuses.get(turn_id)
        if cached_status is None or _is_non_terminal_turn_status(cached_status):
            self._sync_turn_state_from_thread(thread_id, turn_id)
        status = self._turn_statuses.get(turn_id, "running")
        final_message = None if _is_non_terminal_turn_status(status) else self.get_final_agent_message(thread_id, turn_id)
        active_thread_message = self._turn_active_thread_messages.get(turn_id) if _is_non_terminal_turn_status(status) else None
        if not _is_non_terminal_turn_status(status):
            self._turn_active_thread_messages.pop(turn_id, None)
        thread_state = self.read_thread(thread_id, include_turns=False) if return_thread_state else None
        return TurnRunResult(
            thread_id=thread_id,
            turn_id=turn_id,
            status=status,
            final_message=final_message,
            active_thread_message=active_thread_message,
            thread_state=thread_state,
        )

    def get_thread_input_tokens(self, thread_id: str) -> int | None:
        thread = self.read_thread(thread_id, include_turns=True)
        return self._extract_thread_input_tokens(thread)

    def inspect_turn_activity(self, thread_id: str, turn_id: str) -> TurnActivitySnapshot:
        thread = self.read_thread(thread_id, include_turns=True)
        for turn in thread.get("turns", []):
            if not isinstance(turn, Mapping):
                continue
            if str(turn.get("id") or "") != str(turn_id):
                continue
            token_usage = self._normalize_turn_last_token_usage(turn)
            items = turn.get("items")
            item_count = len(items) if isinstance(items, list) else 0
            effective_count = self._effective_turn_activity_item_count(turn)
            first_activity_seen = bool(
                effective_count > 0
                or token_usage is not None
                or not _is_non_terminal_turn_status(str(turn.get("status") or "running"))
            )
            return TurnActivitySnapshot(
                thread_id=str(thread_id),
                turn_id=str(turn_id),
                status=str(turn.get("status") or "") or None,
                first_activity_seen=first_activity_seen,
                item_count=item_count,
                effective_item_count=effective_count,
                last_token_usage=token_usage,
            )
        return TurnActivitySnapshot(
            thread_id=str(thread_id),
            turn_id=str(turn_id),
            status=None,
            first_activity_seen=False,
            item_count=0,
            effective_item_count=0,
            last_token_usage=None,
        )

    def wait_turn_result(
        self,
        *,
        thread_id: str,
        turn_id: str,
        timeout_seconds: float | None = None,
        return_thread_state: bool = False,
    ) -> TurnRunResult:
        try:
            status = self.wait_turn_completed(thread_id, turn_id, timeout_seconds=timeout_seconds)
        except TimeoutError:
            self._sync_turn_state_from_thread(thread_id, turn_id)
            status = self._turn_statuses.get(turn_id, "running")
            if _is_non_terminal_turn_status(status):
                raise
        final_message = self.get_final_agent_message(thread_id, turn_id)
        active_thread_message = self._turn_active_thread_messages.get(turn_id) if _is_non_terminal_turn_status(status) else None
        if not _is_non_terminal_turn_status(status):
            self._turn_active_thread_messages.pop(turn_id, None)
        thread_state = self.read_thread(thread_id, include_turns=False) if return_thread_state else None
        return TurnRunResult(
            thread_id=thread_id,
            turn_id=turn_id,
            status=status,
            final_message=final_message,
            active_thread_message=active_thread_message,
            thread_state=thread_state,
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

    def _handle_transport_event(self, event: TransportEvent) -> None:
        method = str(event.method or "")
        params = event.params or {}
        if method == "item/completed":
            turn_id = str(params.get("turnId") or "")
            item = params.get("item") or {}
            if turn_id and isinstance(item, dict) and item.get("type") == "agentMessage":
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    self._turn_final_messages[turn_id] = text.strip()
                    self._maybe_notify_turn_completed(turn_id)
        elif method == "turn/completed":
            turn = params.get("turn") or {}
            turn_id = str(turn.get("id") or "")
            if turn_id:
                status = str(turn.get("status") or "unknown")
                self._turn_statuses[turn_id] = status
                self._turn_errors[turn_id] = turn.get("error")
                if not _is_non_terminal_turn_status(status):
                    self._turn_completion_events.setdefault(turn_id, threading.Event()).set()
                self._maybe_notify_turn_completed(turn_id)
        elif method == "thread/tokenUsage/updated":
            thread_id = str(params.get("threadId") or "")
            turn_id = str(params.get("turnId") or "")
            token_usage = self._normalize_thread_token_usage(params.get("tokenUsage"))
            if thread_id and turn_id and token_usage is not None:
                self._thread_turn_token_usage.setdefault(thread_id, {})[turn_id] = token_usage
                self._notify_thread_token_usage(
                    ThreadTokenUsageEvent(thread_id=thread_id, turn_id=turn_id, token_usage=dict(token_usage))
                )

    def _maybe_notify_turn_completed(self, turn_id: str) -> None:
        if turn_id in self._notified_turn_ids:
            return
        status = self._turn_statuses.get(turn_id)
        if not status or _is_non_terminal_turn_status(status):
            return
        final_message = self._turn_final_messages.get(turn_id)
        if status == "completed" and not final_message:
            return
        self._notified_turn_ids.add(turn_id)
        event = TurnCompletedEvent(
            turn_id=turn_id,
            status=status,
            error=self._turn_errors.get(turn_id),
            final_message=final_message,
        )
        listeners = list(self._turn_completed_listeners.values())
        for listener in listeners:
            try:
                listener(event)
            except Exception:
                continue

    def _notify_thread_token_usage(self, event: ThreadTokenUsageEvent) -> None:
        listeners = list(self._thread_token_usage_listeners.values())
        for listener in listeners:
            try:
                listener(event)
            except Exception:
                continue

    def _notify_thread_lifecycle(self, event: ThreadLifecycleEvent) -> None:
        listeners = list(self._thread_lifecycle_listeners.values())
        for listener in listeners:
            try:
                listener(event)
            except Exception:
                continue

    def _sync_turn_state_from_thread(self, thread_id: str, turn_id: str) -> None:
        thread = self.read_thread(thread_id, include_turns=True)
        for turn in thread.get("turns", []):
            if str(turn.get("id")) != str(turn_id):
                continue
            status = str(turn.get("status") or "running")
            self._turn_statuses[turn_id] = status
            self._turn_errors[turn_id] = turn.get("error")
            event = self._turn_completion_events.setdefault(turn_id, threading.Event())
            if not _is_non_terminal_turn_status(status):
                event.set()
            final_message = self._extract_turn_final_message(turn)
            if final_message is not None:
                self._turn_final_messages[turn_id] = final_message
            active_thread_message = self._extract_turn_active_thread_message(turn, status=status)
            if active_thread_message is not None:
                self._turn_active_thread_messages[turn_id] = active_thread_message
            else:
                self._turn_active_thread_messages.pop(turn_id, None)
            self._maybe_notify_turn_completed(turn_id)
            return

    def _merge_cached_turn_token_usage(self, thread: dict[str, Any]) -> None:
        thread_id = str(thread.get("id") or "")
        turns = thread.get("turns")
        if not thread_id or not isinstance(turns, list):
            return
        cached_by_turn = self._thread_turn_token_usage.get(thread_id, {})
        for turn in turns:
            if not isinstance(turn, dict):
                continue
            turn_id = str(turn.get("id") or "")
            if not turn_id:
                continue
            existing_usage = self._normalize_turn_last_token_usage(turn)
            if existing_usage is not None:
                cached_by_turn[turn_id] = existing_usage
                continue
            cached_usage = cached_by_turn.get(turn_id)
            if cached_usage is None:
                continue
            turn.update(dict(cached_usage))

    @classmethod
    def _normalize_turn_last_token_usage(cls, turn: Mapping[str, Any]) -> dict[str, Any] | None:
        result: dict[str, Any] = {}
        for usage_key in ("last_token_usage", "lastTokenUsage"):
            normalized = cls._normalize_token_usage_breakdown(turn.get(usage_key))
            if normalized is not None:
                result["last_token_usage"] = normalized
                break
        for usage_key in ("total_token_usage", "totalTokenUsage"):
            normalized = cls._normalize_token_usage_breakdown(turn.get(usage_key))
            if normalized is not None:
                result["total_token_usage"] = normalized
                break
        model_context_window = turn.get("model_context_window", turn.get("modelContextWindow"))
        if model_context_window is not None:
            try:
                result["model_context_window"] = int(model_context_window)
            except (TypeError, ValueError):
                pass
        return result or None

    @classmethod
    def _normalize_thread_token_usage(cls, payload: Any) -> dict[str, Any] | None:
        if not isinstance(payload, Mapping):
            return None
        last_usage = cls._normalize_token_usage_breakdown(payload.get("last"))
        if last_usage is None:
            return None
        total_usage = cls._normalize_token_usage_breakdown(payload.get("total"))
        result: dict[str, Any] = {"last_token_usage": last_usage}
        if total_usage is not None:
            result["total_token_usage"] = total_usage
        model_context_window = payload.get("modelContextWindow")
        if model_context_window is not None:
            try:
                result["model_context_window"] = int(model_context_window)
            except (TypeError, ValueError):
                pass
        return result

    @staticmethod
    def _normalize_token_usage_breakdown(payload: Any) -> dict[str, Any] | None:
        if not isinstance(payload, Mapping):
            return None
        field_map = {
            "input_tokens": ("input_tokens", "inputTokens"),
            "cached_input_tokens": ("cached_input_tokens", "cachedInputTokens"),
            "output_tokens": ("output_tokens", "outputTokens"),
            "reasoning_output_tokens": ("reasoning_output_tokens", "reasoningOutputTokens"),
            "total_tokens": ("total_tokens", "totalTokens"),
        }
        result: dict[str, Any] = {}
        for target_key, source_keys in field_map.items():
            for source_key in source_keys:
                raw_value = payload.get(source_key)
                if raw_value is None:
                    continue
                try:
                    result[target_key] = int(raw_value)
                except (TypeError, ValueError):
                    continue
                break
        return result or None

    @classmethod
    def _extract_thread_input_tokens(cls, thread: Mapping[str, Any]) -> int | None:
        turns = thread.get("turns", [])
        if not isinstance(turns, list):
            return None
        for turn in reversed(turns):
            if not isinstance(turn, Mapping):
                continue
            input_tokens = cls._extract_input_tokens_from_payload(turn)
            if input_tokens is not None:
                return input_tokens
        return None

    @classmethod
    def _extract_input_tokens_from_payload(cls, payload: Any) -> int | None:
        if isinstance(payload, Mapping):
            for usage_key in ("last_token_usage", "lastTokenUsage", "token_usage", "tokenUsage"):
                input_tokens = cls._extract_input_tokens_from_usage(payload.get(usage_key))
                if input_tokens is not None:
                    return input_tokens
            for value in payload.values():
                input_tokens = cls._extract_input_tokens_from_payload(value)
                if input_tokens is not None:
                    return input_tokens
            return None
        if isinstance(payload, list):
            for item in reversed(payload):
                input_tokens = cls._extract_input_tokens_from_payload(item)
                if input_tokens is not None:
                    return input_tokens
        return None

    @staticmethod
    def _extract_input_tokens_from_usage(usage: Any) -> int | None:
        if not isinstance(usage, Mapping):
            return None
        raw_value = usage.get("input_tokens", usage.get("inputTokens"))
        if raw_value is None:
            return None
        try:
            value = int(raw_value)
        except (TypeError, ValueError):
            return None
        return value if value >= 0 else None

    @staticmethod
    def _extract_turn_final_message(turn: Mapping[str, Any]) -> str | None:
        for item in reversed(list(turn.get("items", []))):
            if item.get("type") != "agentMessage":
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()
            content = item.get("content")
            if isinstance(content, list):
                parts: list[str] = []
                for content_item in content:
                    if isinstance(content_item, Mapping) and content_item.get("type") == "text":
                        parts.append(str(content_item.get("text") or ""))
                merged = "".join(parts).strip()
                if merged:
                    return merged
        return None

    @staticmethod
    def _extract_turn_active_thread_message(turn: Mapping[str, Any], *, status: str | None = None) -> str | None:
        final_message = AppServerSessionClient._extract_turn_final_message(turn) if not _is_non_terminal_turn_status(status) else None
        for item in reversed(list(turn.get("items", []))):
            if not isinstance(item, Mapping):
                continue
            item_type = str(item.get("type") or "").strip()
            role = str(item.get("role") or item.get("author") or "").strip().lower()
            if item_type not in {"agentMessage", "assistantMessage", "assistant_message", "message"} and role not in {"assistant", "agent", "thread"}:
                continue
            candidate = AppServerSessionClient._extract_text_from_item(item)
            if not candidate:
                continue
            if final_message is not None and candidate == final_message:
                continue
            return candidate
        return None

    @staticmethod
    def _extract_text_from_item(item: Mapping[str, Any]) -> str | None:
        for key in ("text", "message", "final_message", "finalMessage"):
            text = item.get(key)
            if isinstance(text, str) and text.strip():
                return text.strip()
        content = item.get("content")
        if isinstance(content, list):
            parts: list[str] = []
            for content_item in content:
                if isinstance(content_item, Mapping) and str(content_item.get("type") or "") in {"text", "output_text"}:
                    part = str(content_item.get("text") or "").strip()
                    if part:
                        parts.append(part)
            merged = "\n".join(parts).strip()
            if merged:
                return merged
        return None

    @classmethod
    def _effective_turn_activity_item_count(cls, turn: Mapping[str, Any]) -> int:
        items = turn.get("items")
        if not isinstance(items, list):
            return 0
        return sum(1 for item in items if cls._is_effective_activity_item(item))

    @classmethod
    def _is_effective_activity_item(cls, item: Any) -> bool:
        if not isinstance(item, Mapping):
            return False
        item_type = str(item.get("type") or "").strip()
        if item_type in {"task_started", "userMessage", "user_message"}:
            return False
        if item_type in {"agentMessage", "assistantMessage", "toolCall", "toolResult", "reasoning"}:
            return True
        text = item.get("text")
        if isinstance(text, str) and text.strip() and item_type not in {"inputText"}:
            return True
        content = item.get("content")
        if isinstance(content, list):
            return any(cls._is_effective_activity_item(content_item) for content_item in content)
        if isinstance(content, Mapping):
            return cls._is_effective_activity_item(content)
        return False

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
            completed = subprocess.run(
                ["powershell", "-NoProfile", "-Command", command],
                cwd=str(workdir),
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=timeout_seconds,
            )
            duration = time.perf_counter() - started_at
            output = (completed.stdout or "") + (completed.stderr or "")
            text = f"Exit code: {completed.returncode}\nWall time: {duration:.1f} seconds\nOutput:\n{output}"
            content_items = [{"type": "inputText", "text": text}]
            content_items.extend(self._local_images_from_tool_output(output, workdir))
            return {
                "contentItems": content_items,
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
    def _tool_failure(message: str) -> dict[str, Any]:
        return {
            "contentItems": [{"type": "inputText", "text": message}],
            "success": False,
        }

    @staticmethod
    def _local_images_from_tool_output(output: str, workdir: Path) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        seen: set[str] = set()
        for match in re.finditer(r"(?im)^\s*LOCAL_IMAGE:\s*(.+?)\s*$", output or ""):
            raw_path = match.group(1).strip().strip('"').strip("'")
            if not raw_path:
                continue
            path = Path(raw_path)
            if not path.is_absolute():
                path = (workdir / path).resolve()
            else:
                path = path.resolve()
            if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                continue
            if not path.exists() or not path.is_file():
                continue
            normalized = str(path)
            if normalized in seen:
                continue
            seen.add(normalized)
            items.append({"type": "localImage", "path": normalized})
        return items


AppServerReviewerClient = AppServerSessionClient


def _shared_client_key(
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
) -> tuple[Any, ...]:
    env_items = tuple(sorted(dict(base_env or {}).items()))
    return (
        str(Path(workspace_root).resolve()),
        str(transport_mode),
        str(transport_url or ""),
        tuple(codex_command or DEFAULT_CODEX_APP_SERVER_COMMAND),
        str(service_name),
        str(model or ""),
        env_items,
        float(request_timeout_seconds),
        float(turn_timeout_seconds),
        float(init_timeout_seconds),
        float(tool_timeout_seconds),
    )


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
    global _SHARED_APP_SERVER_CLIENT, _SHARED_APP_SERVER_CLIENT_KEY
    key = _shared_client_key(
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
    if _SHARED_APP_SERVER_CLIENT is not None:
        if _SHARED_APP_SERVER_CLIENT_KEY != key:
            raise AppServerConnectionError("shared app-server client already started with different configuration")
        _SHARED_APP_SERVER_CLIENT.start()
        return _SHARED_APP_SERVER_CLIENT
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
    _SHARED_APP_SERVER_CLIENT = client
    _SHARED_APP_SERVER_CLIENT_KEY = key
    return client


def get_shared_app_server_client() -> AppServerSessionClient:
    if _SHARED_APP_SERVER_CLIENT is None:
        raise AppServerConnectionError("shared app-server client is not started")
    return _SHARED_APP_SERVER_CLIENT


def close_shared_app_server_client() -> None:
    global _SHARED_APP_SERVER_CLIENT, _SHARED_APP_SERVER_CLIENT_KEY
    if _SHARED_APP_SERVER_CLIENT is not None:
        _SHARED_APP_SERVER_CLIENT.close()
    _SHARED_APP_SERVER_CLIENT = None
    _SHARED_APP_SERVER_CLIENT_KEY = None


def _is_non_terminal_turn_status(status: str | None) -> bool:
    return str(status or "").strip().lower() in _NON_TERMINAL_TURN_STATUSES


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
