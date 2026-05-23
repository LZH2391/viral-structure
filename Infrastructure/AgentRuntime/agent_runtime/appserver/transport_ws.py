from __future__ import annotations

import json
import queue
import socket
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Mapping, Sequence

from ..layout import build_codex_subprocess_env
from .transport_base import AppServerTransport


class WebSocketTransportError(RuntimeError):
    pass


class WebSocketTransport(AppServerTransport):
    def __init__(
        self,
        workspace_root: str | Path,
        *,
        codex_command: Sequence[str],
        base_env: Mapping[str, str] | None = None,
        url: str | None = None,
    ) -> None:
        super().__init__()
        self.workspace_root = Path(workspace_root).resolve()
        self.codex_command = tuple(codex_command)
        self.base_env = dict(base_env or {})
        self.url = url or self._allocate_url()
        self._owns_process = url is None
        self._process: subprocess.Popen[str] | None = None
        self._socket = None
        self._reader_thread: threading.Thread | None = None
        self._stderr_thread: threading.Thread | None = None
        self._state_lock = threading.RLock()
        self._send_lock = threading.Lock()
        self._pending_requests: dict[int, queue.Queue[dict[str, Any]]] = {}
        self._stderr_lines: deque[str] = deque(maxlen=200)
        self._process_exit_message: str | None = None
        self._tool_call_threads: set[threading.Thread] = set()
        self._next_request_id = 1
        self._closed = False

    def start(self) -> None:
        if self._closed:
            raise WebSocketTransportError("transport is closed")
        with self._state_lock:
            if self._socket is not None:
                return
            if self._owns_process:
                env = build_codex_subprocess_env(self.workspace_root, base_env=self.base_env)
                command = list(self.codex_command) + ["--listen", self.url]
                process = subprocess.Popen(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=str(self.workspace_root),
                    env=env,
                    text=True,
                    encoding="utf-8",
                    bufsize=1,
                )
                self._process = process
                self._stderr_thread = threading.Thread(target=self._stderr_loop, name="app-server-ws-stderr", daemon=True)
                self._stderr_thread.start()
            import websocket

            deadline = time.monotonic() + 5.0
            last_error: Exception | None = None
            while time.monotonic() < deadline:
                try:
                    self._socket = websocket.create_connection(self.url, timeout=15, suppress_origin=True)
                    self._process_exit_message = None
                    break
                except Exception as exc:
                    last_error = exc
                    time.sleep(0.1)
            if self._socket is None:
                self._close_process()
                raise WebSocketTransportError(
                    f"failed to connect websocket app-server at {self.url}: {last_error}"
                ) from last_error
            self._reader_thread = threading.Thread(target=self._reader_loop, name="app-server-ws-reader", daemon=True)
            self._reader_thread.start()

    def close(self) -> None:
        with self._state_lock:
            self._closed = True
            sock = self._socket
            self._socket = None
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass
        self._close_process()
        self._fail_pending_requests("app-server websocket transport closed")

    def request(self, method: str, params: dict[str, Any], *, timeout_seconds: float) -> dict[str, Any]:
        self.start()
        request_id = self._reserve_request_id()
        response_queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
        self._pending_requests[request_id] = response_queue
        try:
            self._send_message({"method": method, "id": request_id, "params": params})
            try:
                payload = response_queue.get(timeout=timeout_seconds)
            except queue.Empty as exc:
                raise WebSocketTransportError(self._connection_error_message(f"timed out waiting for {method}")) from exc
            if "error" in payload:
                error = payload["error"]
                if isinstance(error, dict):
                    raise WebSocketTransportError(str(error.get("message") or f"request failed: {method}"))
                raise WebSocketTransportError(str(error))
            return dict(payload.get("result") or {})
        finally:
            self._pending_requests.pop(request_id, None)

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self.start()
        self._send_message({"method": method, "params": params})

    def _allocate_url(self) -> str:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        return f"ws://127.0.0.1:{port}"

    def _reserve_request_id(self) -> int:
        with self._state_lock:
            request_id = self._next_request_id
            self._next_request_id += 1
            return request_id

    def _send_message(self, payload: dict[str, Any]) -> None:
        if self._socket is None:
            raise WebSocketTransportError(self._connection_error_message("app-server websocket is not connected"))
        message = json.dumps(payload, ensure_ascii=False)
        with self._send_lock:
            self._socket.send(message)

    def _reader_loop(self) -> None:
        sock = self._socket
        if sock is None:
            return
        try:
            while True:
                raw_message = sock.recv()
                if not raw_message:
                    break
                try:
                    payload = json.loads(raw_message)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict) and "id" in payload and ("result" in payload or "error" in payload):
                    self._resolve_pending_request(int(payload["id"]), payload)
                    continue
                if isinstance(payload, dict) and payload.get("method") == "item/tool/call" and "id" in payload:
                    self._dispatch_tool_call(int(payload["id"]), payload.get("params", {}))
                    continue
                if isinstance(payload, dict):
                    self._emit_event(str(payload.get("method") or ""), payload.get("params") or {})
        except Exception as exc:
            self._process_exit_message = self._connection_error_message(f"websocket app-server reader stopped: {exc}")
        finally:
            with self._state_lock:
                if self._socket is sock:
                    self._socket = None
            try:
                sock.close()
            except Exception:
                pass
            self._fail_pending_requests(self._connection_error_message("app-server websocket closed"))

    def _stderr_loop(self) -> None:
        process = self._process
        if process is None or process.stderr is None:
            return
        for raw_line in process.stderr:
            text = raw_line.rstrip()
            if text:
                self._stderr_lines.append(text)

    def _resolve_pending_request(self, request_id: int, payload: dict[str, Any]) -> None:
        response_queue = self._pending_requests.get(request_id)
        if response_queue is None:
            return
        try:
            response_queue.put_nowait(payload)
        except queue.Full:
            pass

    def _dispatch_tool_call(self, request_id: int, params: Mapping[str, Any] | None) -> None:
        worker = threading.Thread(
            target=self._tool_call_worker,
            args=(request_id, dict(params or {})),
            name=f"app-server-ws-tool-{request_id}",
            daemon=True,
        )
        with self._state_lock:
            self._tool_call_threads.add(worker)
        worker.start()

    def _tool_call_worker(self, request_id: int, params: Mapping[str, Any]) -> None:
        current = threading.current_thread()
        try:
            result = self._handle_tool_call(params)
            self._send_message({"id": request_id, "result": result})
        except Exception as exc:
            fallback = {
                "contentItems": [{"type": "inputText", "text": f"{type(exc).__name__}: {exc}"}],
                "success": False,
            }
            try:
                self._send_message({"id": request_id, "result": fallback})
            except Exception:
                self._process_exit_message = self._connection_error_message(f"tool call failed: {type(exc).__name__}: {exc}")
                return
        finally:
            with self._state_lock:
                self._tool_call_threads.discard(current)

    def _fail_pending_requests(self, message: str) -> None:
        pending = list(self._pending_requests.items())
        for request_id, response_queue in pending:
            try:
                response_queue.put_nowait({"error": {"message": message}})
            except queue.Full:
                pass
            self._pending_requests.pop(request_id, None)

    def _close_process(self) -> None:
        process = self._process
        self._process = None
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    def _connection_error_message(self, prefix: str) -> str:
        stderr_text = "\n".join(self._stderr_lines).strip()
        if stderr_text:
            return f"{prefix}\n{stderr_text}"
        if self._process_exit_message:
            return self._process_exit_message
        return prefix
