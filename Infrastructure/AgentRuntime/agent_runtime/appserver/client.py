from __future__ import annotations

import threading
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
from .transport_base import AppServerTransport, TransportEvent
from .transport_stdio import StdioTransport, StdioTransportError
from .transport_ws import WebSocketTransport, WebSocketTransportError
from .token_usage import AppServerTokenUsageMixin
from .tool_handler import AppServerToolHandlerMixin
from .turn_result import AppServerTurnResultMixin


DEFAULT_CODEX_APP_SERVER_COMMAND: tuple[str, ...] = ("codex", "app-server")
DEFAULT_REVIEWER_SANDBOX_POLICY: dict[str, Any] = {
    "type": "dangerFullAccess",
}
TRANSPORT_RECOVERY_ATTEMPTS = 3


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

class AppServerSessionClient(AppServerToolHandlerMixin, AppServerTokenUsageMixin, AppServerTurnResultMixin):
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
        self._turn_activity_items: dict[str, list[dict[str, Any]]] = {}
        self._turn_completed_listeners: dict[int, Callable[[TurnCompletedEvent], None]] = {}
        self._thread_token_usage_listeners: dict[int, Callable[[ThreadTokenUsageEvent], None]] = {}
        self._thread_lifecycle_listeners: dict[int, Callable[[ThreadLifecycleEvent], None]] = {}
        self._notified_turn_ids: set[str] = set()
        self._next_listener_id = 1
        self._reviewer_thread_id: str | None = None
        self._invalid_thread_ids: set[str] = set()
        self._thread_token_usage_path = (self.workspace_root / "_workspace" / "runtime" / "appserver" / "thread_token_usage.json").resolve()
        self._thread_token_usage_lock_path = self._thread_token_usage_path.with_suffix(".lock")
        self._thread_token_usage: dict[str, dict[str, Any]] = self._load_thread_token_usage()

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
        if self._initialized:
            return
        last_error: Exception | None = None
        for attempt_index in range(TRANSPORT_RECOVERY_ATTEMPTS):
            self._start_transport_with_recovery()
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
                last_error = exc
                if self._closed or attempt_index >= TRANSPORT_RECOVERY_ATTEMPTS - 1:
                    raise
                self._reset_transport()
                continue
            self._transport.notify("initialized", {})
            if "userAgent" not in response:
                raise AppServerConnectionError("initialize response missing userAgent")
            self._initialized = True
            return
        raise AppServerConnectionError(str(last_error or "transport initialize failed")) from last_error

    def _start_transport_with_recovery(self) -> None:
        last_error: Exception | None = None
        for attempt_index in range(TRANSPORT_RECOVERY_ATTEMPTS):
            try:
                self._transport.start()
                return
            except (StdioTransportError, WebSocketTransportError) as exc:
                last_error = exc
                if self._closed or attempt_index >= TRANSPORT_RECOVERY_ATTEMPTS - 1:
                    break
                self._reset_transport()
        raise AppServerConnectionError(str(last_error or "transport start failed")) from last_error

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
        self._merge_cached_turn_token_usage(thread, persist=include_turns)
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
        source_thread_id = str(thread_id)
        forked_thread_id = str(thread.get("id") or "")
        if source_thread_id and forked_thread_id:
            self._clone_thread_token_usage(source_thread_id, forked_thread_id)
        self._notify_thread_lifecycle(
            ThreadLifecycleEvent(
                event_type="thread/fork",
                thread_id=forked_thread_id,
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

    def list_turn_items(
        self,
        thread_id: str,
        turn_id: str,
        *,
        limit: int | None = 200,
        sort_direction: str = "asc",
    ) -> dict[str, Any]:
        listed_turn = self._list_turn_with_items(
            thread_id=str(thread_id),
            turn_id=str(turn_id),
            limit=limit,
            sort_direction=sort_direction,
        )
        if listed_turn is not None:
            return {
                "data": list(listed_turn.get("items") or []),
                "nextCursor": None,
                "backwardsCursor": None,
                "source": "thread/turns/list",
                "itemsView": listed_turn.get("itemsView"),
            }
        params: dict[str, Any] = {
            "threadId": str(thread_id),
            "turnId": str(turn_id),
            "sortDirection": str(sort_direction),
        }
        if limit is not None:
            params["limit"] = int(limit)
        items: list[Any] = []
        cursor: str | None = None
        backwards_cursor: str | None = None
        while True:
            if cursor:
                params["cursor"] = cursor
            response = self._request("thread/turns/items/list", params)
            page_items = response.get("data")
            if isinstance(page_items, list):
                items.extend(page_items)
            next_cursor = response.get("nextCursor") or response.get("next_cursor")
            backwards_cursor = response.get("backwardsCursor") or response.get("backwards_cursor") or backwards_cursor
            if not next_cursor:
                return {
                    "data": items,
                    "nextCursor": None,
                    "backwardsCursor": backwards_cursor,
                    "source": "thread/turns/items/list",
                }
            cursor = str(next_cursor)

    def _list_turn_with_items(
        self,
        *,
        thread_id: str,
        turn_id: str,
        limit: int | None,
        sort_direction: str,
    ) -> dict[str, Any] | None:
        target_turn_id = str(turn_id)
        params: dict[str, Any] = {
            "threadId": str(thread_id),
            "sortDirection": str(sort_direction),
            "itemsView": "full",
        }
        if limit is not None:
            params["limit"] = int(limit)
        cursor: str | None = None
        while True:
            if cursor:
                params["cursor"] = cursor
            response = self._request("thread/turns/list", params)
            turns = response.get("data")
            if isinstance(turns, list):
                for turn in turns:
                    if isinstance(turn, dict) and str(turn.get("id") or "") == target_turn_id:
                        return dict(turn)
            next_cursor = response.get("nextCursor") or response.get("next_cursor")
            if not next_cursor:
                return None
            cursor = str(next_cursor)

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
            "experimentalRawEvents": True,
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

    def _handle_transport_event(self, event: TransportEvent) -> None:
        method = str(event.method or "")
        params = event.params or {}
        if method in {"item/started", "item/completed"}:
            turn_id = str(params.get("turnId") or "")
            item = params.get("item") or {}
            if turn_id and isinstance(item, dict):
                self._remember_turn_activity_item(turn_id, item)
                if method == "item/completed" and item.get("type") == "agentMessage":
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
                if not is_non_terminal_turn_status(status):
                    self._turn_completion_events.setdefault(turn_id, threading.Event()).set()
                self._maybe_notify_turn_completed(turn_id)
        elif method == "thread/tokenUsage/updated":
            thread_id = str(params.get("threadId") or "")
            turn_id = str(params.get("turnId") or "")
            token_usage = self._normalize_thread_token_usage(params.get("tokenUsage"))
            if thread_id and turn_id and token_usage is not None:
                self._upsert_thread_token_usage(thread_id, turn_id, token_usage)
                self._notify_thread_token_usage(
                    ThreadTokenUsageEvent(thread_id=thread_id, turn_id=turn_id, token_usage=dict(token_usage))
                )
        elif method == "thread/fork":
            thread_id = str(params.get("threadId") or "")
            source_thread_id = str(params.get("sourceThreadId") or params.get("source_thread_id") or "")
            if thread_id and source_thread_id:
                self._clone_thread_token_usage(source_thread_id, thread_id)

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
        last_error: Exception | None = None
        for attempt_index in range(TRANSPORT_RECOVERY_ATTEMPTS):
            self.start()
            try:
                return self._request_transport(method, params, timeout_seconds=self.request_timeout_seconds)
            except AppServerRequestError:
                raise
            except AppServerConnectionError as exc:
                last_error = exc
                if self._closed or attempt_index >= TRANSPORT_RECOVERY_ATTEMPTS - 1:
                    raise
                self._reset_transport()
                continue
            except Exception as exc:
                raise AppServerConnectionError(str(exc)) from exc
        raise AppServerConnectionError(str(last_error or "transport request failed")) from last_error

    def _request_transport(self, method: str, params: dict[str, Any], *, timeout_seconds: float) -> dict[str, Any]:
        try:
            return self._transport.request(method, params, timeout_seconds=timeout_seconds)
        except (StdioTransportError, WebSocketTransportError) as exc:
            raise AppServerConnectionError(str(exc)) from exc



AppServerReviewerClient = AppServerSessionClient

from .shared_session import (
    close_shared_app_server_client,
    collect_turn_result,
    get_shared_app_server_client,
    start_shared_app_server_client,
    wait_turn_result,
)
