from __future__ import annotations

from copy import deepcopy
from typing import Any

from ..storage import file_lock, read_json, write_json


class AppServerTokenUsageMixin:

    def _merge_cached_turn_token_usage(self, thread: dict[str, Any], *, persist: bool = False) -> None:
        thread_id = str(thread.get("id") or "")
        turns = thread.get("turns")
        if not thread_id or not isinstance(turns, list):
            return
        with self._state_lock:
            cached = deepcopy(self._thread_token_usage.get(thread_id, {}))
            cached_by_turn = dict(cached.get("turns") or {})
            latest_usage = self._normalize_thread_token_usage(
                thread.get("last_token_usage") or thread.get("lastTokenUsage") or thread.get("tokenUsage")
            ) or cached.get("latest")
            changed = False
            for turn in turns:
                if not isinstance(turn, dict):
                    continue
                turn_id = str(turn.get("id") or "")
                if not turn_id:
                    continue
                existing_usage = self._normalize_turn_last_token_usage(turn)
                if existing_usage is not None:
                    if cached_by_turn.get(turn_id) != existing_usage:
                        cached_by_turn[turn_id] = existing_usage
                        changed = True
                    latest_usage = existing_usage
                    continue
                cached_usage = cached_by_turn.get(turn_id)
                if cached_usage is None:
                    continue
                turn.update(dict(cached_usage))
                latest_usage = cached_usage
            if latest_usage is not None and cached.get("latest") != latest_usage:
                changed = True
            if persist and (changed or thread_id not in self._thread_token_usage):
                self._thread_token_usage[thread_id] = {
                    "turns": cached_by_turn,
                    "latest": deepcopy(latest_usage),
                }
                self._persist_thread_token_usage()

    def _upsert_thread_token_usage(self, thread_id: str, turn_id: str, token_usage: dict[str, Any]) -> None:
        with self._state_lock:
            cache = self._thread_token_usage.setdefault(thread_id, {"turns": {}, "latest": None})
            turns = cache.setdefault("turns", {})
            if turns.get(turn_id) != token_usage:
                turns[turn_id] = deepcopy(token_usage)
            if cache.get("latest") != token_usage:
                cache["latest"] = deepcopy(token_usage)
            self._persist_thread_token_usage()

    def _clone_thread_token_usage(self, source_thread_id: str, thread_id: str) -> None:
        with self._state_lock:
            source = self._thread_token_usage.get(source_thread_id)
            if not source:
                return
            self._thread_token_usage[thread_id] = {
                "turns": deepcopy(source.get("turns") or {}),
                "latest": deepcopy(source.get("latest")),
            }
            self._persist_thread_token_usage()

    def _load_thread_token_usage(self) -> dict[str, dict[str, Any]]:
        try:
            payload = read_json(self._thread_token_usage_path)
        except FileNotFoundError:
            return {}
        except Exception:
            return {}
        if not isinstance(payload, dict):
            return {}
        cache: dict[str, dict[str, Any]] = {}
        for thread_id, entry in payload.items():
            if not isinstance(entry, dict):
                continue
            turns = entry.get("turns")
            latest = entry.get("latest")
            if not isinstance(turns, dict):
                turns = {}
            normalized_turns: dict[str, dict[str, Any]] = {}
            for turn_id, usage in turns.items():
                normalized_usage = self._normalize_persisted_thread_token_usage(usage)
                if normalized_usage is not None:
                    normalized_turns[str(turn_id)] = normalized_usage
            normalized_latest = self._normalize_persisted_thread_token_usage(latest)
            if normalized_latest is None and normalized_turns:
                normalized_latest = deepcopy(next(reversed(list(normalized_turns.values()))))
            if normalized_turns or normalized_latest is not None:
                cache[str(thread_id)] = {
                    "turns": normalized_turns,
                    "latest": normalized_latest,
                }
        return cache

    def _persist_thread_token_usage(self) -> None:
        try:
            with file_lock(self._thread_token_usage_lock_path):
                write_json(self._thread_token_usage_path, self._thread_token_usage)
        except Exception:
            return

    @classmethod
    def _normalize_persisted_thread_token_usage(cls, payload: Any) -> dict[str, Any] | None:
        if isinstance(payload, dict) and ("last_token_usage" in payload or "total_token_usage" in payload):
            return deepcopy(payload)
        return cls._normalize_thread_token_usage(payload)

