from __future__ import annotations

from datetime import datetime
from pathlib import Path
import threading
import time

from ..storage import file_lock
from .models import RoleConfig, ThreadRecord

SEED_INITIALIZATION_STALE_SECONDS = 300.0


def _now() -> str:
    return datetime.now().astimezone().isoformat()


class SeedInitializationPending(RuntimeError):
    pass


class ThreadPoolSeedPoolMixin:
    def _find_or_create_available_thread(self, config: RoleConfig, *, wait_for_ready: bool) -> ThreadRecord:
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
            if self._client_for_config(config).validate_thread(thread.thread_id):
                validated = thread.model_copy(update={"last_validated_at": _now(), "updated_at": _now()})
                self.store.write_thread(validated)
                return validated
            self.store.delete_thread(thread.thread_id)
        return self._create_thread(config, wait_for_ready=wait_for_ready)

    def _create_thread(self, config: RoleConfig, *, wait_for_ready: bool) -> ThreadRecord:
        seed = self._ensure_seed_thread(config, wait_for_ready=wait_for_ready)
        if seed.status != "idle":
            raise SeedInitializationPending(f"seed for role {config.name} is still initializing")
        thread_id = self._client_for_config(config).fork_initialized_thread(seed.thread_id)
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
            started = self._client_for_config(config).start_initialized_thread(
                config.init_prompt,
                config.skill_path,
                cwd=config.workspace_root,
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
            if self._client_for_config(config).validate_thread(seed.thread_id):
                validated = seed.model_copy(update={"last_validated_at": _now(), "updated_at": _now()})
                self.store.write_thread(validated)
                return validated
            self.store.delete_thread(seed.thread_id)
            return None
        turn_id = str(seed.init_turn_id or "").strip()
        if not turn_id:
            promoted_seed = seed.model_copy(update={"status": "idle", "updated_at": _now(), "last_validated_at": _now()})
            self.store.write_thread(promoted_seed)
            return promoted_seed
        client = self._client_for_config(config)
        try:
            result = (
                client.wait_turn_result(
                    thread_id=seed.thread_id,
                    turn_id=turn_id,
                    timeout_seconds=client.init_timeout_seconds,
                )
                if wait_for_ready
                else client.collect_turn_result(thread_id=seed.thread_id, turn_id=turn_id)
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
            ):
                return
            self._warming_roles.add(normalized_role)
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
            if role_name not in self._warming_roles:
                return
            if self._warmup_details.get(role_name) == detail:
                return
            self._warmup_details[role_name] = detail
            self._write_catalog()

    def _idle_count(self, role_name: str) -> int:
        config = self._require_role(role_name)
        return sum(
            1
            for record in self.store.list_threads().values()
            if record.role == role_name
            and record.status == "idle"
            and not record.is_seed
            and self._matches_thread_fingerprint(record, config)
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
        config = self.roles.get(seed.role)
        client = self._client_for_config(config) if config is not None else self.client
        timeout_seconds = float(getattr(client, "init_timeout_seconds", 0.0) or 0.0)
        stale_seconds = max(SEED_INITIALIZATION_STALE_SECONDS, timeout_seconds * 3.0)
        return age_seconds >= stale_seconds

    def _seed_claim_lock_path(self, config: RoleConfig) -> Path:
        role_slug = "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in config.name)
        fingerprint = self._role_init_fingerprint(config)
        return self.state_root / "seed_claims" / f"{role_slug}-{fingerprint}.lock"
