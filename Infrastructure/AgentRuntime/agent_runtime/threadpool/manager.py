from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path
import threading
import time
from uuid import uuid4

from ..appserver.client import AppServerSessionClient
from ..storage import read_json, write_json
from .lease_store import ThreadPoolLeaseStoreMixin
from .models import LeaseRecord, RoleConfig, ThreadRecord
from .role_policy import ROLE_STATUS_CACHE_SECONDS, ThreadPoolRolePolicyMixin, role_can_acquire
from .role_profile import load_role_profile
from .seed_pool import SeedInitializationPending, ThreadPoolSeedPoolMixin
from .store import ThreadPoolStore


def _now() -> str:
    return datetime.now().astimezone().isoformat()


class ThreadPoolManager(ThreadPoolLeaseStoreMixin, ThreadPoolSeedPoolMixin, ThreadPoolRolePolicyMixin):
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
        self.orphan_ttl_minutes = int(orphan_ttl_minutes)
        self.async_warmup = bool(async_warmup)
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
        self._startup_thread: threading.Thread | None = None
        self._role_status_cache: dict[str, tuple[float, dict]] = {}

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

    def _finish_startup(self) -> None:
        self._recover_state()
        if not self.async_warmup:
            self._ensure_min_idle_all()
        roles_to_warm: list[str] = []
        with self._lock:
            self._recovering = False
            self._ready_for_leases = True
            self._startup_error = None
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
                self._write_catalog()

    def health_payload(self) -> dict:
        with self._lock:
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
                "recovering": self._recovering,
                "ready_for_leases": self._ready_for_leases,
                "startup_error": self._startup_error,
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

    def _acquire_config_for_role(self, role_name: str) -> RoleConfig:
        with self._lock:
            self._require_ready_for_leases()
            return deepcopy(self._require_role(role_name))

    def _load_config(self) -> dict:
        raw = read_json(self.config_path)
        if not isinstance(raw, dict):
            raise ValueError("thread_roles.json must be a JSON object")
        return raw

    @staticmethod
    def _load_discard_on_release(raw: dict) -> bool:
        payload = raw.get("thread_pool", {})
        if payload is None:
            return True
        if not isinstance(payload, dict):
            raise ValueError("thread_roles.json field 'thread_pool' must be an object")
        value = payload.get("discard_on_release", True)
        if not isinstance(value, bool):
            raise ValueError("thread_roles.json field 'thread_pool.discard_on_release' must be a boolean")
        return value

    def _load_roles(self, raw: dict) -> dict[str, RoleConfig]:
        role_map = raw.get("roles", {})
        if not isinstance(role_map, dict):
            raise ValueError("thread_roles.json must contain object field 'roles'")
        roles: dict[str, RoleConfig] = {}
        for role_name, payload in role_map.items():
            if not isinstance(payload, dict):
                raise ValueError(f"role config must be object: {role_name}")
            normalized_payload = dict(payload)
            profile_path = normalized_payload.get("profile_path")
            if profile_path is not None:
                loaded_profile = load_role_profile(self.workspace_root, role_name, profile_path)
                normalized_payload.update(
                    {
                        "profile_path": str(loaded_profile.profile_path),
                        "profile_version": loaded_profile.profile_version,
                        "skill_path": loaded_profile.skill_path,
                        "init_prompt": loaded_profile.init_prompt,
                        "init_ready_text": loaded_profile.init_ready_text,
                        "init_template_path": loaded_profile.init_template_path,
                        "init_template_hash": loaded_profile.init_template_hash,
                    }
                )
            config = RoleConfig.model_validate({"name": role_name, **normalized_payload})
            if not config.init_prompt:
                raise ValueError(f"role init_prompt cannot be empty: {role_name}")
            roles[config.name] = config
        return roles

    def _write_catalog(self) -> None:
        threads = list(self.store.list_threads().values())
        leases = list(self.store.list_leases().values())
        roles_payload: dict[str, dict] = {}
        for role_name in sorted(self.roles.keys()):
            role_threads = sorted(
                (thread for thread in threads if thread.role == role_name),
                key=lambda thread: (thread.is_seed is False, thread.created_at, thread.thread_id),
            )
            role_leases = sorted(
                (lease for lease in leases if lease.role == role_name and lease.status == "active"),
                key=lambda lease: (lease.created_at, lease.lease_id),
            )
            counts = {
                "initializing": 0,
                "idle": 0,
                "leased": 0,
                "retired": 0,
                "discarded": 0,
            }
            config = self.roles.get(role_name)
            for thread in role_threads:
                if thread.is_seed:
                    continue
                if thread.status == "idle" and config is not None and not self._matches_thread_fingerprint(thread, config):
                    continue
                counts[thread.status] = counts.get(thread.status, 0) + 1
            seed_thread = next((thread for thread in role_threads if thread.is_seed and thread.status != "discarded"), None)
            thread_entries = [
                {
                    "thread_id": thread.thread_id,
                    "thread_status": thread.status,
                    "is_seed": thread.is_seed,
                    "lease_id": thread.lease_id,
                    "lease_count": int(thread.lease_count or 0),
                    "retire_on_release": bool(thread.retire_on_release),
                    "discard_reason": thread.discard_reason,
                    "init_turn_id": thread.init_turn_id,
                    "init_fingerprint": thread.init_fingerprint,
                    "created_at": thread.created_at,
                    "updated_at": thread.updated_at,
                    "last_validated_at": thread.last_validated_at,
                }
                for thread in role_threads
            ]
            active_leases = [
                {
                    "lease_id": lease.lease_id,
                    "owner_id": lease.owner_id,
                    "thread_id": lease.thread_id,
                    "status": lease.status,
                    "created_at": lease.created_at,
                    "last_seen_at": lease.last_seen_at,
                    "released_at": lease.released_at,
                }
                for lease in role_leases
            ]
            roles_payload[role_name] = {
                "counts": counts,
                "seed_thread_id": seed_thread.thread_id if seed_thread is not None else None,
                "seed_init_fingerprint": seed_thread.init_fingerprint if seed_thread is not None else None,
                "active_lease_ids": [lease.lease_id for lease in role_leases],
                "active_leases": active_leases,
                "thread_entries": thread_entries,
            }
        self.store.write_catalog(
            {
                "ok": True,
                "service": "thread_pool_service",
                "workspace_root": str(self.workspace_root),
                "config_path": str(self.config_path),
                "state_root": str(self.state_root),
                "transport_url": self.transport_url,
                "discard_on_release": self.discard_on_release,
                "async_warmup": self.async_warmup,
                "recovering": self._recovering,
                "ready_for_leases": self._ready_for_leases,
                "startup_error": self._startup_error,
                "roles": roles_payload,
                "reported_at": _now(),
            }
        )
