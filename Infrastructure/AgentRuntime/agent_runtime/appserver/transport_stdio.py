from __future__ import annotations

import json
import queue
import subprocess
import threading
from collections import deque
from pathlib import Path
from typing import Any, Mapping, Sequence

from ..layout import build_codex_subprocess_env
from .transport_base import AppServerTransport


class StdioTransportError(RuntimeError):
    pass


class StdioTransport(AppServerTransport):
    def __init__(
        self,
        workspace_root: str | Path,
        *,
        codex_command: Sequence[str],
        base_env: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__()
        self.workspace_root = Path(workspace_root).resolve()
        self.codex_command = tuple(codex_command)
        self.base_env = dict(base_env or {})
        self._process: subprocess.Popen[str] | None = None
        self._stdout_thread: threading.Thread | None = None
        self._stderr_thread: threading.Thread | None = None
        self._send_lock = threading.Lock()
        self._state_lock = threading.RLock()
        self._pending_requests: dict[int, queue.Queue[dict[str, Any]]] = {}
        self._stderr_lines: deque[str] = deque(maxlen=200)
        self._process_exit_message: str | None = None
        self._next_request_id = 1
        self._closed = False

    def start(self) -> None:
        if self._closed:
            raise StdioTransportError("transport is closed")
        with self._state_lock:
            if self._process is not None and self._process.poll() is None:
                return
            env = build_codex_subprocess_env(self.workspace_root, base_env=self.base_env)
            process = subprocess.Popen(
                self.codex_command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(self.workspace_root),
                env=env,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
            if process.stdin is None or process.stdout is None or process.stderr is None:
                process.kill()
                raise StdioTransportError("failed to open stdio for app-server process")
            self._process = process
            self._process_exit_message = None
            self._stdout_thread = threading.Thread(target=self._stdout_loop, name="app-server-stdout", daemon=True)
            self._stderr_thread = threading.Thread(target=self._stderr_loop, name="app-server-stderr", daemon=True)
            self._stdout_thread.start()
            self._stderr_thread.start()

    def close(self) -> None:
        with self._state_lock:
            self._closed = True
            process = self._process
            self._process = None
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        self._fail_pending_requests("app-server transport closed")

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
                raise StdioTransportError(self._connection_error_message(f"timed out waiting for {method}")) from exc
            if "error" in payload:
                error = payload["error"]
                if isinstance(error, dict):
                    raise StdioTransportError(str(error.get("message") or f"request failed: {method}"))
                raise StdioTransportError(str(error))
            return dict(payload.get("result") or {})
        finally:
            self._pending_requests.pop(request_id, None)

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self.start()
        self._send_message({"method": method, "params": params})

    def _reserve_request_id(self) -> int:
        with self._state_lock:
            request_id = self._next_request_id
            self._next_request_id += 1
            return request_id

    def _send_message(self, payload: dict[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None or process.poll() is not None:
            raise StdioTransportError(self._connection_error_message("app-server process is not running"))
        message = json.dumps(payload, ensure_ascii=False) + "\n"
        with self._send_lock:
            process.stdin.write(message)
            process.stdin.flush()

    def _stdout_loop(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return
        try:
            for raw_line in process.stdout:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict) and "id" in payload and ("result" in payload or "error" in payload):
                    self._resolve_pending_request(int(payload["id"]), payload)
                    continue
                if isinstance(payload, dict) and payload.get("method") == "item/tool/call" and "id" in payload:
                    result = self._handle_tool_call(payload.get("params", {}))
                    self._send_message({"id": int(payload["id"]), "result": result})
                    continue
                if isinstance(payload, dict):
                    self._emit_event(str(payload.get("method") or ""), payload.get("params") or {})
        finally:
            self._process_exit_message = self._connection_error_message("app-server process exited")
            self._fail_pending_requests(self._process_exit_message)

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

    def _fail_pending_requests(self, message: str) -> None:
        pending = list(self._pending_requests.items())
        for request_id, response_queue in pending:
            try:
                response_queue.put_nowait({"error": {"message": message}})
            except queue.Full:
                pass
            self._pending_requests.pop(request_id, None)

    def _connection_error_message(self, prefix: str) -> str:
        stderr_text = "\n".join(self._stderr_lines).strip()
        if stderr_text:
            return f"{prefix}\n{stderr_text}"
        if self._process_exit_message:
            return self._process_exit_message
        return prefix
