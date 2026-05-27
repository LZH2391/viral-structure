from __future__ import annotations

import tempfile
import threading
import time
import unittest

from threadpool_manager_helpers import *  # noqa: F403


class ThreadPoolManagerRecoveryTests(unittest.TestCase):
    def test_role_profile_workspace_root_is_loaded_into_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            role_workspace = root / "role-workspace"
            profile_dir = root / "Assets" / "RoleProfiles" / "shot-boundary-raw-analyzer"
            profile_dir.mkdir(parents=True)
            role_workspace.mkdir()
            (profile_dir / "init.md").write_text("ready", encoding="utf-8")
            (profile_dir / "role.json").write_text(
                """
                {
                  "role": "shot-boundary-raw-analyzer",
                  "profileVersion": "2026-05-27.test",
                  "workspaceRoot": "__ROLE_WORKSPACE__",
                  "skillPath": "C:/Users/Administrator/Documents/Codex/.agents/skills/video-shot/SKILL.md",
                  "init": {
                    "template": "init.md",
                    "readyText": "ready"
                  },
                  "turnTemplates": {}
                }
                """.replace("__ROLE_WORKSPACE__", str(role_workspace).replace("\\", "/")),
                encoding="utf-8",
            )
            config_path = root / "thread_roles.json"
            config_path.write_text(
                """
                {
                  "thread_pool": { "discard_on_release": false },
                  "roles": {
                    "shot-boundary-raw-analyzer": {
                      "profile_path": "Assets/RoleProfiles/shot-boundary-raw-analyzer/role.json",
                      "min_idle": 1
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
            status = manager.get_role_status("shot-boundary-raw-analyzer")
            manager.close()

            self.assertEqual(manager.roles["shot-boundary-raw-analyzer"].workspace_root, str(role_workspace.resolve()))
            self.assertEqual(status["workspace_root"], str(role_workspace.resolve()))

    def test_min_idle_replenishment_remains_acquirable_when_seed_is_ready(self) -> None:
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

            self.assertNotIn("shot-boundary-transformer", health["warming_roles"])
            self.assertEqual(health["replenishing_roles"], ["shot-boundary-transformer"])
            self.assertFalse(status["warming"])
            self.assertTrue(status["replenishing"])
            self.assertTrue(status["can_acquire"])
            self.assertIn("idle thread", status["warmup_detail"])
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
            self.assertTrue(status["can_acquire"])

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
