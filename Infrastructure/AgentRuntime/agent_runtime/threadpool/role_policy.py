from __future__ import annotations

from datetime import datetime
import hashlib
import json
from pathlib import Path

from .models import LeaseRecord, RoleConfig, ThreadRecord

ROLE_STATUS_CACHE_SECONDS = 0.75


def _now() -> str:
    return datetime.now().astimezone().isoformat()


def role_can_acquire(
    *,
    ok: bool,
    ready_for_leases: bool,
    recovering: bool,
    warming: bool,
    startup_error: str | None,
    warmup_error: str | None,
    counts: dict[str, int],
    min_idle: int,
) -> bool:
    idle = int(counts.get("idle") or 0)
    return bool(
        ok
        and ready_for_leases
        and not recovering
        and not warming
        and not startup_error
        and not warmup_error
        and idle >= int(min_idle)
    )


class ThreadPoolRolePolicyMixin:
    def _require_role(self, role_name: str) -> RoleConfig:
        role = self.roles.get(str(role_name).strip())
        if role is None:
            raise ValueError(f"unknown role: {role_name}")
        return role

    def _require_ready_for_leases(self) -> None:
        if self._ready_for_leases:
            return
        if self._startup_error:
            raise RuntimeError(f"thread pool startup failed: {self._startup_error}")
        if self._recovering:
            raise RuntimeError("thread pool is still recovering persisted state; retry shortly")
        raise RuntimeError("thread pool is not ready for leases")

    def _require_active_lease(self, lease_id: str) -> LeaseRecord:
        lease = self.store.read_lease(lease_id)
        if lease is None or lease.status != "active":
            raise ValueError(f"unknown active lease: {lease_id}")
        return lease

    def _role_status_from_catalog(self, config: RoleConfig) -> dict:
        catalog = self.store.read_catalog()
        role_entries = catalog.get("roles", {}) if isinstance(catalog.get("roles"), dict) else {}
        role_entry = role_entries.get(config.name) if isinstance(role_entries, dict) else None
        if not isinstance(role_entry, dict):
            role_entry = {}
        counts = dict(role_entry.get("counts") or {})
        seed = self._find_seed_thread(config.name)
        warming = self._role_is_warming(config)
        replenishing = False
        warmup_error = self._warmup_errors.get(config.name)
        warmup_detail = (
            f"waiting for seed initialization: {seed.thread_id}"
            if warming and seed is not None and seed.status == "initializing"
            else self._warmup_details.get(config.name)
        )
        can_acquire = role_can_acquire(
            ok=True,
            ready_for_leases=self._ready_for_leases,
            recovering=self._recovering,
            warming=warming,
            startup_error=self._startup_error,
            warmup_error=warmup_error,
            counts=counts,
            min_idle=config.min_idle,
        )
        return {
            "ok": True,
            "role": config.name,
            "min_idle": config.min_idle,
            "profile_path": config.profile_path,
            "profile_version": config.profile_version,
            "skill_path": config.skill_path,
            "current_init_fingerprint": self._role_init_fingerprint(config),
            "counts": counts,
            "seed_thread_id": role_entry.get("seed_thread_id"),
            "seed_init_fingerprint": role_entry.get("seed_init_fingerprint"),
            "recovering": self._recovering,
            "ready_for_leases": self._ready_for_leases,
            "startup_error": self._startup_error,
            "warming": warming,
            "replenishing": replenishing,
            "warmup_error": warmup_error,
            "warmup_detail": warmup_detail,
            "can_init": can_acquire,
            "can_acquire": can_acquire,
            "active_lease_ids": list(role_entry.get("active_lease_ids") or []),
            "active_leases": [dict(item) for item in role_entry.get("active_leases") or [] if isinstance(item, dict)],
            "thread_entries": [dict(item) for item in role_entry.get("thread_entries") or [] if isinstance(item, dict)],
            "reported_at": _now(),
        }

    def _role_init_fingerprint(self, config: RoleConfig) -> str:
        payload = {
            "profile_version": config.profile_version,
            "init_template_hash": config.init_template_hash,
            "init_ready_text": config.init_ready_text,
            "skill_path": config.skill_path,
            "skill_body_sha256": self._skill_body_sha256(config.skill_path),
        }
        serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

    def _initializing_seed_roles(self) -> set[str]:
        return {
            thread.role
            for thread in self.store.list_threads().values()
            if thread.is_seed and thread.status == "initializing"
        }

    def _role_is_warming(self, config: RoleConfig) -> bool:
        seed = self._find_seed_thread(config.name)
        return bool(config.name in self._warming_roles or (seed is not None and seed.status == "initializing"))

    def _role_has_initializing_seed(self, role_name: str) -> bool:
        seed = self._find_seed_thread(role_name)
        return seed is not None and seed.status == "initializing"

    @staticmethod
    def _skill_body_sha256(skill_path: str | None) -> str | None:
        if not skill_path:
            return None
        try:
            path = Path(skill_path).resolve()
            if not path.exists() or not path.is_file():
                return "missing"
            return hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            return "unreadable"

    def _matches_thread_fingerprint(self, thread: ThreadRecord, config: RoleConfig) -> bool:
        return thread.init_fingerprint == self._role_init_fingerprint(config)
