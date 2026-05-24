from __future__ import annotations

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
                    "shot-boundary-reviewer": {
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
                    role="shot-boundary-reviewer",
                    status="idle",
                    is_seed=False,
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-reviewer"]),
                    created_at="2026-05-24T10:00:00+08:00",
                    updated_at="2026-05-24T10:00:00+08:00",
                    last_validated_at="2026-05-24T10:00:00+08:00",
                )
            )
            manager._write_catalog()

            worker = threading.Thread(target=lambda: manager.acquire(role="shot-boundary-reviewer", owner_id="trace_1"))
            worker.start()
            self.assertTrue(client.validate_started.wait(timeout=1.0))

            started_at = time.monotonic()
            health = manager.health_payload()
            status = manager.get_role_status("shot-boundary-reviewer")
            duration = time.monotonic() - started_at

            client.release_validate.set()
            worker.join(timeout=2.0)
            manager.close()

            self.assertLess(duration, 0.5)
            self.assertEqual(health["warming_roles"], [])
            self.assertFalse(status["warming"])
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
                    "shot-boundary-reviewer": {
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
                    role="shot-boundary-reviewer",
                    status="initializing",
                    is_seed=True,
                    init_turn_id="seed_turn_1",
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-reviewer"]),
                    created_at="2026-05-24T10:00:00+08:00",
                    updated_at="2026-05-24T10:00:00+08:00",
                    last_validated_at="2026-05-24T10:00:00+08:00",
                )
            )
            manager._write_catalog()

            started_at = time.monotonic()
            health = manager.health_payload()
            status = manager.get_role_status("shot-boundary-reviewer")
            duration = time.monotonic() - started_at
            manager.close()

            self.assertLess(duration, 0.5)
            self.assertIn("shot-boundary-reviewer", health["warming_roles"])
            self.assertTrue(status["warming"])
            self.assertFalse(status["can_acquire"])
            self.assertIn("waiting for seed initialization", status["warmup_detail"])


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
    manager._write_catalog()


if __name__ == "__main__":
    unittest.main()
