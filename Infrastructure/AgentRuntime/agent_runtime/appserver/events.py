from __future__ import annotations

from dataclasses import dataclass
from typing import Any


NON_TERMINAL_TURN_STATUSES = {
    "created",
    "pending",
    "queued",
    "submitted",
    "running",
    "inprogress",
    "in_progress",
}


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
    latest_item_type: str | None = None
    latest_message_preview: str | None = None
    latest_tool_name: str | None = None


@dataclass(frozen=True)
class ThreadLifecycleEvent:
    event_type: str
    thread_id: str
    source_thread_id: str | None = None


def is_non_terminal_turn_status(status: str | None) -> bool:
    return str(status or "").strip().lower() in NON_TERMINAL_TURN_STATUSES
