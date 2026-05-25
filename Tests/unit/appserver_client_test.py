from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Infrastructure" / "AgentRuntime"))

from agent_runtime.appserver.client import AppServerSessionClient
from agent_runtime.appserver.transport_ws import WebSocketTransportError


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


if __name__ == "__main__":
    unittest.main()
