from __future__ import annotations

import tempfile
import threading
import time
import unittest

from threadpool_manager_helpers import *  # noqa: F403
from agent_runtime.threadpool.models import LeaseRecord  # noqa: E402
from agent_runtime.threadpool.role_profile import load_role_profile  # noqa: E402


class ThreadPoolManagerRecoveryStateTests(unittest.TestCase):
    def test_role_discard_on_release_false_recovers_leased_thread_without_active_lease(self) -> None:
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
            config = manager.roles["persistent-role"]
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="persistent_leased_thread_1",
                    role="persistent-role",
                    status="leased",
                    is_seed=False,
                    lease_id="missing_lease_1",
                    lease_count=1,
                    init_fingerprint=manager._role_init_fingerprint(config),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )

            manager._recover_state()
            thread = manager.store.read_thread("persistent_leased_thread_1")
            manager.close()

            self.assertIsNotNone(thread)
            self.assertEqual(thread.status, "idle")
            self.assertIsNone(thread.lease_id)

    def test_recovery_releases_active_lease_before_thread_validation(self) -> None:
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
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="leased_thread_1",
                    role="shot-boundary-transformer",
                    status="leased",
                    is_seed=False,
                    lease_id="lease_1",
                    lease_count=1,
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager.store.write_lease(
                LeaseRecord(
                    lease_id="lease_1",
                    role="shot-boundary-transformer",
                    owner_id="trace_1",
                    thread_id="leased_thread_1",
                    status="active",
                    created_at=fresh_timestamp(),
                    last_seen_at=fresh_timestamp(),
                )
            )

            manager._recover_state()
            lease = manager.store.read_lease("lease_1")
            thread = manager.store.read_thread("leased_thread_1")
            manager.close()

            self.assertIsNotNone(lease)
            self.assertEqual(lease.status, "released")
            self.assertIsNotNone(thread)
            self.assertEqual(thread.status, "retired")
            self.assertIsNone(thread.lease_id)

    def test_recovery_retires_leased_thread_without_active_lease(self) -> None:
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
            manager.store.write_thread(
                ThreadRecord(
                    thread_id="stale_leased_thread_1",
                    role="shot-boundary-transformer",
                    status="leased",
                    is_seed=False,
                    lease_id="missing_lease_1",
                    lease_count=1,
                    init_fingerprint=manager._role_init_fingerprint(manager.roles["shot-boundary-transformer"]),
                    created_at=fresh_timestamp(),
                    updated_at=fresh_timestamp(),
                    last_validated_at=fresh_timestamp(),
                )
            )
            manager.store.write_lease(
                LeaseRecord(
                    lease_id="old_lease_1",
                    role="shot-boundary-transformer",
                    owner_id="trace_1",
                    thread_id="stale_leased_thread_1",
                    status="released",
                    created_at=fresh_timestamp(),
                    last_seen_at=fresh_timestamp(),
                    released_at=fresh_timestamp(),
                )
            )

            manager._recover_state()
            thread = manager.store.read_thread("stale_leased_thread_1")
            manager.close()

            self.assertIsNotNone(thread)
            self.assertEqual(thread.status, "retired")
            self.assertIsNone(thread.lease_id)

    def test_recovery_drops_idle_threads_that_exist_but_cannot_be_resumed(self) -> None:
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
            manager = ThreadPoolManager(
                workspace_root=root,
                config_path=config_path,
                state_root=root / "state",
                client=ExistingButUnusableThreadClient(),
                async_warmup=True,
            )
            configure_started_manager(manager)
            manager.store.write_thread(build_idle_thread(manager, "stale_idle_thread_1"))

            manager._recover_state()
            manager.close()

            self.assertIsNone(manager.store.read_thread("stale_idle_thread_1"))


if __name__ == "__main__":
    unittest.main()


if __name__ == "__main__":
    unittest.main()
