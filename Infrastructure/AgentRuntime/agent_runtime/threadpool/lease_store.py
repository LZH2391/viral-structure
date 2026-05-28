from __future__ import annotations

from datetime import datetime

from .models import LeaseRecord, ThreadRecord

MAX_INACTIVE_LEASE_RECORDS = 64


def _now() -> str:
    return datetime.now().astimezone().isoformat()


class ThreadPoolLeaseStoreMixin:
    def _recover_state(self, *, recovery_generation: int | None = None) -> bool:
        threads = self.store.list_threads()
        leases = self.store.list_leases()
        now = datetime.now().astimezone()
        ttl_seconds = self.orphan_ttl_minutes * 60
        if not self._recovery_generation_is_active(recovery_generation):
            return False
        if not self._recover_active_leases(leases=leases, now=now, ttl_seconds=ttl_seconds, recovery_generation=recovery_generation):
            return False
        threads = self.store.list_threads()
        leases = self.store.list_leases()
        active_lease_by_thread_id = {
            lease.thread_id: lease
            for lease in leases.values()
            if lease.status == "active"
        }
        if not self._recover_leased_threads_without_active_lease(
            threads=threads,
            active_lease_by_thread_id=active_lease_by_thread_id,
            recovery_generation=recovery_generation,
        ):
            return False
        threads = self.store.list_threads()
        for thread in threads.values():
            if not self._recovery_generation_is_active(recovery_generation):
                return False
            config = self.roles.get(thread.role)
            if thread.status == "discarded":
                if not self._recovery_generation_is_active(recovery_generation):
                    return False
                self.store.delete_thread(thread.thread_id)
                continue
            if thread.is_seed:
                if config is not None and not self._matches_thread_fingerprint(thread, config):
                    if not self._recovery_generation_is_active(recovery_generation):
                        return False
                    self.store.delete_thread(thread.thread_id)
                    continue
                if thread.status == "initializing":
                    if self._thread_exists_for_recovery(thread):
                        if not self._recovery_generation_is_active(recovery_generation):
                            return False
                        self.store.write_thread(thread.model_copy(update={"updated_at": _now()}))
                    else:
                        if not self._recovery_generation_is_active(recovery_generation):
                            return False
                        self.store.delete_thread(thread.thread_id)
                    continue
                if self._thread_is_usable_for_recovery(thread):
                    if not self._recovery_generation_is_active(recovery_generation):
                        return False
                    self.store.write_thread(thread.model_copy(update={"last_validated_at": _now(), "updated_at": _now()}))
                else:
                    if not self._recovery_generation_is_active(recovery_generation):
                        return False
                    self.store.delete_thread(thread.thread_id)
                continue
            if thread.status == "idle":
                if self.discard_on_release and self._thread_has_been_leased(thread):
                    if not self._recovery_generation_is_active(recovery_generation):
                        return False
                    self.store.delete_thread(thread.thread_id)
                    continue
                if config is not None and not self._matches_thread_fingerprint(thread, config):
                    if not self._recovery_generation_is_active(recovery_generation):
                        return False
                    self.store.delete_thread(thread.thread_id)
                    continue
                if self._thread_is_usable_for_recovery(thread):
                    if not self._recovery_generation_is_active(recovery_generation):
                        return False
                    self.store.write_thread(thread.model_copy(update={"last_validated_at": _now(), "updated_at": _now()}))
                else:
                    if not self._recovery_generation_is_active(recovery_generation):
                        return False
                    self.store.delete_thread(thread.thread_id)
        if not self._recovery_generation_is_active(recovery_generation):
            return False
        self._prune_inactive_leases()
        return True

    def _recover_active_leases(
        self,
        *,
        leases: dict[str, LeaseRecord],
        now: datetime,
        ttl_seconds: int,
        recovery_generation: int | None = None,
    ) -> bool:
        changed = False
        for lease in leases.values():
            if not self._recovery_generation_is_active(recovery_generation):
                return False
            if lease.status != "active":
                continue
            if not self.discard_on_release and not lease.is_orphaned(now=now, ttl_seconds=ttl_seconds):
                continue
            thread = self.store.read_thread(lease.thread_id)
            released_at = _now()
            if not self._recovery_generation_is_active(recovery_generation):
                return False
            self.store.write_lease(
                lease.model_copy(update={"status": "released", "released_at": released_at, "last_seen_at": released_at})
            )
            changed = True
            if thread is None:
                continue
            if self.discard_on_release or thread.retire_on_release:
                if not self._recovery_generation_is_active(recovery_generation):
                    return False
                self.store.delete_thread(thread.thread_id)
            elif self._thread_is_usable_for_recovery(thread):
                if not self._recovery_generation_is_active(recovery_generation):
                    return False
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
                if not self._recovery_generation_is_active(recovery_generation):
                    return False
                self.store.delete_thread(thread.thread_id)
        if changed:
            if not self._recovery_generation_is_active(recovery_generation):
                return False
            self._write_catalog()
        return True

    def _recover_leased_threads_without_active_lease(
        self,
        *,
        threads: dict[str, ThreadRecord],
        active_lease_by_thread_id: dict[str, LeaseRecord],
        recovery_generation: int | None = None,
    ) -> bool:
        changed = False
        for thread in threads.values():
            if not self._recovery_generation_is_active(recovery_generation):
                return False
            if thread.status != "leased" or active_lease_by_thread_id.get(thread.thread_id):
                continue
            recovered_at = _now()
            changed = True
            if self.discard_on_release or thread.retire_on_release:
                if not self._recovery_generation_is_active(recovery_generation):
                    return False
                self.store.delete_thread(thread.thread_id)
            elif self._thread_is_usable_for_recovery(thread):
                if not self._recovery_generation_is_active(recovery_generation):
                    return False
                self.store.write_thread(
                    thread.model_copy(
                        update={
                            "status": "idle",
                            "lease_id": None,
                            "retire_on_release": False,
                            "updated_at": recovered_at,
                            "last_validated_at": recovered_at,
                        }
                    )
                )
            else:
                if not self._recovery_generation_is_active(recovery_generation):
                    return False
                self.store.delete_thread(thread.thread_id)
        if changed:
            if not self._recovery_generation_is_active(recovery_generation):
                return False
            self._write_catalog()
        return True

    def _recovery_generation_is_active(self, recovery_generation: int | None) -> bool:
        if recovery_generation is None:
            return True
        checker = getattr(self, "_recovery_generation_is_current", None)
        return bool(checker(recovery_generation)) if callable(checker) else True

    def _thread_exists_for_recovery(self, thread: ThreadRecord) -> bool:
        client = self._client_for_thread(thread)
        exists = getattr(client, "thread_exists", None)
        if callable(exists):
            return bool(exists(thread.thread_id))
        return bool(client.validate_thread(thread.thread_id))

    def _thread_is_usable_for_recovery(self, thread: ThreadRecord) -> bool:
        client = self._client_for_thread(thread)
        validate = getattr(client, "validate_thread", None)
        if callable(validate):
            return bool(validate(thread.thread_id))
        return self._thread_exists_for_recovery(thread)

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
            if thread.retire_on_release or not self._client_for_thread(thread).validate_thread(thread.thread_id):
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
