from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable, Mapping


@dataclass(frozen=True)
class TransportEvent:
    method: str
    params: dict[str, Any]


EventHandler = Callable[[TransportEvent], None]
ToolCallHandler = Callable[[Mapping[str, Any]], dict[str, Any]]


class AppServerTransport(ABC):
    def __init__(self) -> None:
        self._event_handler: EventHandler | None = None
        self._tool_call_handler: ToolCallHandler | None = None

    def set_event_handler(self, handler: EventHandler) -> None:
        self._event_handler = handler

    def set_tool_call_handler(self, handler: ToolCallHandler) -> None:
        self._tool_call_handler = handler

    def _emit_event(self, method: str, params: Mapping[str, Any] | None = None) -> None:
        if self._event_handler is None:
            return
        self._event_handler(TransportEvent(method=method, params=dict(params or {})))

    def _handle_tool_call(self, params: Mapping[str, Any] | None = None) -> dict[str, Any]:
        if self._tool_call_handler is None:
            return {
                "contentItems": [{"type": "inputText", "text": "No tool call handler registered"}],
                "success": False,
            }
        return self._tool_call_handler(params or {})

    @abstractmethod
    def start(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def close(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def request(self, method: str, params: dict[str, Any], *, timeout_seconds: float) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def notify(self, method: str, params: dict[str, Any]) -> None:
        raise NotImplementedError
