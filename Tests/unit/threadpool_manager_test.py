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


class ThreadPoolManagerTests(unittest.TestCase):
    def test_health_and_status_return_while_seed_collect_is_waiting(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "thread_pool": { "discard_on_release": false },
                  "roles": {
                    "shot-boundary-transformer": {
                      "min_idle": 1,
                      "init_prompt": "ready",
                      "init_ready_text": "ready"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            client = BlockingInitClient()
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=client,
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager._schedule_ensure_min_idle = lambda role_name: None
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="idle_thread_1",
                    role="shot-boundary-transformer",
                    status="idle",
                    is_seed=False,
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager._write_catalog()

            worker = threading.Thread(target=lambda: manager.acquire(role="shot-boundary-transformer", owner_id="trace_1"))
            worker.start()
            self.assertTrue(client.validate_started.wait(timeout=1.0))

            started_at = time.monotonic()
            health = manager.health_payload()
            status = manager.get_role_status("shot-boundary-transformer")
            duration = time.monotonic() - started_at

            client.release_validate.set()
            worker.join(timeout=2.0)
            manager.close()

            self.assertLess(duration, 0.5)
            self.assertNotIn("shot-boundary-transformer", health["warming_roles"])
            self.assertNotIn("shot-boundary-transformer", health["replenishing_roles"])
            self.assertFalse(status["warming"])
            self.assertFalse(status["replenishing"])
            self.assertTrue(status["can_acquire"])
            self.assertEqual(status["counts"]["idle"], 1)

    def test_initializing_seed_reports_warming_without_waiting(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "roles": {
                    "shot-boundary-transformer": {
                      "min_idle": 1,
                      "init_prompt": "ready",
                      "init_ready_text": "ready"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            client = BlockingInitClient()
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=client,
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager._schedule_ensure_min_idle = lambda role_name: None
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="seed_thread_1",
                    role="shot-boundary-transformer",
                    status="initializing",
                    is_seed=True,
                    init_turn_id="seed_turn_1",
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager._write_catalog()

            started_at = time.monotonic()
            health = manager.health_payload()
            status = manager.get_role_status("shot-boundary-transformer")
            duration = time.monotonic() - started_at
            manager.close()

            self.assertLess(duration, 0.5)
            self.assertIn("shot-boundary-transformer", health["warming_roles"])
            self.assertTrue(status["warming"])
            self.assertFalse(status["can_acquire"])
            self.assertIn("waiting for seed initialization", status["warmup_detail"])

    def test_initializing_seed_reports_warming_even_when_idle_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "roles": {
                    "shot-boundary-transformer": {
                      "min_idle": 1,
                      "init_prompt": "ready",
                      "init_ready_text": "ready"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            client = BlockingInitClient()
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=client,
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager._schedule_ensure_min_idle = lambda role_name: None
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="seed_thread_1",
                    role="shot-boundary-transformer",
                    status="initializing",
                    is_seed=True,
                    init_turn_id="seed_turn_1",
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager.store.write_thread(build_idle_thread(manager, "idle_thread_1"))
            manager._write_catalog()

            health = manager.health_payload()
            status = manager.get_role_status("shot-boundary-transformer")
            manager.close()

            self.assertIn("shot-boundary-transformer", health["warming_roles"])
            self.assertNotIn("shot-boundary-transformer", health["replenishing_roles"])
            self.assertTrue(status["warming"])
            self.assertFalse(status["replenishing"])
            self.assertFalse(status["can_acquire"])
            self.assertEqual(status["counts"]["idle"], 1)

    def test_seed_fingerprint_change_ignores_old_idle_until_new_seed_forks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "roles": {
                    "shot-boundary-transformer": {
                      "min_idle": 1,
                      "init_prompt": "ready",
                      "init_ready_text": "ready"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            client = BlockingInitClient()
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=client,
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager._schedule_ensure_min_idle = lambda role_name: None
            config = manager.roles["shot-boundary-transformer"]
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="seed_thread_new",
                    role="shot-boundary-transformer",
                    status="initializing",
                    is_seed=True,
                    init_turn_id="seed_turn_1",
                    init_fingerprint=manager._role_init_fingerprint(config),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="idle_thread_old",
                    role="shot-boundary-transformer",
                    status="idle",
                    is_seed=False,
                    init_fingerprint="old-fingerprint",
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager._write_catalog()

            status = manager.get_role_status("shot-boundary-transformer")
            manager.close()

            self.assertTrue(status["warming"])
            self.assertFalse(status["can_acquire"])
            self.assertEqual(status["counts"]["idle"], 0)

    def test_acquire_promotes_completed_initializing_seed_before_lease(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "roles": {
                    "shot-boundary-transformer": {
                      "min_idle": 1,
                      "init_prompt": "ready",
                      "init_ready_text": "ready"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            client = CompletedInitClient()
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=client,
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager._schedule_ensure_min_idle = lambda role_name: None
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="seed_thread_1",
                    role="shot-boundary-transformer",
                    status="initializing",
                    is_seed=True,
                    init_turn_id="seed_turn_1",
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager._write_catalog()

            lease = manager.acquire(role="shot-boundary-transformer", owner_id="trace_1")
            seed = manager.store.read_thread("seed_thread_1")
            fork = manager.store.read_thread(lease["thread_id"])
            leases = manager.store.list_leases()
            manager.close()

            self.assertEqual(client.wait_calls, 1)
            self.assertEqual(client.fork_calls, 1)
            self.assertEqual(lease["thread_id"], "fork_1")
            self.assertIsNotNone(seed)
            self.assertEqual(seed.status, "idle")
            self.assertIsNone(seed.init_turn_id)
            self.assertIsNotNone(fork)
            self.assertEqual(fork.status, "leased")
            self.assertEqual(len(leases), 1)

    def test_role_status_promotes_completed_initializing_seed_without_waiting(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "roles": {
                    "shot-boundary-transformer": {
                      "min_idle": 1,
                      "init_prompt": "ready",
                      "init_ready_text": "ready"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            client = CompletedInitClient()
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=client,
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="seed_thread_1",
                    role="shot-boundary-transformer",
                    status="initializing",
                    is_seed=True,
                    init_turn_id="seed_turn_1",
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager._write_catalog()

            status = manager.get_role_status("shot-boundary-transformer")
            seed = manager.store.read_thread("seed_thread_1")
            manager.close()

            self.assertEqual(client.collect_calls, 1)
            self.assertIsNotNone(seed)
            self.assertEqual(seed.status, "idle")
            self.assertFalse(status["warming"])
            self.assertFalse(status["can_acquire"])

    def test_min_idle_replenishment_reports_warming_and_blocks_readiness(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "thread_pool": { "discard_on_release": false },
                  "roles": {
                    "shot-boundary-transformer": {
                      "min_idle": 1,
                      "init_prompt": "ready",
                      "init_ready_text": "ready"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            client = BlockingInitClient()
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=client,
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="seed_thread_1",
                    role="shot-boundary-transformer",
                    status="idle",
                    is_seed=True,
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager._warming_roles.add("shot-boundary-transformer")
            manager._warmup_details["shot-boundary-transformer"] = "creating idle thread 1/1 from seed seed_thread_1"
            manager._write_catalog()

            health = manager.health_payload()
            status = manager.get_role_status("shot-boundary-transformer")
            manager.close()

            self.assertIn("shot-boundary-transformer", health["warming_roles"])
            self.assertEqual(health["replenishing_roles"], [])
            self.assertTrue(status["warming"])
            self.assertFalse(status["replenishing"])
            self.assertFalse(status["can_acquire"])
            self.assertEqual(status["counts"]["idle"], 0)

    def test_acquire_precreates_spare_idle_before_leasing_last_idle_thread(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "thread_pool": { "discard_on_release": false },
                  "roles": {
                    "shot-boundary-transformer": {
                      "min_idle": 1,
                      "init_prompt": "ready",
                      "init_ready_text": "ready"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            client = ReusableThreadClient()
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=client,
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager._schedule_ensure_min_idle = lambda role_name: None
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="seed_thread_1",
                    role="shot-boundary-transformer",
                    status="idle",
                    is_seed=True,
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager.store.write_thread(build_idle_thread(manager, "idle_thread_1"))
            manager._write_catalog()

            lease = manager.acquire(role="shot-boundary-transformer", owner_id="trace_1")
            status = manager.get_role_status("shot-boundary-transformer")
            manager.close()

            self.assertEqual(lease["thread_id"], "idle_thread_1")
            self.assertEqual(client.fork_calls, 0)
            self.assertEqual(status["counts"]["leased"], 1)
            self.assertEqual(status["counts"]["idle"], 0)
            self.assertFalse(status["can_acquire"])

    def test_discard_on_release_keeps_thread_reusable_during_same_service_lifetime(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "thread_pool": { "discard_on_release": true },
                  "roles": {
                    "shot-boundary-transformer": {
                      "min_idle": 1,
                      "init_prompt": "ready",
                      "init_ready_text": "ready"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=ReusableThreadClient(),
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager._schedule_ensure_min_idle = lambda role_name: None
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="seed_thread_1",
                    role="shot-boundary-transformer",
                    status="idle",
                    is_seed=True,
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager.store.write_thread(build_idle_thread(manager, "idle_thread_1"))
            manager._write_catalog()

            first_lease = manager.acquire(role="shot-boundary-transformer", owner_id="trace_1")
            first_release = manager.release(lease_id=first_lease["lease_id"], owner_id="trace_1")
            released_thread = manager.store.read_thread("idle_thread_1")
            second_lease = manager.acquire(role="shot-boundary-transformer", owner_id="trace_2")
            manager.close()

            self.assertEqual(first_release["thread_status"], "idle")
            self.assertIsNotNone(released_thread)
            self.assertEqual(released_thread.status, "idle")
            self.assertEqual(released_thread.lease_count, 1)
            self.assertEqual(second_lease["thread_id"], "idle_thread_1")

    def test_discard_on_release_drops_used_idle_threads_during_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "thread_pool": { "discard_on_release": true },
                  "roles": {
                    "shot-boundary-transformer": {
                      "min_idle": 1,
                      "init_prompt": "ready",
                      "init_ready_text": "ready"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=ReusableThreadClient(),
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager.store.write_thread(build_idle_thread(manager, "used_thread_1", lease_count=1))

            manager._recover_state()
            manager.close()

            self.assertIsNone(manager.store.read_thread("used_thread_1"))


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


if __name__ == "__main__":
    unittest.main()
