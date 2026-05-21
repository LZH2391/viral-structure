from __future__ import annotations

import json
import sys
from pathlib import Path


def write_json(payload) -> None:
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def sanitize_for_appserver_text(value):
    if isinstance(value, str):
        return "".join(ch for ch in value if not 0xD800 <= ord(ch) <= 0xDFFF)
    if isinstance(value, list):
        return [sanitize_for_appserver_text(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_for_appserver_text(item) for key, item in value.items()}
    return value


def main() -> int:
    payload = sanitize_for_appserver_text(load_stdin_json())
    operation = payload.get("operation") or "runTurnWithInputs"
    install_runtime_paths(payload)

    from agent_runtime.appserver.client import AppServerSessionClient  # noqa: WPS433

    client = AppServerSessionClient(
        payload["workspaceRoot"],
        transport_mode="ws",
        transport_url=payload.get("transportUrl") or "ws://127.0.0.1:8146",
        request_timeout_seconds=30.0,
        turn_timeout_seconds=float(payload.get("timeoutSeconds") or 180),
        init_timeout_seconds=90.0,
    )
    client.start()
    try:
        if operation == "startTurnWithInputs":
            return start_turn_with_inputs(client, payload)
        if operation == "collectTurnResult":
            return collect_turn_result(client, payload)
        if operation == "readThread":
            return read_thread(client, payload)
        if operation == "runTurnWithInputs":
            return run_turn_with_inputs(client, payload)
        write_json({"ok": False, "error": "unknown_operation", "message": f"Unknown operation: {operation}"})
        return 1
    finally:
        client.close()


def install_runtime_paths(payload) -> None:
    python_runtime_root = payload.get("pythonRuntimeRoot")
    if python_runtime_root:
        runtime_root = Path(str(python_runtime_root)).resolve()
        if runtime_root.exists():
            sys.path.insert(0, str(runtime_root))
            return

    local_runtime_root = Path(__file__).resolve().parents[2] / "Infrastructure" / "AgentRuntime"
    if local_runtime_root.exists():
        sys.path.insert(0, str(local_runtime_root))
        return


def load_stdin_json():
    raw = sys.stdin.buffer.read()
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def start_turn_with_inputs(client, payload) -> int:
    turn_id = client.start_turn_with_inputs(
        str(payload["threadId"]),
        list(payload.get("inputs") or []),
        skill_path=payload.get("skillPath") or None,
        cwd=payload["workspaceRoot"],
    )
    write_json(
        {
            "ok": True,
            "threadId": str(payload["threadId"]),
            "turnId": turn_id,
            "status": "submitted",
        }
    )
    return 0


def collect_turn_result(client, payload) -> int:
    try:
        write_json(
            {
                "ok": result_status_is_completed(result := client.collect_turn_result(
                    thread_id=str(payload["threadId"]),
                    turn_id=str(payload["turnId"]),
                    return_thread_state=False,
                )),
                "threadId": result.thread_id,
                "turnId": result.turn_id,
                "status": result.status,
                "finalMessage": result.final_message,
            }
        )
        return 0
    except Exception as error:  # noqa: WPS430
        message = str(error)
        running_markers = ("not completed", "running", "in_progress", "pending")
        if any(marker in message.lower() for marker in running_markers):
            write_json(
                {
                    "ok": False,
                    "threadId": str(payload["threadId"]),
                    "turnId": str(payload["turnId"]),
                    "status": "running",
                    "finalMessage": "",
                    "message": message[:240],
                }
            )
            return 0
        raise


def run_turn_with_inputs(client, payload) -> int:
    turn_id = client.start_turn_with_inputs(
        str(payload["threadId"]),
        list(payload.get("inputs") or []),
        skill_path=payload.get("skillPath") or None,
        cwd=payload["workspaceRoot"],
    )
    status = client.wait_turn_completed(
        str(payload["threadId"]),
        turn_id,
        timeout_seconds=float(payload.get("timeoutSeconds") or 180),
    )
    result = client.collect_turn_result(
        thread_id=str(payload["threadId"]),
        turn_id=turn_id,
        return_thread_state=False,
    )
    write_json(
        {
            "ok": status == "completed" and result.status == "completed",
            "threadId": result.thread_id,
            "turnId": result.turn_id,
            "status": result.status,
            "finalMessage": result.final_message,
        }
    )
    return 0


def read_thread(client, payload) -> int:
    thread = client.read_thread(str(payload["threadId"]), include_turns=True)
    write_json(
        {
            "ok": True,
            "thread": thread,
        }
    )
    return 0


def result_status_is_completed(result) -> bool:
    return result.status == "completed"


if __name__ == "__main__":
    raise SystemExit(main())
