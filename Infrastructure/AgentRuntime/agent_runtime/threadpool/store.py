from __future__ import annotations

from pathlib import Path

from ..storage import read_json, write_json
from .models import LeaseRecord, ThreadRecord


class ThreadPoolStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.catalog_path = self.root / "catalog.json"
        self.threads_dir = self.root / "threads"
        self.leases_dir = self.root / "leases"
        self.ensure_dirs()

    def ensure_dirs(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.threads_dir.mkdir(parents=True, exist_ok=True)
        self.leases_dir.mkdir(parents=True, exist_ok=True)

    def list_threads(self) -> dict[str, ThreadRecord]:
        records: dict[str, ThreadRecord] = {}
        for path in sorted(self.threads_dir.glob("*.json")):
            try:
                record = ThreadRecord.model_validate(read_json(path))
            except FileNotFoundError:
                continue
            records[record.thread_id] = record
        return records

    def read_thread(self, thread_id: str) -> ThreadRecord | None:
        path = self.threads_dir / f"{thread_id}.json"
        if not path.exists():
            return None
        try:
            return ThreadRecord.model_validate(read_json(path))
        except FileNotFoundError:
            return None

    def write_thread(self, record: ThreadRecord) -> Path:
        return write_json(self.threads_dir / f"{record.thread_id}.json", record.model_dump(mode="json"))

    def delete_thread(self, thread_id: str) -> None:
        path = self.threads_dir / f"{thread_id}.json"
        path.unlink(missing_ok=True)

    def list_leases(self) -> dict[str, LeaseRecord]:
        records: dict[str, LeaseRecord] = {}
        for path in sorted(self.leases_dir.glob("*.json")):
            try:
                record = LeaseRecord.model_validate(read_json(path))
            except FileNotFoundError:
                continue
            records[record.lease_id] = record
        return records

    def read_lease(self, lease_id: str) -> LeaseRecord | None:
        path = self.leases_dir / f"{lease_id}.json"
        if not path.exists():
            return None
        try:
            return LeaseRecord.model_validate(read_json(path))
        except FileNotFoundError:
            return None

    def write_lease(self, record: LeaseRecord) -> Path:
        return write_json(self.leases_dir / f"{record.lease_id}.json", record.model_dump(mode="json"))

    def delete_lease(self, lease_id: str) -> None:
        path = self.leases_dir / f"{lease_id}.json"
        path.unlink(missing_ok=True)

    def write_catalog(self, payload: dict) -> Path:
        return write_json(self.catalog_path, payload)

    def read_catalog(self) -> dict:
        if not self.catalog_path.exists():
            return {}
        try:
            payload = read_json(self.catalog_path)
        except FileNotFoundError:
            return {}
        return payload if isinstance(payload, dict) else {}
