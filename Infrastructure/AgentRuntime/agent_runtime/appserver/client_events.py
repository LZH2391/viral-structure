from __future__ import annotations

import threading
from typing import Any, Callable, Mapping

from .events import ThreadLifecycleEvent, ThreadTokenUsageEvent, TurnCompletedEvent, is_non_terminal_turn_status


class AppServerClientEventMixin:
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

    def _handle_transport_event(self, event) -> None:
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
        elif method in {"event_msg", "response_item"}:
            self._handle_raw_rollout_event(method, params)
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

    def _handle_raw_rollout_event(self, method: str, params: Mapping[str, Any]) -> None:
        payload = params.get("payload") if isinstance(params, Mapping) else None
        if not isinstance(payload, Mapping):
            payload = params
        payload_type = str(payload.get("type") or "")
        raw_turn_id = str(payload.get("turn_id") or payload.get("turnId") or params.get("turn_id") or params.get("turnId") or "")
        if raw_turn_id:
            self._latest_raw_rollout_turn_id = raw_turn_id
        if method == "event_msg" and payload_type == "task_started":
            turn_id = raw_turn_id
            if not turn_id:
                return
            self._turn_statuses[turn_id] = "running"
            model_context_window = payload.get("model_context_window") or payload.get("modelContextWindow")
            if model_context_window is not None:
                self._remember_turn_activity_item(turn_id, {
                    "id": f"raw_task_started_{turn_id}",
                    "type": "tokenUsage",
                    "model_context_window": model_context_window,
                })
            return
        if method == "event_msg" and payload_type == "token_count":
            turn_id = raw_turn_id or self._latest_raw_rollout_turn_id or ""
            if not turn_id:
                return
            info = payload.get("info") if isinstance(payload.get("info"), Mapping) else {}
            token_usage = self._normalize_thread_token_usage({
                "last": info.get("last_token_usage") or info.get("lastTokenUsage"),
                "total": info.get("total_token_usage") or info.get("totalTokenUsage"),
                "modelContextWindow": info.get("model_context_window") or info.get("modelContextWindow"),
            })
            if token_usage is None:
                return
            self._remember_turn_activity_item(turn_id, {
                "id": f"raw_token_count_{turn_id}_{len(self._turn_activity_items.get(turn_id, []))}",
                "type": "tokenUsage",
                "last_token_usage": token_usage.get("last_token_usage"),
                "total_token_usage": token_usage.get("total_token_usage"),
                "model_context_window": token_usage.get("model_context_window"),
            })
            thread_id = self._turn_thread_ids.get(turn_id)
            if thread_id:
                self._upsert_thread_token_usage(thread_id, turn_id, token_usage)
                self._notify_thread_token_usage(
                    ThreadTokenUsageEvent(thread_id=thread_id, turn_id=turn_id, token_usage=dict(token_usage))
                )
            return
        if method == "event_msg" and payload_type == "context_compacted":
            turn_id = raw_turn_id or self._latest_raw_rollout_turn_id or ""
            if turn_id:
                self._remember_turn_activity_item(turn_id, {
                    "id": f"raw_context_compacted_{turn_id}_{len(self._turn_activity_items.get(turn_id, []))}",
                    "type": "contextCompacted",
                    "text": "Context compacted",
                })
            return
        if method == "response_item" and payload_type == "message":
            turn_id = raw_turn_id or self._latest_raw_rollout_turn_id or ""
            if not turn_id:
                return
            role = str(payload.get("role") or "").lower()
            if role and role not in {"assistant", "agent"}:
                return
            text = self._extract_text_from_item(payload)
            if text:
                self._turn_final_messages[turn_id] = text
                self._remember_turn_activity_item(turn_id, {
                    "id": str(payload.get("id") or f"raw_message_{turn_id}"),
                    "type": "agentMessage",
                    "text": text,
                    "role": "assistant",
                })
                self._maybe_notify_turn_completed(turn_id)
            return
        if method == "response_item" and payload_type in {"function_call", "custom_tool_call"}:
            turn_id = raw_turn_id or self._latest_raw_rollout_turn_id or ""
            if not turn_id:
                return
            self._remember_turn_activity_item(turn_id, {
                "id": str(payload.get("id") or payload.get("call_id") or f"raw_tool_call_{turn_id}"),
                "type": "toolCall",
                "toolName": str(payload.get("name") or ""),
                "arguments": payload.get("arguments") or payload.get("input"),
                "callId": payload.get("call_id") or payload.get("callId"),
            })
            return
        if method == "response_item" and payload_type in {"function_call_output", "custom_tool_call_output"}:
            turn_id = raw_turn_id or self._latest_raw_rollout_turn_id or ""
            if not turn_id:
                return
            self._remember_turn_activity_item(turn_id, {
                "id": str(payload.get("id") or payload.get("call_id") or f"raw_tool_result_{turn_id}"),
                "type": "toolResult",
                "output": payload.get("output"),
                "callId": payload.get("call_id") or payload.get("callId"),
            })
            return
        if method == "event_msg" and payload_type == "task_complete":
            turn_id = raw_turn_id
            if not turn_id:
                return
            self._turn_statuses[turn_id] = "completed"
            self._turn_errors[turn_id] = None
            self._turn_completion_events.setdefault(turn_id, threading.Event()).set()
            self._maybe_notify_turn_completed(turn_id)
