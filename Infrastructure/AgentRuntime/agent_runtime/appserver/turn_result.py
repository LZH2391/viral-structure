from __future__ import annotations

import threading
from typing import Any, Mapping

from .events import (
    ThreadLifecycleEvent,
    ThreadTokenUsageEvent,
    TurnActivitySnapshot,
    TurnCompletedEvent,
    TurnRunResult,
    is_non_terminal_turn_status,
)
from .transport_base import TransportEvent


class AppServerTurnResultMixin:
    def collect_turn_result(
        self,
        *,
        thread_id: str,
        turn_id: str,
        return_thread_state: bool = False,
    ) -> TurnRunResult:
        cached_status = self._turn_statuses.get(turn_id)
        if cached_status is None or is_non_terminal_turn_status(cached_status):
            self._sync_turn_state_from_thread(thread_id, turn_id)
        status = self._turn_statuses.get(turn_id, "running")
        final_message = None if is_non_terminal_turn_status(status) else self.get_final_agent_message(thread_id, turn_id)
        active_thread_message = self._turn_active_thread_messages.get(turn_id) if is_non_terminal_turn_status(status) else None
        if not is_non_terminal_turn_status(status):
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
                or not is_non_terminal_turn_status(str(turn.get("status") or "running"))
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
            if is_non_terminal_turn_status(status):
                raise
        final_message = self.get_final_agent_message(thread_id, turn_id)
        active_thread_message = self._turn_active_thread_messages.get(turn_id) if is_non_terminal_turn_status(status) else None
        if not is_non_terminal_turn_status(status):
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
                if not is_non_terminal_turn_status(status):
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
        if not status or is_non_terminal_turn_status(status):
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
            if not is_non_terminal_turn_status(status):
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

    @classmethod
    def _extract_turn_active_thread_message(cls, turn: Mapping[str, Any], *, status: str | None = None) -> str | None:
        final_message = cls._extract_turn_final_message(turn) if not is_non_terminal_turn_status(status) else None
        for item in reversed(list(turn.get("items", []))):
            if not isinstance(item, Mapping):
                continue
            item_type = str(item.get("type") or "").strip()
            role = str(item.get("role") or item.get("author") or "").strip().lower()
            if item_type not in {"agentMessage", "assistantMessage", "assistant_message", "message"} and role not in {"assistant", "agent", "thread"}:
                continue
            candidate = cls._extract_text_from_item(item)
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

