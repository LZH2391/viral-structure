from pathlib import Path
import json
import tempfile
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Infrastructure" / "AgentRuntime"))

from agent_runtime.appserver.client import AppServerSessionClient
from agent_runtime.appserver.transport_ws import WebSocketTransportError
from agent_runtime.appserver.transport_base import TransportEvent


class FlakyStartTransport:
    def __init__(self, *, fail_start: bool = False, fail_request: bool = False) -> None:
        self.fail_start = fail_start
        self.fail_request = fail_request
        self.starts = 0
        self.requests = 0
        self.handler = None
        self.tool_handler = None

    def set_event_handler(self, handler) -> None:
        self.handler = handler

    def set_tool_call_handler(self, handler) -> None:
        self.tool_handler = handler

    def start(self) -> None:
        self.starts += 1
        if self.fail_start:
            raise WebSocketTransportError("transport is closed")

    def close(self) -> None:
        return None

    def request(self, method: str, params: dict, *, timeout_seconds: float) -> dict:
        self.requests += 1
        if self.fail_request:
            raise WebSocketTransportError("transport is closed")
        return {"userAgent": "test"} if method == "initialize" else {}

    def notify(self, method: str, params: dict) -> None:
        return None


class AppServerClientTests(unittest.TestCase):
    def test_start_rebuilds_transport_after_closed_starts(self) -> None:
        transports: list[FlakyStartTransport] = []

        class TestClient(AppServerSessionClient):
            def _build_transport(self):
                transport = FlakyStartTransport(fail_start=(len(transports) < 2))
                transports.append(transport)
                return transport

        client = TestClient(Path(__file__).resolve().parents[2], transport_mode="ws")

        client.start()

        self.assertEqual(len(transports), 3)
        self.assertEqual(transports[0].starts, 1)
        self.assertEqual(transports[1].starts, 1)
        self.assertEqual(transports[2].starts, 1)

    def test_request_rebuilds_transport_after_closed_requests(self) -> None:
        transports: list[FlakyStartTransport] = []

        class TestClient(AppServerSessionClient):
            def _build_transport(self):
                transport = FlakyStartTransport(fail_request=(len(transports) < 2))
                transports.append(transport)
                return transport

        client = TestClient(Path(__file__).resolve().parents[2], transport_mode="ws")
        client._initialized = True

        result = client._request("thread/read", {"threadId": "thread_1"})

        self.assertEqual(result, {})
        self.assertEqual(len(transports), 3)
        self.assertEqual(transports[0].requests, 1)
        self.assertEqual(transports[1].requests, 1)
        self.assertEqual(transports[2].requests, 2)

    def test_token_usage_is_persisted_and_cloned_for_forked_threads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace_root = Path(tmp)

            class TestClient(AppServerSessionClient):
                def _build_transport(self):
                    return FlakyStartTransport()

            client = TestClient(workspace_root, transport_mode="ws")
            client._initialized = True
            client._handle_transport_event(
                TransportEvent(
                    method="thread/tokenUsage/updated",
                    params={
                        "threadId": "thread_seed",
                        "turnId": "turn_1",
                        "tokenUsage": {
                            "last": {
                                "input_tokens": 123,
                                "output_tokens": 45,
                                "total_tokens": 168,
                            },
                            "modelContextWindow": 258400,
                        },
                    },
                )
            )

            persisted = json.loads((workspace_root / "_workspace" / "runtime" / "appserver" / "thread_token_usage.json").read_text(encoding="utf-8"))
            self.assertEqual(persisted["thread_seed"]["latest"]["last_token_usage"]["input_tokens"], 123)
            self.assertEqual(persisted["thread_seed"]["latest"]["model_context_window"], 258400)

            client._clone_thread_token_usage("thread_seed", "thread_fork")
            forked = client._load_thread_token_usage()
            self.assertEqual(forked["thread_fork"]["latest"]["last_token_usage"]["input_tokens"], 123)
            self.assertEqual(forked["thread_fork"]["turns"]["turn_1"]["last_token_usage"]["total_tokens"], 168)
            self.assertEqual(forked["thread_fork"]["latest"]["model_context_window"], 258400)

    def test_read_thread_merges_cached_token_usage_when_include_turns_is_true(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace_root = Path(tmp)
            appserver_runtime = workspace_root / "_workspace" / "runtime" / "appserver"
            appserver_runtime.mkdir(parents=True, exist_ok=True)
            (appserver_runtime / "thread_token_usage.json").write_text(
                json.dumps(
                    {
                        "thread_seed": {
                            "turns": {
                                "turn_1": {
                                    "last_token_usage": {
                                        "input_tokens": 222,
                                        "output_tokens": 33,
                                        "total_tokens": 255,
                                    }
                                }
                            },
                            "latest": {
                                "last_token_usage": {
                                    "input_tokens": 222,
                                    "output_tokens": 33,
                                    "total_tokens": 255,
                                }
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )

            class TestClient(AppServerSessionClient):
                def _build_transport(self):
                    return FlakyStartTransport()

                def _request(self, method: str, params: dict) -> dict:
                    if method == "thread/read":
                        return {
                            "thread": {
                                "id": "thread_seed",
                                "turns": [
                                    {
                                        "id": "turn_1",
                                        "last_token_usage": None,
                                    }
                                ],
                            }
                        }
                    return super()._request(method, params)

            client = TestClient(workspace_root, transport_mode="ws")
            client._initialized = True

            thread = client.read_thread("thread_seed", include_turns=True)

            self.assertEqual(thread["turns"][0]["last_token_usage"]["input_tokens"], 222)

    def test_list_turn_items_uses_official_turn_items_endpoint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace_root = Path(tmp)
            requests: list[tuple[str, dict]] = []

            class TestClient(AppServerSessionClient):
                def _build_transport(self):
                    return FlakyStartTransport()

                def _request(self, method: str, params: dict) -> dict:
                    requests.append((method, dict(params)))
                    if method == "thread/turns/items/list":
                        return {
                            "data": [
                                {"id": "u1", "type": "userMessage", "text": "开始"},
                                {"id": "cmd1", "type": "commandExecution", "command": "Get-Content manifest.json"},
                            ],
                            "nextCursor": None,
                            "backwardsCursor": "cursor_1",
                        }
                    return super()._request(method, params)

            client = TestClient(workspace_root, transport_mode="ws")
            client._initialized = True

            result = client.list_turn_items("thread_1", "turn_1", limit=50)

            self.assertEqual(requests[0][0], "thread/turns/items/list")
            self.assertEqual(requests[0][1]["threadId"], "thread_1")
            self.assertEqual(requests[0][1]["turnId"], "turn_1")
            self.assertEqual(requests[0][1]["limit"], 50)
            self.assertEqual(requests[0][1]["sortDirection"], "asc")
            self.assertEqual(len(result["data"]), 2)
            self.assertEqual(result["backwardsCursor"], "cursor_1")

    def test_inspect_turn_activity_uses_v2_items_from_thread_read_and_events(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace_root = Path(tmp)

            class TestClient(AppServerSessionClient):
                def _build_transport(self):
                    return FlakyStartTransport()

                def read_thread(self, thread_id: str, include_turns: bool = False) -> dict:
                    return {
                        "id": thread_id,
                        "turns": [
                            {
                                "id": "turn_1",
                                "status": "inProgress",
                                "items": [
                                    {"id": "u1", "type": "userMessage", "content": [{"type": "text", "text": "开始"}]},
                                    {"id": "r1", "type": "reasoning", "summary": ["看输入"]},
                                    {
                                        "id": "cmd1",
                                        "type": "commandExecution",
                                        "command": "Get-Content manifest.json",
                                        "status": "completed",
                                        "exitCode": 0,
                                    },
                                ],
                            }
                        ],
                    }

            client = TestClient(workspace_root, transport_mode="ws")
            client._initialized = True
            client._handle_transport_event(
                TransportEvent(
                    method="item/started",
                    params={
                        "threadId": "thread_1",
                        "turnId": "turn_1",
                        "item": {
                            "id": "mcp1",
                            "type": "mcpToolCall",
                            "server": "obsidian",
                            "tool": "read",
                            "status": "running",
                        },
                    },
                )
            )

            activity = client.inspect_turn_activity("thread_1", "turn_1")

            self.assertEqual(activity.item_count, 4)
            self.assertEqual(activity.effective_item_count, 3)
            self.assertEqual(activity.latest_item_type, "mcp_tool_call")
            self.assertEqual(activity.latest_tool_name, "obsidian.read")


if __name__ == "__main__":
    unittest.main()
