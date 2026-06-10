from __future__ import annotations

from datetime import datetime
from pathlib import Path

from ..appserver.client import AppServerSessionClient
from ..storage import read_json
from .models import RoleConfig, ThreadRecord
from .role_profile import load_role_profile


def _now() -> str:
    return datetime.now().astimezone().isoformat()


class ThreadPoolManagerConfigMixin:
    def _load_config(self) -> dict:
        raw = read_json(self.config_path)
        if not isinstance(raw, dict):
            raise ValueError("thread_roles.json must be a JSON object")
        return raw

    @staticmethod
    def _load_discard_on_release(raw: dict) -> bool:
        payload = raw.get("thread_pool", {})
        if payload is None:
            return True
        if not isinstance(payload, dict):
            raise ValueError("thread_roles.json field 'thread_pool' must be an object")
        value = payload.get("discard_on_release", True)
        if not isinstance(value, bool):
            raise ValueError("thread_roles.json field 'thread_pool.discard_on_release' must be a boolean")
        return value

    def _load_roles(self, raw: dict) -> dict[str, RoleConfig]:
        role_map = raw.get("roles", {})
        if not isinstance(role_map, dict):
            raise ValueError("thread_roles.json must contain object field 'roles'")
        roles: dict[str, RoleConfig] = {}
        for role_name, payload in role_map.items():
            if not isinstance(payload, dict):
                raise ValueError(f"role config must be object: {role_name}")
            normalized_payload = dict(payload)
            profile_path = normalized_payload.get("profile_path")
            if profile_path is not None:
                loaded_profile = load_role_profile(self.workspace_root, role_name, profile_path)
                normalized_payload.update(
                    {
                        "profile_path": str(loaded_profile.profile_path),
                        "profile_version": loaded_profile.profile_version,
                        "workspace_root": loaded_profile.workspace_root,
                        "skill_path": loaded_profile.skill_path,
                        "init_prompt": loaded_profile.init_prompt,
                        "init_ready_text": loaded_profile.init_ready_text,
                        "init_template_path": loaded_profile.init_template_path,
                        "init_template_hash": loaded_profile.init_template_hash,
                    }
                )
            config = RoleConfig.model_validate({"name": role_name, **normalized_payload})
            if not config.init_prompt:
                raise ValueError(f"role init_prompt cannot be empty: {role_name}")
            roles[config.name] = config
        return roles

    def _write_catalog(self) -> None:
        threads = list(self.store.list_threads().values())
        leases = list(self.store.list_leases().values())
        roles_payload: dict[str, dict] = {}
        for role_name in sorted(self.roles.keys()):
            role_threads = sorted(
                (thread for thread in threads if thread.role == role_name),
                key=lambda thread: (thread.is_seed is False, thread.created_at, thread.thread_id),
            )
            role_leases = sorted(
                (lease for lease in leases if lease.role == role_name and lease.status == "active"),
                key=lambda lease: (lease.created_at, lease.lease_id),
            )
            counts = {
                "initializing": 0,
                "idle": 0,
                "leased": 0,
                "retired": 0,
                "discarded": 0,
            }
            config = self.roles.get(role_name)
            for thread in role_threads:
                if thread.is_seed:
                    continue
                if thread.status == "idle" and config is not None and not self._matches_thread_fingerprint(thread, config):
                    continue
                counts[thread.status] = counts.get(thread.status, 0) + 1
            seed_thread = next((thread for thread in role_threads if thread.is_seed and thread.status != "discarded"), None)
            thread_entries = [
                {
                    "thread_id": thread.thread_id,
                    "thread_status": thread.status,
                    "is_seed": thread.is_seed,
                    "lease_id": thread.lease_id,
                    "lease_count": int(thread.lease_count or 0),
                    "retire_on_release": bool(thread.retire_on_release),
                    "discard_reason": thread.discard_reason,
                    "init_turn_id": thread.init_turn_id,
                    "init_fingerprint": thread.init_fingerprint,
                    "created_at": thread.created_at,
                    "updated_at": thread.updated_at,
                    "last_validated_at": thread.last_validated_at,
                }
                for thread in role_threads
            ]
            active_leases = [
                {
                    "lease_id": lease.lease_id,
                    "owner_id": lease.owner_id,
                    "thread_id": lease.thread_id,
                    "status": lease.status,
                    "created_at": lease.created_at,
                    "last_seen_at": lease.last_seen_at,
                    "released_at": lease.released_at,
                }
                for lease in role_leases
            ]
            roles_payload[role_name] = {
                "counts": counts,
                "discard_on_release": self._discard_on_release_for_role(role_name),
                "seed_thread_id": seed_thread.thread_id if seed_thread is not None else None,
                "seed_init_fingerprint": seed_thread.init_fingerprint if seed_thread is not None else None,
                "active_lease_ids": [lease.lease_id for lease in role_leases],
                "active_leases": active_leases,
                "thread_entries": thread_entries,
            }
        self.store.write_catalog(
            {
                "ok": True,
                "service": "thread_pool_service",
                "workspace_root": str(self.workspace_root),
                "config_path": str(self.config_path),
                "state_root": str(self.state_root),
                "transport_url": self.transport_url,
                "discard_on_release": self.discard_on_release,
                "async_warmup": self.async_warmup,
                "warmup_concurrency_limit": self.warmup_concurrency_limit,
                "recovering": self._recovering,
                "ready_for_leases": self._ready_for_leases,
                "startup_error": self._startup_error,
                **self._startup_status_payload(update_catalog=False),
                "roles": roles_payload,
                "reported_at": _now(),
            }
        )

    def _client_for_config(self, config: RoleConfig) -> AppServerSessionClient:
        if not self._owns_client:
            return self.client
        workspace_root = Path(config.workspace_root).resolve() if config.workspace_root else self.workspace_root
        if workspace_root == self.workspace_root:
            return self.client
        key = str(workspace_root)
        role_client = self._role_clients.get(key)
        if role_client is None:
            role_client = AppServerSessionClient(
                workspace_root,
                transport_mode="ws",
                transport_url=self.transport_url,
                request_timeout_seconds=90.0,
                turn_timeout_seconds=90.0,
                init_timeout_seconds=90.0,
            )
            role_client.start()
            self._role_clients[key] = role_client
        return role_client

    def _client_for_thread(self, thread: ThreadRecord) -> AppServerSessionClient:
        config = self.roles.get(thread.role)
        if config is None:
            return self.client
        return self._client_for_config(config)
