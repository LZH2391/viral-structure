from __future__ import annotations

import tempfile
import threading
import time
import unittest

from threadpool_manager_helpers import *  # noqa: F403


class ThreadPoolManagerWarmupForceUpdateTests(unittest.TestCase):
    def test_force_update_seeds_deletes_seed_and_idle_then_retires_leased_threads(self) -> None:
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
            scheduled_roles: list[str] = []
            manager._schedule_ensure_min_idle = lambda role_name: scheduled_roles.append(role_name)
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
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="leased_thread_1",
                    role="shot-boundary-transformer",
                    status="leased",
                    is_seed=False,
                    lease_id="lease_1",
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )

            result = manager.force_update_seeds(reason="test-refresh")
            leased = manager.store.read_thread("leased_thread_1")
            manager.close()

            self.assertEqual(result["deleted_count"], 2)
            self.assertEqual(result["retiring_count"], 1)
            self.assertIsNone(manager.store.read_thread("seed_thread_1"))
            self.assertIsNone(manager.store.read_thread("idle_thread_1"))
            self.assertIsNotNone(leased)
            self.assertTrue(leased.retire_on_release)
            self.assertEqual(leased.discard_reason, "test-refresh")
            self.assertEqual(scheduled_roles, ["shot-boundary-transformer"])

    def test_force_update_seeds_keeps_used_threads_when_release_persistent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "thread_pool": { "discard_on_release": true },
                  "roles": {
                    "persistent-role": {
                      "min_idle": 1,
                      "init_prompt": "ready",
                      "init_ready_text": "ready",
                      "discard_on_release": false
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
            scheduled_roles: list[str] = []
            manager._schedule_ensure_min_idle = lambda role_name: scheduled_roles.append(role_name)
            config = manager.roles["persistent-role"]
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="seed_thread_1",
                    role="persistent-role",
                    status="idle",
                    is_seed=True,
                    init_fingerprint=manager._role_init_fingerprint(config),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="restructure_used_thread_1",
                    role="persistent-role",
                    status="idle",
                    is_seed=False,
                    lease_count=1,
                    init_fingerprint=manager._role_init_fingerprint(config),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="restructure_unused_thread_1",
                    role="persistent-role",
                    status="idle",
                    is_seed=False,
                    init_fingerprint=manager._role_init_fingerprint(config),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )

            result = manager.force_update_seeds(reason="test-refresh", roles=["persistent-role"])
            used = manager.store.read_thread("restructure_used_thread_1")
            manager.close()

            self.assertEqual(result["deleted_count"], 2)
            self.assertEqual(result["retiring_count"], 0)
            self.assertIsNotNone(used)
            self.assertEqual(used.status, "idle")
            self.assertIsNone(manager.store.read_thread("seed_thread_1"))
            self.assertIsNone(manager.store.read_thread("restructure_unused_thread_1"))
            self.assertEqual(scheduled_roles, ["persistent-role"])

    def test_force_update_seeds_invalidates_inflight_startup_recovery_snapshot(self) -> None:
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
            scheduled_roles: list[str] = []
            manager._schedule_ensure_min_idle = lambda role_name: scheduled_roles.append(role_name)
            manager._recovering = True
            manager._ready_for_leases = False
            manager._startup_started_at = time.monotonic()
            manager._startup_finished_at = None
            manager._write_catalog()
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

            recovery_done = threading.Event()

            def run_recovery() -> None:
                try:
                    manager._finish_startup()
                finally:
                    recovery_done.set()

            recovery_thread = threading.Thread(target=run_recovery)
            recovery_thread.start()
            self.assertTrue(client.validate_started.wait(timeout=1.0))

            result = manager.force_update_seeds(reason="test-refresh")
            client.release_validate.set()
            recovery_thread.join(timeout=2.0)
            manager.close()

            self.assertTrue(recovery_done.is_set())
            self.assertEqual(result["deleted_count"], 2)
            self.assertIsNone(manager.store.read_thread("seed_thread_1"))
            self.assertIsNone(manager.store.read_thread("idle_thread_1"))
            self.assertFalse(manager._recovering)
            self.assertTrue(manager._ready_for_leases)
            self.assertEqual(scheduled_roles, ["shot-boundary-transformer"])

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


if __name__ == "__main__":
    unittest.main()
