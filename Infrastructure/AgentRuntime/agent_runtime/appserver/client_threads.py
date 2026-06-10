from __future__ import annotations

import time
from typing import Any

from .events import ThreadLifecycleEvent


THREAD_READ_AFTER_START_RETRY_SECONDS = 30.0
THREAD_READ_AFTER_START_RETRY_INITIAL_DELAY_SECONDS = 0.2
THREAD_READ_AFTER_START_RETRY_MAX_DELAY_SECONDS = 1.0


class AppServerClientThreadMixin:
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

    def _read_thread_after_start(self, thread_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + THREAD_READ_AFTER_START_RETRY_SECONDS
        delay_seconds = THREAD_READ_AFTER_START_RETRY_INITIAL_DELAY_SECONDS
        while True:
            try:
                return self.read_thread(thread_id, include_turns=False)
            except Exception as exc:
                if not self._is_transient_thread_read_after_start_error(exc):
                    raise
                remaining_seconds = deadline - time.monotonic()
                if remaining_seconds <= 0:
                    raise
                time.sleep(min(delay_seconds, remaining_seconds))
                delay_seconds = min(
                    delay_seconds * 2,
                    THREAD_READ_AFTER_START_RETRY_MAX_DELAY_SECONDS,
                )

    @staticmethod
    def _is_transient_thread_read_after_start_error(exc: Exception) -> bool:
        message = str(exc).strip().lower()
        if "failed to read thread" not in message:
            return False
        return "is empty" in message or "thread-store internal error" in message or "rollout" in message

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
        result = self._request(
            "thread/compact/start",
            {
                "threadId": str(thread_id),
            },
        )
        compact_thread_id = str(result.get("threadId") or result.get("thread_id") or thread_id)
        if compact_thread_id:
            self._notify_thread_lifecycle(
                ThreadLifecycleEvent(
                    event_type="thread/compact",
                    thread_id=compact_thread_id,
                    source_thread_id=str(thread_id),
                )
            )
        return result

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
