from __future__ import annotations

from datetime import datetime

from .models import LeaseRecord, ThreadRecord

MAX_INACTIVE_LEASE_RECORDS = 64


def _now() -> str:
    return datetime.now().astimezone().isoformat()


class ThreadPoolLeaseStoreMixin:
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
                    if self._thread_exists_for_recovery(thread):
                        self.store.write_thread(thread.model_copy(update={"updated_at": _now()}))
                    else:
                        self.store.delete_thread(thread.thread_id)
                    continue
                if self._thread_is_usable_for_recovery(thread):
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
                if self._thread_is_usable_for_recovery(thread):
                    self.store.write_thread(thread.model_copy(update={"last_validated_at": _now(), "updated_at": _now()}))
                else:
                    self.store.delete_thread(thread.thread_id)
        for lease in leases.values():
            if not self.discard_on_release and not lease.is_orphaned(now=now, ttl_seconds=ttl_seconds):
                continue
            thread = self.store.read_thread(lease.thread_id)
            released_at = _now()
            self.store.write_lease(
                lease.model_copy(update={"status": "released", "released_at": released_at, "last_seen_at": released_at})
            )
            if thread is None:
                continue
            if self.discard_on_release or thread.retire_on_release:
                self.store.delete_thread(thread.thread_id)
            elif self._thread_is_usable_for_recovery(thread):
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
