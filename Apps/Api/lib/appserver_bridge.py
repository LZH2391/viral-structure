from __future__ import annotations

import json
import sys
from pathlib import Path


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
    cep_root = Path(payload["cepRoot"]).resolve()
    sys.path.insert(0, str(cep_root))

    from ae_workspace_core.appserver.client import AppServerSessionClient  # noqa: WPS433

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
        if operation == "runTurnWithInputs":
            return run_turn_with_inputs(client, payload)
        sys.stdout.write(json.dumps({"ok": False, "error": "unknown_operation", "message": f"Unknown operation: {operation}"}, ensure_ascii=False))
        return 1
    finally:
        client.close()


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
    sys.stdout.write(
        json.dumps(
            {
                "ok": True,
                "threadId": str(payload["threadId"]),
                "turnId": turn_id,
                "status": "submitted",
            },
            ensure_ascii=False,
        )
    )
    return 0


def collect_turn_result(client, payload) -> int:
    try:
        sys.stdout.write(
            json.dumps(
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
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as error:  # noqa: WPS430
        message = str(error)
        running_markers = ("not completed", "running", "in_progress", "pending")
        if any(marker in message.lower() for marker in running_markers):
            sys.stdout.write(
                json.dumps(
                    {
                        "ok": False,
                        "threadId": str(payload["threadId"]),
                        "turnId": str(payload["turnId"]),
                        "status": "running",
                        "finalMessage": "",
                        "message": message[:240],
                    },
                    ensure_ascii=False,
                )
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
    sys.stdout.write(
        json.dumps(
            {
                "ok": status == "completed" and result.status == "completed",
                "threadId": result.thread_id,
                "turnId": result.turn_id,
                "status": result.status,
                "finalMessage": result.final_message,
            },
            ensure_ascii=False,
        )
    )
    return 0


def result_status_is_completed(result) -> bool:
    return result.status == "completed"


if __name__ == "__main__":
    raise SystemExit(main())
