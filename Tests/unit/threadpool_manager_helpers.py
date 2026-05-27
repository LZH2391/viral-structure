from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Infrastructure" / "AgentRuntime"))

from agent_runtime.threadpool.manager import ThreadPoolManager  # noqa: E402
from agent_runtime.threadpool.models import ThreadRecord  # noqa: E402


def fresh_timestamp() -> str:
    return datetime.now().astimezone().isoformat()


class BlockingInitClient:
    init_timeout_seconds = 90.0

    def __init__(self) -> None:
        self.validate_started = threading.Event()
        self.release_validate = threading.Event()

    def start(self) -> None:
        return None

    def close(self) -> None:
        return None

    def thread_exists(self, thread_id: str) -> bool:
        return True

    def validate_thread(self, thread_id: str) -> bool:
        self.validate_started.set()
        self.release_validate.wait(timeout=2.0)
        return True

    def start_initialized_thread(self, init_prompt, skill_path):
        return SimpleNamespace(thread_id="seed_thread_1", turn_id="seed_turn_1")

    def collect_turn_result(self, thread_id: str, turn_id: str):
        return SimpleNamespace(status="running", final_message="")


class CompletedInitClient:
    init_timeout_seconds = 90.0

    def __init__(self) -> None:
        self.wait_calls = 0
        self.collect_calls = 0
        self.fork_calls = 0

    def start(self) -> None:
        return None

    def close(self) -> None:
        return None

    def thread_exists(self, thread_id: str) -> bool:
        return True

    def validate_thread(self, thread_id: str) -> bool:
        return True

    def wait_turn_result(self, thread_id: str, turn_id: str, timeout_seconds: float | None = None):
        self.wait_calls += 1
        return SimpleNamespace(status="completed", final_message="ready")

    def collect_turn_result(self, thread_id: str, turn_id: str):
        self.collect_calls += 1
        return SimpleNamespace(status="completed", final_message="ready")

    def fork_initialized_thread(self, seed_thread_id: str) -> str:
        self.fork_calls += 1
        return f"fork_{self.fork_calls}"


class ReusableThreadClient:
    init_timeout_seconds = 90.0

    def __init__(self) -> None:
        self.fork_calls = 0

    def start(self) -> None:
        return None

    def close(self) -> None:
        return None

    def thread_exists(self, thread_id: str) -> bool:
        return True

    def validate_thread(self, thread_id: str) -> bool:
        return True

    def fork_initialized_thread(self, seed_thread_id: str) -> str:
        self.fork_calls += 1
        return f"fork_{self.fork_calls}"


class ExistingButUnusableThreadClient(ReusableThreadClient):
    def thread_exists(self, thread_id: str) -> bool:
        return True

    def validate_thread(self, thread_id: str) -> bool:
        return False

def configure_started_manager(manager: ThreadPoolManager) -> None:
    raw = manager._load_config()
    manager.discard_on_release = manager._load_discard_on_release(raw)
    manager.roles = manager._load_roles(raw)
    manager._started = True
    manager._recovering = False
    manager._ready_for_leases = True
    manager._startup_error = None
    manager._warmup_errors = {}
    manager._warmup_details = {}
    manager._warming_roles = set()
    manager._replenishing_roles = set()
    manager._write_catalog()


def build_idle_thread(manager: ThreadPoolManager, thread_id: str, *, lease_count: int = 0) -> ThreadRecord:
    return ThreadRecord(
        thread_id=thread_id,
        role="shot-boundary-transformer",
        status="idle",
        is_seed=False,
        lease_count=lease_count,
        init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
        created_at=fresh_timestamp(),
        updated_at=fresh_timestamp(),
        last_validated_at=fresh_timestamp(),
    )
