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
    payload = sanitize_for_appserver_text(json.loads(sys.stdin.read() or "{}"))
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
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
