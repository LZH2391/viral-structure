from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import hashlib
import json
from pathlib import Path
import threading
import time
from uuid import uuid4

from ..appserver.client import AppServerSessionClient
from ..storage import file_lock, read_json, write_json
from .models import LeaseRecord, RoleConfig, ThreadRecord
from .role_profile import load_role_profile
from .store import ThreadPoolStore

MAX_INACTIVE_LEASE_RECORDS = 64
ROLE_STATUS_CACHE_SECONDS = 0.75
SEED_INITIALIZATION_STALE_SECONDS = 300.0


def _now() -> str:
    return datetime.now().astimezone().isoformat()


def _role_can_acquire(
    *,
    ok: bool,
    ready_for_leases: bool,
    recovering: bool,
    warming: bool,
    startup_error: str | None,
    warmup_error: str | None,
    counts: dict[str, int],
    min_idle: int,
    seed_ready: bool,
) -> bool:
    idle = int(counts.get("idle") or 0)
    return bool(
        ok
        and ready_for_leases
        and not recovering
        and not warming
        and not startup_error
        and not warmup_error
        and (idle > 0 or seed_ready)
    )


class SeedInitializationPending(RuntimeError):
    pass


class ThreadPoolManager:
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
            initializing_seed_roles = self._initializing_seed_roles()
            warming_roles = sorted(initializing_seed_roles)
            replenishing_roles = sorted(self._replenishing_roles | (self._warming_roles - initializing_seed_roles))
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
                "warming_roles": warming_roles,
                "replenishing_roles": replenishing_roles,
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

    def acquire(self, *, role: str, owner_id: str) -> dict:
        normalized_owner_id = str(owner_id).strip()
        role_name = str(role).strip()
        config = self._acquire_config_for_role(role_name)
        while True:
            try:
                thread = self._find_or_create_available_thread(config)
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

    def _release_active_lease(self, lease: LeaseRecord) -> dict:
        thread = self.store.read_thread(lease.thread_id)
        self._require_role(lease.role)
        now = _now()
        released_lease = lease.model_copy(update={"status": "released", "released_at": now, "last_seen_at": now})
        self.store.write_lease(released_lease)
        self._prune_inactive_leases()
        returned_status = "deleted"
        if thread is not None:
            if thread.is_seed:
                raise ValueError(f"seed thread cannot be leased: {thread.thread_id}")
            if self.discard_on_release or thread.retire_on_release or not self.client.validate_thread(thread.thread_id):
                self.store.delete_thread(thread.thread_id)
            else:
                thread = thread.model_copy(
                    update={
                        "status": "idle",
                        "lease_id": None,
                        "retire_on_release": False,
                        "updated_at": now,
                        "last_validated_at": now,
                    }
                )
                returned_status = "idle"
            if returned_status == "idle":
                self.store.write_thread(thread)
            self._schedule_ensure_min_idle(thread.role)
        self._write_catalog()
        return {
            "ok": True,
            "lease_id": released_lease.lease_id,
            "thread_id": released_lease.thread_id,
            "thread_status": returned_status,
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

    def _recover_state(self) -> None:
        threads = self.store.list_threads()
        leases = self.store.list_leases()
        now = datetime.now().astimezone()
        ttl_seconds = self.orphan_ttl_minutes * 60
        for thread in threads.values():
            config = self.roles.get(thread.role)
            if thread.status == "discarded":
                self.store.delete_thread(thread.thread_id)
                continue
            if thread.is_seed:
                if config is not None and not self._matches_thread_fingerprint(thread, config):
                    self.store.delete_thread(thread.thread_id)
                    continue
                if thread.status == "initializing":
                    if self._thread_exists_for_recovery(thread.thread_id):
                        self.store.write_thread(thread.model_copy(update={"updated_at": _now()}))
                    else:
                        self.store.delete_thread(thread.thread_id)
                    continue
                if self._thread_exists_for_recovery(thread.thread_id):
                    self.store.write_thread(thread.model_copy(update={"last_validated_at": _now(), "updated_at": _now()}))
                else:
                    self.store.delete_thread(thread.thread_id)
                continue
            if thread.status == "idle":
                if self.discard_on_release and self._thread_has_been_leased(thread):
                    self.store.delete_thread(thread.thread_id)
                    continue
                if config is not None and not self._matches_thread_fingerprint(thread, config):
                    self.store.delete_thread(thread.thread_id)
                    continue
                if self._thread_exists_for_recovery(thread.thread_id):
                    self.store.write_thread(thread.model_copy(update={"last_validated_at": _now(), "updated_at": _now()}))
                else:
                    self.store.delete_thread(thread.thread_id)
        for lease in leases.values():
            if not self.discard_on_release and not lease.is_orphaned(now=now, ttl_seconds=ttl_seconds):
                continue
            thread = self.store.read_thread(lease.thread_id)
            released_at = _now()
            self.store.write_lease(lease.model_copy(update={"status": "released", "released_at": released_at, "last_seen_at": released_at}))
            if thread is None:
                continue
            if self.discard_on_release or thread.retire_on_release:
                self.store.delete_thread(thread.thread_id)
            elif self._thread_exists_for_recovery(thread.thread_id):
                self.store.write_thread(
                    thread.model_copy(
                        update={
                            "status": "idle",
                            "lease_id": None,
                            "retire_on_release": False,
                            "updated_at": released_at,
                            "last_validated_at": released_at,
                        }
                    )
                )
            else:
                self.store.delete_thread(thread.thread_id)
        self._prune_inactive_leases()

    def _thread_exists_for_recovery(self, thread_id: str) -> bool:
        exists = getattr(self.client, "thread_exists", None)
        if callable(exists):
            return bool(exists(thread_id))
        return bool(self.client.validate_thread(thread_id))

    def _thread_has_been_leased(self, thread: ThreadRecord) -> bool:
        if int(thread.lease_count or 0) > 0 or thread.lease_id:
            return True
        return any(lease.thread_id == thread.thread_id for lease in self.store.list_leases().values())

    def _prune_inactive_leases(self, *, keep: int = MAX_INACTIVE_LEASE_RECORDS) -> None:
        inactive = [lease for lease in self.store.list_leases().values() if lease.status != "active"]
        excess = len(inactive) - max(0, int(keep))
        if excess <= 0:
            return
        inactive.sort(key=self._lease_retention_key)
        for lease in inactive[:excess]:
            self.store.delete_lease(lease.lease_id)

    @staticmethod
    def _lease_retention_key(lease: LeaseRecord) -> str:
        return str(lease.released_at or lease.last_seen_at or lease.created_at or "")

    def _find_or_create_available_thread(self, config: RoleConfig) -> ThreadRecord:
        threads = sorted(
            (
                record
                for record in self.store.list_threads().values()
                if record.role == config.name and record.status == "idle" and not record.is_seed
            ),
            key=lambda record: record.created_at,
        )
        for thread in threads:
            if not self._matches_thread_fingerprint(thread, config):
                self.store.delete_thread(thread.thread_id)
                continue
            if self.client.validate_thread(thread.thread_id):
                validated = thread.model_copy(update={"last_validated_at": _now(), "updated_at": _now()})
                self.store.write_thread(validated)
                return validated
            self.store.delete_thread(thread.thread_id)
        return self._create_thread(config, wait_for_ready=True)

    def _create_thread(self, config: RoleConfig, *, wait_for_ready: bool) -> ThreadRecord:
        seed = self._ensure_seed_thread(config, wait_for_ready=wait_for_ready)
        if seed.status != "idle":
            raise SeedInitializationPending(f"seed for role {config.name} is still initializing")
        thread_id = self.client.fork_initialized_thread(seed.thread_id)
        now = _now()
        record = ThreadRecord(
            thread_id=thread_id,
            role=config.name,
            status="idle",
            is_seed=False,
            init_fingerprint=seed.init_fingerprint,
            created_at=now,
            updated_at=now,
            last_validated_at=now,
        )
        self.store.write_thread(record)
        return record

    def _ensure_seed_thread(self, config: RoleConfig, *, wait_for_ready: bool) -> ThreadRecord:
        seed = self._find_seed_thread(config.name)
        if seed is not None:
            refreshed_seed = self._refresh_seed_thread(config, seed, wait_for_ready=wait_for_ready)
            if refreshed_seed is not None:
                return refreshed_seed
        return self._start_seed_initialization(config, wait_for_ready=wait_for_ready)

    def _start_seed_initialization(self, config: RoleConfig, *, wait_for_ready: bool) -> ThreadRecord:
        with file_lock(self._seed_claim_lock_path(config)):
            seed = self._find_matching_seed_thread(config)
            if seed is not None:
                refreshed_seed = self._refresh_seed_thread(config, seed, wait_for_ready=wait_for_ready)
                if refreshed_seed is not None:
                    return refreshed_seed
            started = self.client.start_initialized_thread(
                config.init_prompt,
                config.skill_path,
            )
            now = _now()
            record = ThreadRecord(
                thread_id=started.thread_id,
                role=config.name,
                status="initializing" if started.turn_id else "idle",
                is_seed=True,
                init_turn_id=started.turn_id,
                init_fingerprint=self._role_init_fingerprint(config),
                created_at=now,
                updated_at=now,
                last_validated_at=now,
            )
            self.store.write_thread(record)
        if started.turn_id and wait_for_ready:
            refreshed_seed = self._refresh_seed_thread(config, record, wait_for_ready=True)
            if refreshed_seed is None:
                raise RuntimeError(f"seed initialization failed for role {config.name}")
            return refreshed_seed
        return record

    def _refresh_seed_thread(self, config: RoleConfig, seed: ThreadRecord, *, wait_for_ready: bool) -> ThreadRecord | None:
        if not self._matches_thread_fingerprint(seed, config):
            self.store.delete_thread(seed.thread_id)
            return None
        if seed.status != "initializing":
            if self.client.validate_thread(seed.thread_id):
                validated = seed.model_copy(update={"last_validated_at": _now(), "updated_at": _now()})
                self.store.write_thread(validated)
                return validated
            self.store.delete_thread(seed.thread_id)
            return None
        turn_id = str(seed.init_turn_id or "").strip()
        if not turn_id:
            promoted_seed = seed.model_copy(
                update={"status": "idle", "updated_at": _now(), "last_validated_at": _now()}
            )
            self.store.write_thread(promoted_seed)
            return promoted_seed
        try:
            result = (
                self.client.wait_turn_result(
                    thread_id=seed.thread_id,
                    turn_id=turn_id,
                    timeout_seconds=self.client.init_timeout_seconds,
                )
                if wait_for_ready
                else self.client.collect_turn_result(thread_id=seed.thread_id, turn_id=turn_id)
            )
        except Exception:
            if self._seed_initialization_is_stale(seed):
                self.store.delete_thread(seed.thread_id)
                return None
            updated_seed = seed.model_copy(update={"updated_at": _now()})
            self.store.write_thread(updated_seed)
            return updated_seed
        normalized_status = str(result.status or "").strip().lower()
        if normalized_status in {"running", "inprogress"}:
            if self._seed_initialization_is_stale(seed):
                self.store.delete_thread(seed.thread_id)
                return None
            updated_seed = seed.model_copy(update={"updated_at": _now()})
            self.store.write_thread(updated_seed)
            return updated_seed
        if normalized_status != "completed":
            self.store.delete_thread(seed.thread_id)
            raise RuntimeError(f"seed init turn failed for role {config.name}: {result.status}")
        if not self._matches_ready_text(config, result.final_message):
            self.store.delete_thread(seed.thread_id)
            raise RuntimeError(f"seed init turn returned unexpected completion text for role {config.name}")
        promoted_seed = seed.model_copy(
            update={
                "status": "idle",
                "init_turn_id": None,
                "updated_at": _now(),
                "last_validated_at": _now(),
            }
        )
        self.store.write_thread(promoted_seed)
        return promoted_seed

    @staticmethod
    def _matches_ready_text(config: RoleConfig, final_message: str | None) -> bool:
        expected = str(config.init_ready_text or "").strip()
        if not expected:
            return True
        actual = str(final_message or "").strip()
        return actual == expected

    def _ensure_min_idle_all(self) -> None:
        for role_name in self.roles:
            self._ensure_min_idle(role_name, wait_for_ready=True)

    def _schedule_ensure_min_idle(self, role_name: str) -> None:
        if not self.async_warmup:
            self._ensure_min_idle(role_name, wait_for_ready=True)
            return
        normalized_role = str(role_name).strip()
        with self._lock:
            if (
                not normalized_role
                or normalized_role in self._warming_roles
                or normalized_role in self._replenishing_roles
            ):
                return
            if self._role_has_initializing_seed(normalized_role):
                self._warming_roles.add(normalized_role)
            else:
                self._replenishing_roles.add(normalized_role)
            self._warmup_details[normalized_role] = "scheduled"
            self._write_catalog()
        worker = threading.Thread(
            target=self._run_background_warmup,
            args=(normalized_role,),
            name=f"thread-pool-warmup:{normalized_role}",
            daemon=True,
        )
        worker.start()

    def _run_background_warmup(self, role_name: str) -> None:
        try:
            while True:
                self._set_warmup_detail(role_name, "ensuring seed and idle threads")
                if self._ensure_min_idle(role_name, wait_for_ready=False):
                    break
                time.sleep(1.0)
            with self._lock:
                self._warmup_errors.pop(role_name, None)
                self._warmup_details[role_name] = "ready; clearing warmup flag"
                self._write_catalog()
        except Exception as exc:
            with self._lock:
                self._warmup_errors[role_name] = f"{type(exc).__name__}: {exc}"
                self._warmup_details[role_name] = "failed"
                self._write_catalog()
        finally:
            with self._lock:
                self._warming_roles.discard(role_name)
                self._replenishing_roles.discard(role_name)
                self._warmup_details.pop(role_name, None)
                self._write_catalog()

    def _ensure_min_idle(self, role_name: str, *, wait_for_ready: bool) -> bool:
        config = self._require_role(role_name)
        self._set_warmup_detail(role_name, "checking seed thread")
        seed = self._ensure_seed_thread(config, wait_for_ready=wait_for_ready)
        if seed.status != "idle":
            self._set_warmup_detail(role_name, f"waiting for seed initialization: {seed.thread_id}")
            return False
        while self._idle_count(role_name) < config.min_idle:
            self._set_warmup_detail(
                role_name,
                f"creating idle thread {self._idle_count(role_name) + 1}/{config.min_idle} from seed {seed.thread_id}",
            )
            self._create_thread(config, wait_for_ready=wait_for_ready)
        self._set_warmup_detail(role_name, f"idle target satisfied: {self._idle_count(role_name)}/{config.min_idle}")
        return True

    def _role_needs_warmup(self, role_name: str) -> bool:
        config = self._require_role(role_name)
        seed = self._find_seed_thread(config.name)
        return seed is None or seed.status != "idle" or self._idle_count(config.name) < config.min_idle

    def _set_warmup_detail(self, role_name: str, detail: str) -> None:
        with self._lock:
            if role_name not in self._warming_roles and role_name not in self._replenishing_roles:
                return
            if self._warmup_details.get(role_name) == detail:
                return
            self._warmup_details[role_name] = detail
            self._write_catalog()

    def _idle_count(self, role_name: str) -> int:
        return sum(
            1
            for record in self.store.list_threads().values()
            if record.role == role_name and record.status == "idle" and not record.is_seed
        )

    def _find_seed_thread(self, role_name: str, *, records: list[ThreadRecord] | None = None) -> ThreadRecord | None:
        source = self.store.list_threads().values() if records is None else records
        seeds = sorted(
            (
                record
                for record in source
                if record.role == role_name and record.is_seed and record.status != "discarded"
            ),
            key=lambda record: record.created_at,
        )
        return seeds[0] if seeds else None

    def _find_matching_seed_thread(self, config: RoleConfig) -> ThreadRecord | None:
        seeds = sorted(
            (
                record
                for record in self.store.list_threads().values()
                if record.role == config.name
                and record.is_seed
                and record.status != "discarded"
                and self._matches_thread_fingerprint(record, config)
            ),
            key=lambda record: record.created_at,
        )
        return seeds[0] if seeds else None

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

    def _write_catalog(self) -> None:
        self._role_status_cache.clear()
        threads = list(self.store.list_threads().values())
        leases = list(self.store.list_leases().values())
        thread_by_id = {record.thread_id: record for record in threads}
        role_counts: dict[str, dict[str, int]] = {}
        role_thread_entries: dict[str, list[dict[str, str | None]]] = {}
        role_active_leases: dict[str, list[dict[str, str | None]]] = {}
        for role_name in self.roles:
            role_counts[role_name] = {
                "initializing": 0,
                "idle": 0,
                "leased": 0,
                "retired": 0,
                "discarded": 0,
                "active_leases": 0,
            }
            role_thread_entries[role_name] = []
            role_active_leases[role_name] = []
        leases_by_thread: dict[str, list[LeaseRecord]] = {}
        for lease in leases:
            leases_by_thread.setdefault(lease.thread_id, []).append(lease)
        for thread in threads:
            if thread.role not in role_counts:
                role_counts[thread.role] = {
                    "initializing": 0,
                    "idle": 0,
                    "leased": 0,
                    "retired": 0,
                    "discarded": 0,
                    "active_leases": 0,
                }
                role_thread_entries[thread.role] = []
                role_active_leases[thread.role] = []
            if thread.is_seed:
                continue
            role_counts[thread.role][thread.status] += 1
            thread_leases = leases_by_thread.get(thread.thread_id, [])
            active_lease = next((lease for lease in thread_leases if lease.status == "active"), None)
            latest_lease = self._latest_lease_record(thread_leases)
            role_thread_entries[thread.role].append(
                {
                    "thread_id": thread.thread_id,
                    "thread_status": thread.status,
                    "lease_id": None if active_lease is None else active_lease.lease_id,
                    "owner_id": None if active_lease is None else active_lease.owner_id,
                    "last_owner_id": None if latest_lease is None else latest_lease.owner_id,
                    "last_seen_at": None
                    if latest_lease is None
                    else str(latest_lease.last_seen_at or latest_lease.released_at or latest_lease.created_at or ""),
                }
            )
        for lease in leases:
            if lease.status != "active":
                continue
            if lease.role not in role_counts:
                role_counts[lease.role] = {
                    "initializing": 0,
                    "idle": 0,
                    "leased": 0,
                    "retired": 0,
                    "discarded": 0,
                    "active_leases": 0,
                }
                role_thread_entries[lease.role] = []
                role_active_leases[lease.role] = []
            role_counts[lease.role]["active_leases"] += 1
            thread = thread_by_id.get(lease.thread_id)
            role_active_leases[lease.role].append(
                {
                    "lease_id": lease.lease_id,
                    "thread_id": lease.thread_id,
                    "owner_id": lease.owner_id,
                    "last_seen_at": lease.last_seen_at,
                    "thread_status": "leased" if thread is None else thread.status,
                }
            )
        seed_by_role: dict[str, ThreadRecord] = {}
        for thread in sorted(threads, key=lambda record: record.created_at):
            if thread.is_seed and thread.status != "discarded" and thread.role not in seed_by_role:
                seed_by_role[thread.role] = thread
        role_runtime_status: dict[str, dict[str, object]] = {}
        for role_name, config in self.roles.items():
            counts = role_counts.get(role_name, {})
            seed = seed_by_role.get(role_name)
            replenishing = role_name in self._replenishing_roles or (
                role_name in self._warming_roles and not (seed is not None and seed.status == "initializing")
            )
            warming = seed is not None and seed.status == "initializing"
            warmup_error = self._warmup_errors.get(role_name)
            warmup_detail = (
                f"waiting for seed initialization: {seed.thread_id}"
                if seed is not None and seed.status == "initializing"
                else self._warmup_details.get(role_name)
            )
            can_acquire = _role_can_acquire(
                ok=True,
                ready_for_leases=self._ready_for_leases,
                recovering=self._recovering,
                warming=warming,
                startup_error=self._startup_error,
                warmup_error=warmup_error,
                counts=counts,
                min_idle=config.min_idle,
                seed_ready=seed is not None and seed.status == "idle",
            )
            role_runtime_status[role_name] = {
                "recovering": self._recovering,
                "ready_for_leases": self._ready_for_leases,
                "startup_error": self._startup_error,
                "warming": warming,
                "replenishing": replenishing,
                "warmup_error": warmup_error,
                "warmup_detail": warmup_detail,
                "can_init": can_acquire,
                "can_acquire": can_acquire,
            }
        self.store.write_catalog(
            {
                "updated_at": _now(),
                "config_path": str(self.config_path),
                "orphan_ttl_minutes": self.orphan_ttl_minutes,
                "roles": {
                    role_name: {
                        "min_idle": config.min_idle,
                        "profile_path": config.profile_path,
                        "profile_version": config.profile_version,
                        "skill_path": config.skill_path,
                        "current_init_fingerprint": self._role_init_fingerprint(config),
                        "seed_thread_id": None if role_name not in seed_by_role else seed_by_role[role_name].thread_id,
                        "seed_init_fingerprint": None if role_name not in seed_by_role else seed_by_role[role_name].init_fingerprint,
                        **role_runtime_status.get(role_name, {}),
                        "counts": role_counts.get(role_name, {}),
                        "active_lease_ids": sorted(item["lease_id"] for item in role_active_leases.get(role_name, []) if item.get("lease_id")),
                        "active_leases": sorted(role_active_leases.get(role_name, []), key=lambda item: (str(item.get("owner_id") or ""), str(item.get("lease_id") or ""))),
                        "thread_entries": sorted(role_thread_entries.get(role_name, []), key=lambda item: self._catalog_thread_sort_key(item)),
                    }
                    for role_name, config in sorted(self.roles.items())
                },
            }
        )

    def _role_status_from_catalog(self, config: RoleConfig) -> dict:
        catalog = self.store.read_catalog()
        role_entries = catalog.get("roles", {}) if isinstance(catalog.get("roles"), dict) else {}
        role_entry = role_entries.get(config.name) if isinstance(role_entries, dict) else None
        if not isinstance(role_entry, dict):
            role_entry = {}
        counts = dict(role_entry.get("counts") or {})
        seed = self._find_seed_thread(config.name)
        replenishing = config.name in self._replenishing_roles or (
            config.name in self._warming_roles and not (seed is not None and seed.status == "initializing")
        )
        warming = seed is not None and seed.status == "initializing"
        warmup_error = self._warmup_errors.get(config.name)
        warmup_detail = (
            f"waiting for seed initialization: {seed.thread_id}"
            if seed is not None and seed.status == "initializing"
            else self._warmup_details.get(config.name)
        )
        can_acquire = _role_can_acquire(
            ok=True,
            ready_for_leases=self._ready_for_leases,
            recovering=self._recovering,
            warming=warming,
            startup_error=self._startup_error,
            warmup_error=warmup_error,
            counts=counts,
            min_idle=config.min_idle,
            seed_ready=seed is not None and seed.status == "idle",
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

    @staticmethod
    def _latest_lease_record(records: list[LeaseRecord]) -> LeaseRecord | None:
        if not records:
            return None
        return sorted(records, key=lambda item: (str(item.last_seen_at or ""), str(item.released_at or ""), str(item.created_at or "")))[-1]

    @staticmethod
    def _catalog_thread_sort_key(item: dict[str, str | None]) -> tuple[int, str]:
        status_order = {"leased": 0, "idle": 1, "retired": 2, "discarded": 3}
        return (status_order.get(str(item.get("thread_status") or "idle"), 9), str(item.get("thread_id") or ""))

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

    def _seed_initialization_is_stale(self, seed: ThreadRecord) -> bool:
        try:
            created_at = datetime.fromisoformat(str(seed.created_at))
        except ValueError:
            return False
        if created_at.tzinfo is None:
            now = datetime.now()
        else:
            now = datetime.now().astimezone(created_at.tzinfo)
        age_seconds = (now - created_at).total_seconds()
        timeout_seconds = float(getattr(self.client, "init_timeout_seconds", 0.0) or 0.0)
        stale_seconds = max(SEED_INITIALIZATION_STALE_SECONDS, timeout_seconds * 3.0)
        return age_seconds >= stale_seconds

    def _seed_claim_lock_path(self, config: RoleConfig) -> Path:
        role_slug = "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in config.name)
        fingerprint = self._role_init_fingerprint(config)
        return self.state_root / "seed_claims" / f"{role_slug}-{fingerprint}.lock"
