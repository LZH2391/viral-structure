from __future__ import annotations

import json
from pathlib import Path
from urllib import error, request


class ThreadPoolClientError(RuntimeError):
    pass


class ThreadPoolHttpClient:
    def __init__(self, base_url: str, *, timeout_seconds: float = 90.0) -> None:
        self.base_url = str(base_url).rstrip("/")
        self.timeout_seconds = float(timeout_seconds)

    def acquire(self, role: str, owner_id: str) -> dict:
        return self._request_json(
            "POST",
            "/leases/acquire",
            {"role": role, "owner_id": owner_id},
        )

    def touch(self, lease_id: str, owner_id: str) -> dict:
        return self._request_json(
            "POST",
            f"/leases/{lease_id}/touch",
            {"owner_id": owner_id},
        )

    def release(self, lease_id: str, owner_id: str) -> dict:
        return self._request_json(
            "POST",
            f"/leases/{lease_id}/release",
            {"owner_id": owner_id},
        )

    def release_owner_leases(self, owner_id: str) -> dict:
        return self._request_json(
            "POST",
            "/leases/release-owner",
            {"owner_id": owner_id},
        )

    def discard_thread(self, thread_id: str, reason: str) -> dict:
        return self._request_json(
            "POST",
            f"/threads/{thread_id}/discard",
            {"reason": reason},
        )

    def force_update_seeds(self, reason: str, roles: list[str] | None = None) -> dict:
        return self._request_json(
            "POST",
            "/maintenance/force-update-seeds",
            {"reason": reason, "roles": roles},
        )

    def role_status(self, role: str) -> dict:
        return self._request_json("GET", f"/roles/{role}/status")

    def _request_json(self, method: str, path: str, payload: dict | None = None) -> dict:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = request.Request(
            url=self.base_url + path,
            method=method.upper(),
            data=body,
            headers={"Content-Type": "application/json"},
        )
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ThreadPoolClientError(f"{method} {path} failed: {exc.code} {detail}") from exc
        except TimeoutError as exc:
            raise ThreadPoolClientError(
                f"{method} {path} timed out after {self.timeout_seconds:g}s"
            ) from exc
        except error.URLError as exc:
            raise ThreadPoolClientError(f"{method} {path} failed: {exc}") from exc
        if not raw.strip():
            return {}
        return json.loads(raw)
