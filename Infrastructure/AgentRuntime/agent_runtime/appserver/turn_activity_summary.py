from __future__ import annotations

from typing import Any, Mapping


class AppServerTurnActivitySummaryMixin:
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
        if item_type in {
            "agentMessage",
            "assistantMessage",
            "plan",
            "reasoning",
            "commandExecution",
            "mcpToolCall",
            "dynamicToolCall",
            "fileChange",
            "webSearch",
            "toolCall",
            "toolResult",
            "tokenUsage",
            "contextCompacted",
        }:
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

    @classmethod
    def _summarize_latest_turn_activity_item(cls, items: Any) -> dict[str, str | None]:
        if not isinstance(items, list):
            return {}
        for item in reversed(items):
            if not cls._is_effective_activity_item(item):
                continue
            if not isinstance(item, Mapping):
                continue
            item_type = str(item.get("type") or item.get("kind") or "").strip()
            normalized = item_type.replace("_", "").lower()
            if normalized in {"agentmessage", "assistantmessage", "message"}:
                return {"kind": "agent_message", "preview": cls._safe_preview(cls._extract_text_from_item(item)), "tool_name": None}
            if normalized == "plan":
                return {"kind": "plan", "preview": cls._safe_preview(cls._extract_text_from_item(item)) or "Plan", "tool_name": None}
            if normalized == "reasoning":
                text = cls._extract_text_from_item(item)
                chars = len(text) if text else cls._safe_int(item.get("characters") or item.get("charCount") or item.get("length"))
                preview = f"Reasoning {chars} chars" if chars else "Reasoning"
                return {"kind": "reasoning", "preview": preview, "tool_name": None}
            if normalized == "commandexecution":
                command = item.get("command")
                exit_code = cls._safe_int(item.get("exitCode") or item.get("exit_code"))
                preview = cls._safe_preview(command) or cls._safe_preview(item.get("aggregatedOutput")) or (
                    f"exit {exit_code}" if exit_code is not None else "Command execution"
                )
                return {"kind": "command_execution", "preview": preview, "tool_name": "shell"}
            if normalized == "mcptoolcall":
                tool_name = cls._extract_tool_name(item)
                preview = cls._safe_preview(item.get("message")) or cls._safe_preview(cls._extract_text_from_item(item)) or (
                    f"MCP tool: {tool_name}" if tool_name else "MCP tool call"
                )
                return {"kind": "mcp_tool_call", "preview": preview, "tool_name": tool_name}
            if normalized == "dynamictoolcall":
                tool_name = cls._extract_tool_name(item)
                preview = cls._safe_preview(cls._extract_text_from_item(item)) or (
                    f"Dynamic tool: {tool_name}" if tool_name else "Dynamic tool call"
                )
                return {"kind": "dynamic_tool_call", "preview": preview, "tool_name": tool_name}
            if normalized == "filechange":
                changes = item.get("changes")
                change_count = len(changes) if isinstance(changes, list) else None
                preview = f"File changes: {change_count}" if change_count is not None else "File changes"
                return {"kind": "file_change", "preview": preview, "tool_name": None}
            if normalized == "websearch":
                return {"kind": "web_search", "preview": cls._safe_preview(item.get("query")) or "Web search", "tool_name": "web_search"}
            if normalized == "toolcall":
                tool_name = cls._extract_tool_name(item)
                command = cls._extract_tool_command(item)
                preview = cls._safe_preview(command) or (f"Tool call: {tool_name}" if tool_name else "Tool call")
                return {"kind": "tool_call", "preview": preview, "tool_name": tool_name}
            if normalized == "toolresult":
                tool_name = cls._extract_tool_name(item)
                text = cls._extract_text_from_item(item)
                exit_code = cls._safe_int(item.get("exitCode") or item.get("exit_code"))
                preview = cls._safe_preview(text) or (f"exit {exit_code}" if exit_code is not None else "Tool result")
                return {"kind": "tool_result", "preview": preview, "tool_name": tool_name}
            if normalized in {"tokenusage", "tokencount"}:
                return {"kind": "token_usage", "preview": "Token usage", "tool_name": None}
            if normalized in {"contextcompacted", "contextcompact"}:
                return {"kind": "context_compacted", "preview": "Context compacted", "tool_name": None}
            text = cls._extract_text_from_item(item)
            return {"kind": "unknown", "preview": cls._safe_preview(text) or (f"Item: {item_type}" if item_type else "Item"), "tool_name": cls._extract_tool_name(item)}
        return {}

    @staticmethod
    def _safe_preview(value: Any, max_length: int = 240) -> str | None:
        text = " ".join(str(value or "").split()).strip()
        if not text:
            return None
        return text if len(text) <= max_length else f"{text[:max_length]}..."

    @staticmethod
    def _safe_int(value: Any) -> int | None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _extract_tool_name(item: Mapping[str, Any]) -> str | None:
        metadata = item.get("metadata") if isinstance(item.get("metadata"), Mapping) else {}
        server = item.get("server")
        tool = item.get("tool")
        if server is not None and tool is not None:
            return f"{server}.{tool}"
        namespace = item.get("namespace")
        if namespace is not None and tool is not None:
            return f"{namespace}.{tool}"
        for key in ("toolName", "tool_name", "name", "tool"):
            value = item.get(key) or metadata.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return None

    @staticmethod
    def _extract_tool_command(item: Mapping[str, Any]) -> str | None:
        for payload_key in ("arguments", "args", "metadata"):
            payload = item.get(payload_key)
            if isinstance(payload, Mapping):
                command = payload.get("command")
                if command is not None and str(command).strip():
                    return str(command).strip()
        command = item.get("command")
        return str(command).strip() if command is not None and str(command).strip() else None
