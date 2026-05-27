from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Any, Mapping


class AppServerToolHandlerMixin:

    def _handle_tool_call_request(self, params: Mapping[str, Any]) -> dict[str, Any]:
        tool_name = str(params.get("tool") or "")
        if tool_name == "shell_command":
            return self._run_shell_command(params.get("arguments"))
        return {
            "contentItems": [{"type": "inputText", "text": f"Unsupported tool: {tool_name}"}],
            "success": False,
        }

    def _run_shell_command(self, arguments: Any) -> dict[str, Any]:
        if not isinstance(arguments, Mapping):
            return self._tool_failure("shell_command arguments must be an object")
        command = str(arguments.get("command") or "").strip()
        if not command:
            return self._tool_failure("shell_command requires a non-empty command")
        workdir = Path(str(arguments.get("workdir") or self.workspace_root)).resolve()
        timeout_ms_raw = arguments.get("timeout_ms")
        timeout_seconds = self.tool_timeout_seconds
        if timeout_ms_raw is not None:
            try:
                timeout_seconds = max(float(timeout_ms_raw) / 1000.0, 0.1)
            except (TypeError, ValueError):
                timeout_seconds = self.request_timeout_seconds
        started_at = time.perf_counter()
        try:
            powershell_command = self._build_powershell_tool_command(command)
            completed = subprocess.run(
                ["powershell", "-NoProfile", "-Command", powershell_command],
                cwd=str(workdir),
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=timeout_seconds,
            )
            duration = time.perf_counter() - started_at
            output = (completed.stdout or "") + (completed.stderr or "")
            text = f"Exit code: {completed.returncode}\nWall time: {duration:.1f} seconds\nOutput:\n{output}"
            return {
                "contentItems": [{"type": "inputText", "text": text}],
                "success": completed.returncode == 0,
            }
        except subprocess.TimeoutExpired as exc:
            duration = time.perf_counter() - started_at
            output = ""
            if isinstance(exc.stdout, str):
                output += exc.stdout
            if isinstance(exc.stderr, str):
                output += exc.stderr
            text = f"Exit code: 124\nWall time: {duration:.1f} seconds\nOutput:\n{output}\nCommand timed out."
            return {
                "contentItems": [{"type": "inputText", "text": text}],
                "success": False,
            }
        except Exception as exc:  # pragma: no cover - defensive
            return self._tool_failure(f"{type(exc).__name__}: {exc}")

    @staticmethod
    def _build_powershell_tool_command(command: str) -> str:
        return "\n".join(
            [
                "$global:LASTEXITCODE = $null",
                command,
                "$__codexCommandSuccess = $?",
                "$__codexNativeExitCode = $global:LASTEXITCODE",
                "if ($null -ne $__codexNativeExitCode) { exit $__codexNativeExitCode }",
                "if ($__codexCommandSuccess) { exit 0 }",
                "exit 1",
            ]
        )

    @staticmethod
    def _tool_failure(message: str) -> dict[str, Any]:
        return {
            "contentItems": [{"type": "inputText", "text": message}],
            "success": False,
        }

