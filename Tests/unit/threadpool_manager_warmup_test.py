from __future__ import annotations

import tempfile
import threading
import time
import unittest

from threadpool_manager_helpers import *  # noqa: F403


class ThreadPoolManagerWarmupTests(unittest.TestCase):
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
            self.assertTrue(status["can_acquire"])


if __name__ == "__main__":
    unittest.main()
