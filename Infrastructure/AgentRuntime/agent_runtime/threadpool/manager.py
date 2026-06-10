from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path
import threading
import time
from uuid import uuid4

from ..appserver.client import AppServerSessionClient
from ..storage import write_json
from .lease_store import ThreadPoolLeaseStoreMixin
from .manager_config import ThreadPoolManagerConfigMixin
from .models import LeaseRecord, RoleConfig, ThreadRecord
from .role_policy import ROLE_STATUS_CACHE_SECONDS, ThreadPoolRolePolicyMixin, role_can_acquire
from .seed_pool import SeedInitializationPending, ThreadPoolSeedPoolMixin
from .store import ThreadPoolStore


def _now() -> str:
    return datetime.now().astimezone().isoformat()


STARTUP_RECOVERY_STALE_SECONDS = 120.0
DEFAULT_WARMUP_CONCURRENCY_LIMIT = 5


class ThreadPoolManager(ThreadPoolManagerConfigMixin, ThreadPoolLeaseStoreMixin, ThreadPoolSeedPoolMixin, ThreadPoolRolePolicyMixin):
    def __init__(
        self,
        *,
        workspace_root: str | Path,
        config_path: str | Path,
        transport_url: str = "ws://127.0.0.1:8146",
        state_root: str | Path | None = None,
        client: AppServerSessionClient | None = None,
        orphan_ttl_minutes: int = 30,
        async_warmup: bool = True,
        warmup_concurrency_limit: int = DEFAULT_WARMUP_CONCURRENCY_LIMIT,
    ) -> None:
        self.workspace_root = Path(workspace_root).resolve()
        self.config_path = Path(config_path).resolve()
        self.transport_url = str(transport_url).strip()
        self.state_root = Path(state_root).resolve() if state_root else (self.workspace_root / "_workspace" / "runtime" / "thread_pool").resolve()
        self.store = ThreadPoolStore(self.state_root)
        self.client = client or AppServerSessionClient(
            self.workspace_root,
            transport_mode="ws",
            transport_url=self.transport_url,
            request_timeout_seconds=90.0,
            turn_timeout_seconds=90.0,
            init_timeout_seconds=90.0,
        )
        self._owns_client = client is None
        self._role_clients: dict[str, AppServerSessionClient] = {}
        self.orphan_ttl_minutes = int(orphan_ttl_minutes)
        self.async_warmup = bool(async_warmup)
        self.warmup_concurrency_limit = max(1, int(warmup_concurrency_limit or DEFAULT_WARMUP_CONCURRENCY_LIMIT))
        self._warmup_semaphore = threading.BoundedSemaphore(self.warmup_concurrency_limit)
        self.roles: dict[str, RoleConfig] = {}
        self.discard_on_release = True
        self._lock = threading.RLock()
        self._warming_roles: set[str] = set()
        self._replenishing_roles: set[str] = set()
        self._warmup_errors: dict[str, str] = {}
        self._warmup_details: dict[str, str] = {}
        self._started = False
        self._recovering = False
        self._ready_for_leases = False
        self._startup_error: str | None = None
        self._startup_started_at: float | None = None
        self._startup_finished_at: float | None = None
        self._startup_thread: threading.Thread | None = None
        self._role_status_cache: dict[str, tuple[float, dict]] = {}
        self._recovery_generation = 0

    def start(self, *, background_recover: bool = False) -> None:
        startup_thread: threading.Thread | None = None
        with self._lock:
            if self._started:
                return
            self.client.start()
            raw_config = self._load_config()
            self.discard_on_release = self._load_discard_on_release(raw_config)
            self.roles = self._load_roles(raw_config)
            self._started = True
            self._recovering = True
            self._ready_for_leases = False
            self._startup_error = None
            self._startup_started_at = time.monotonic()
            self._startup_finished_at = None
            self._warmup_errors = {}
            self._warmup_details = {}
            self._warming_roles = set()
            self._replenishing_roles = set()
            self._startup_thread = None
            self._write_catalog()
            if background_recover:
                startup_thread = threading.Thread(
                    target=self._run_background_startup,
                    name="thread-pool-startup",
                    daemon=True,
                )
                self._startup_thread = startup_thread
        if startup_thread is not None:
            startup_thread.start()
            return
        self._finish_startup()

    def close(self) -> None:
        if self._owns_client:
            self.client.close()
        for role_client in self._role_clients.values():
            role_client.close()
        self._role_clients = {}

    def _finish_startup(self) -> None:
        recovery_generation = self._recovery_generation
        if not self._recover_state(recovery_generation=recovery_generation):
            return
        if not self.async_warmup:
            if not self._recovery_generation_is_current(recovery_generation):
                return
            self._ensure_min_idle_all()
            if not self._recovery_generation_is_current(recovery_generation):
                return
        roles_to_warm: list[str] = []
        with self._lock:
            if not self._recovery_generation_is_current(recovery_generation):
                return
            self._recovering = False
            self._ready_for_leases = True
            self._startup_error = None
            self._startup_finished_at = time.monotonic()
            self._write_catalog()
            if self.async_warmup:
                roles_to_warm = [role_name for role_name in self.roles if self._role_needs_warmup(role_name)]
        for role_name in roles_to_warm:
            self._schedule_ensure_min_idle(role_name)

    def _run_background_startup(self) -> None:
        try:
            self._finish_startup()
        except Exception as exc:
            with self._lock:
                self._recovering = False
                self._ready_for_leases = False
                self._startup_error = f"{type(exc).__name__}: {exc}"
                self._startup_finished_at = time.monotonic()
                self._write_catalog()

    def _recovery_generation_is_current(self, recovery_generation: int) -> bool:
        with self._lock:
            return int(recovery_generation) == int(self._recovery_generation)

    def _invalidate_startup_recovery_for_maintenance(self) -> None:
        self._recovery_generation += 1
        if self._recovering:
            self._recovering = False
            self._ready_for_leases = True
            self._startup_error = None
            self._startup_finished_at = time.monotonic()

    def _startup_status_payload(self, *, update_catalog: bool = True) -> dict[str, object]:
        thread = self._startup_thread
        alive = bool(thread is not None and thread.is_alive())
        elapsed_ms: int | None = None
        if self._startup_started_at is not None:
            finished_at = self._startup_finished_at if self._startup_finished_at is not None else time.monotonic()
            elapsed_ms = max(0, int((finished_at - self._startup_started_at) * 1000))
        stalled = bool(
            self._recovering
            and self._startup_error is None
            and thread is not None
            and (not alive or (elapsed_ms is not None and elapsed_ms >= int(STARTUP_RECOVERY_STALE_SECONDS * 1000)))
        )
        if stalled:
            self._recovering = False
            self._ready_for_leases = False
            reason = "startup thread exited before completing recovery" if not alive else "startup recovery exceeded timeout"
            self._startup_error = f"ThreadPoolStartupStalled: {reason}"
            self._startup_finished_at = time.monotonic()
            if update_catalog:
                self._write_catalog()
        return {
            "startup_thread_alive": alive,
            "startup_elapsed_ms": elapsed_ms,
            "startup_stalled": stalled,
        }

    def health_payload(self) -> dict:
        with self._lock:
            startup_status = self._startup_status_payload()
            warming_roles: set[str] = set()
            replenishing_roles: set[str] = set()
            for role_name, config in self.roles.items():
                seed = self._find_seed_thread(config.name)
                if seed is not None and seed.status == "initializing":
                    warming_roles.add(role_name)
                elif (
                    not self._recovering
                    and not self._startup_error
                    and not self._warmup_errors.get(role_name)
                    and seed is not None
                    and seed.status == "idle"
                    and self._idle_count(role_name) < config.min_idle
                ):
                    replenishing_roles.add(role_name)
            return {
                "ok": True,
                "service": "thread_pool_service",
                "workspace_root": str(self.workspace_root),
                "config_path": str(self.config_path),
                "transport_url": self.transport_url,
                "state_root": str(self.state_root),
                "roles": sorted(self.roles.keys()),
                "discard_on_release": self.discard_on_release,
                "async_warmup": self.async_warmup,
                "warmup_concurrency_limit": self.warmup_concurrency_limit,
                "recovering": self._recovering,
                "ready_for_leases": self._ready_for_leases,
                "startup_error": self._startup_error,
                **startup_status,
                "warming_roles": sorted(warming_roles),
                "replenishing_roles": sorted(replenishing_roles),
                "warmup_errors": dict(self._warmup_errors),
                "warmup_details": dict(self._warmup_details),
                "reported_at": _now(),
            }

    def config_payload(self) -> dict:
        with self._lock:
            return {
                "ok": True,
                "config_path": str(self.config_path),
                "discard_on_release": self.discard_on_release,
                "reported_at": _now(),
            }

    def update_config(self, *, discard_on_release: bool) -> dict:
        with self._lock:
            raw = self._load_config()
            thread_pool_payload = raw.get("thread_pool")
            if not isinstance(thread_pool_payload, dict):
                thread_pool_payload = {}
            thread_pool_payload["discard_on_release"] = bool(discard_on_release)
            raw["thread_pool"] = thread_pool_payload
            write_json(self.config_path, raw)
            self.discard_on_release = bool(discard_on_release)
            return self.config_payload()

    def get_role_status(self, role: str) -> dict:
        with self._lock:
            self._startup_status_payload()
            config = self._require_role(role)
            self._refresh_initializing_seed_for_status(config)
            cached = self._role_status_cache.get(config.name)
            now_monotonic = time.monotonic()
            if (
                cached is not None
                and config.name not in self._warming_roles
                and not self._recovering
                and now_monotonic - cached[0] < ROLE_STATUS_CACHE_SECONDS
            ):
                return deepcopy(cached[1])
            payload = self._role_status_from_catalog(config)
            self._role_status_cache[config.name] = (now_monotonic, deepcopy(payload))
            return payload

    def _refresh_initializing_seed_for_status(self, config: RoleConfig) -> None:
        seed = self._find_seed_thread(config.name)
        if seed is None or seed.status != "initializing":
            return
        try:
            self._refresh_seed_thread(config, seed, wait_for_ready=False)
            self._warmup_errors.pop(config.name, None)
        except Exception as exc:
            self._warmup_errors[config.name] = f"{type(exc).__name__}: {exc}"
        finally:
            self._role_status_cache.pop(config.name, None)
            self._write_catalog()

    def acquire(self, *, role: str, owner_id: str) -> dict:
        normalized_owner_id = str(owner_id).strip()
        role_name = str(role).strip()
        config = self._acquire_config_for_role(role_name)
        while True:
            try:
                thread = self._find_or_create_available_thread(config, wait_for_ready=True)
            except SeedInitializationPending as exc:
                with self._lock:
                    self._warmup_errors.pop(config.name, None)
                    self._warmup_details[config.name] = f"waiting for seed initialization: {config.name}"
                    self._write_catalog()
                raise RuntimeError(f"thread pool role is warming: {exc}") from exc
            now = _now()
            with self._lock:
                self._require_ready_for_leases()
                config = self._require_role(config.name)
                current_thread = self.store.read_thread(thread.thread_id)
                if (
                    current_thread is None
                    or current_thread.status != "idle"
                    or current_thread.is_seed
                    or not self._matches_thread_fingerprint(current_thread, config)
                ):
                    continue
                lease = LeaseRecord(
                    lease_id=str(uuid4()),
                    role=config.name,
                    owner_id=normalized_owner_id,
                    thread_id=current_thread.thread_id,
                    status="active",
                    created_at=now,
                    last_seen_at=now,
                )
                leased_thread = current_thread.model_copy(
                    update={
                        "status": "leased",
                        "lease_id": lease.lease_id,
                        "lease_count": int(current_thread.lease_count or 0) + 1,
                        "updated_at": now,
                    }
                )
                self.store.write_thread(leased_thread)
                self.store.write_lease(lease)
                self._write_catalog()
            self._schedule_ensure_min_idle(config.name)
            return {
                "ok": True,
                "lease_id": lease.lease_id,
                "role": config.name,
                "thread_id": thread.thread_id,
                "status": "leased",
            }

    def touch(self, *, lease_id: str, owner_id: str) -> dict:
        with self._lock:
            lease = self._require_active_lease(lease_id)
            if lease.owner_id != str(owner_id).strip():
                raise ValueError(f"lease owner mismatch: {lease_id}")
            lease = lease.model_copy(update={"last_seen_at": _now()})
            self.store.write_lease(lease)
            self._write_catalog()
            return {
                "ok": True,
                "lease_id": lease.lease_id,
                "thread_id": lease.thread_id,
                "status": lease.status,
            }

    def release(self, *, lease_id: str, owner_id: str) -> dict:
        with self._lock:
            lease = self._require_active_lease(lease_id)
            if lease.owner_id != str(owner_id).strip():
                raise ValueError(f"lease owner mismatch: {lease_id}")
            return self._release_active_lease(lease)

    def release_owner_leases(self, *, owner_id: str) -> dict:
        normalized_owner_id = str(owner_id).strip()
        if not normalized_owner_id:
            raise ValueError("owner_id cannot be empty")
        with self._lock:
            active_leases = [
                record
                for record in self.store.list_leases().values()
                if record.status == "active" and record.owner_id == normalized_owner_id
            ]
            released: list[dict[str, str]] = []
            for lease in sorted(active_leases, key=lambda item: (item.role, item.lease_id)):
                result = self._release_active_lease(lease)
                released.append(
                    {
                        "lease_id": str(result["lease_id"]),
                        "thread_id": str(result["thread_id"]),
                        "thread_status": str(result["thread_status"]),
                    }
                )
            return {
                "ok": True,
                "owner_id": normalized_owner_id,
                "released_count": len(released),
                "released_leases": released,
            }

    def discard_thread(self, *, thread_id: str, reason: str) -> dict:
        with self._lock:
            thread = self.store.read_thread(thread_id)
            if thread is None:
                raise ValueError(f"unknown thread: {thread_id}")
            if thread.is_seed:
                raise ValueError(f"seed thread cannot be discarded manually: {thread_id}")
            now = _now()
            if thread.status == "leased":
                thread = thread.model_copy(
                    update={
                        "retire_on_release": True,
                        "discard_reason": str(reason).strip(),
                        "updated_at": now,
                    }
                )
                self.store.write_thread(thread)
                self._schedule_ensure_min_idle(thread.role)
                self._write_catalog()
                return {
                    "ok": True,
                    "thread_id": thread.thread_id,
                    "status": thread.status,
                    "retire_on_release": True,
                }
            self.store.delete_thread(thread.thread_id)
            self._schedule_ensure_min_idle(thread.role)
            self._write_catalog()
            return {
                "ok": True,
                "thread_id": thread_id,
                "status": "deleted",
                "retire_on_release": False,
            }

    def force_update_seeds(self, *, reason: str, roles: list[str] | None = None) -> dict:
        target_roles = self._resolve_maintenance_roles(roles)
        normalized_reason = str(reason or "manual-force-update-seeds").strip() or "manual-force-update-seeds"
        now = _now()
        deleted_threads: list[dict[str, str]] = []
        retiring_threads: list[dict[str, str]] = []
        with self._lock:
            for role_name in target_roles:
                self._require_role(role_name)
            self._invalidate_startup_recovery_for_maintenance()
            for thread in sorted(self.store.list_threads().values(), key=lambda item: (item.role, item.created_at, item.thread_id)):
                if thread.role not in target_roles:
                    continue
                if self._thread_is_release_persistent(thread) and self._thread_has_been_leased(thread):
                    continue
                if thread.status == "leased":
                    if thread.is_seed:
                        raise ValueError(f"seed thread cannot be leased: {thread.thread_id}")
                    retiring = thread.model_copy(
                        update={
                            "retire_on_release": True,
                            "discard_reason": normalized_reason,
                            "updated_at": now,
                        }
                    )
                    self.store.write_thread(retiring)
                    retiring_threads.append({"role": thread.role, "thread_id": thread.thread_id})
                    continue
                self.store.delete_thread(thread.thread_id)
                deleted_threads.append({"role": thread.role, "thread_id": thread.thread_id})
            for role_name in target_roles:
                self._role_status_cache.pop(role_name, None)
            self._write_catalog()
        for role_name in target_roles:
            self._schedule_ensure_min_idle(role_name)
        return {
            "ok": True,
            "reason": normalized_reason,
            "roles": target_roles,
            "deleted_count": len(deleted_threads),
            "retiring_count": len(retiring_threads),
            "deleted_threads": deleted_threads,
            "retiring_threads": retiring_threads,
        }

    def _resolve_maintenance_roles(self, roles: list[str] | None) -> list[str]:
        if roles is None:
            return sorted(self.roles.keys())
        normalized = []
        seen = set()
        for role in roles:
            role_name = str(role or "").strip()
            if not role_name or role_name in seen:
                continue
            seen.add(role_name)
            normalized.append(role_name)
        if not normalized:
            raise ValueError("roles cannot be empty")
        return normalized

    def _acquire_config_for_role(self, role_name: str) -> RoleConfig:
        with self._lock:
            self._require_ready_for_leases()
            return deepcopy(self._require_role(role_name))

    def _discard_on_release_for_role(self, role_name: str) -> bool:
        config = self.roles.get(str(role_name or "").strip())
        if config is not None and config.discard_on_release is not None:
            return bool(config.discard_on_release)
        return bool(self.discard_on_release)

    def _thread_is_release_persistent(self, thread: ThreadRecord) -> bool:
        return not self._discard_on_release_for_role(thread.role)
