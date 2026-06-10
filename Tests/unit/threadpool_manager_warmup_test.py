from __future__ import annotations

import tempfile
import threading
import time
import unittest

from threadpool_manager_helpers import *  # noqa: F403


class ThreadPoolManagerWarmupTests(unittest.TestCase):
    def test_background_warmup_limits_concurrent_roles_to_five(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            roles_json = ",\n".join(
                f'"role-{index}": {{"min_idle": 1, "init_prompt": "ready", "init_ready_text": "ready"}}'
                for index in range(8)
            )
            config_path.write_text(
                f"""
                {{
                  "roles": {{
                    {roles_json}
                  }}
                }}
                """,
                encoding="utf-8",
            )
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=ReusableThreadClient(),
                async_warmup=True,
                warmup_concurrency_limit=5,
            )
            configure_started_manager(manager)
            lock = threading.Lock()
            entered_limit = threading.Event()
            release_workers = threading.Event()
            active_count = 0
            max_active_count = 0
            ensure_calls = 0

            def fake_ensure_min_idle(role_name: str, *, wait_for_ready: bool) -> bool:
                nonlocal active_count, max_active_count, ensure_calls
                with lock:
                    active_count += 1
                    ensure_calls += 1
                    max_active_count = max(max_active_count, active_count)
                    if active_count == 5:
                        entered_limit.set()
                release_workers.wait(timeout=2.0)
                with lock:
                    active_count -= 1
                return True

            manager._ensure_min_idle = fake_ensure_min_idle
            for role_name in manager.roles:
                manager._schedule_ensure_min_idle(role_name)

            self.assertTrue(entered_limit.wait(timeout=1.0))
            time.sleep(0.1)
            with lock:
                self.assertEqual(active_count, 5)
                self.assertEqual(max_active_count, 5)
                self.assertEqual(ensure_calls, 5)

            release_workers.set()
            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                with manager._lock:
                    if not manager._warming_roles:
                        break
                time.sleep(0.02)
            manager.close()

            with lock:
                self.assertEqual(ensure_calls, 8)
                self.assertLessEqual(max_active_count, 5)

    def test_health_marks_recovery_stalled_when_background_thread_dies(self) -> None:
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
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=ReusableThreadClient(),
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager._recovering = True
            manager._ready_for_leases = False
            manager._startup_error = None
            manager._startup_started_at = time.monotonic() - 1
            manager._startup_thread = threading.Thread(target=lambda: None)

            health = manager.health_payload()
            status = manager.get_role_status("shot-boundary-transformer")
            manager.close()

            self.assertFalse(health["recovering"])
            self.assertFalse(health["ready_for_leases"])
            self.assertTrue(health["startup_stalled"])
            self.assertFalse(health["startup_thread_alive"])
            self.assertIn("ThreadPoolStartupStalled", health["startup_error"])
            self.assertFalse(status["recovering"])
            self.assertFalse(status["can_acquire"])
            self.assertIn("ThreadPoolStartupStalled", status["startup_error"])

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


if __name__ == "__main__":
    unittest.main()
