from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Mapping
from typing import Any


AE_APPSERVER_CODEX_HOME_ENV = "AE_APPSERVER_CODEX_HOME"
AE_APPSERVER_APPDATA_ENV = "AE_APPSERVER_APPDATA"
AE_APPSERVER_LOCALAPPDATA_ENV = "AE_APPSERVER_LOCALAPPDATA"
CODEX_SWITCHER_HOME_ENV = "CODEX_SWITCHER_HOME"
DEFAULT_CODEX_SWITCHER_HOME = Path(r"C:\Codex处理\CodexV2-Plan1-CODEX_HOME\package\CodexSwitcherV2")


def _windows_profile_root_from_path(path_value: Path | str | None) -> Path | None:
    if path_value is None:
        return None
    path = Path(path_value).resolve()
    parts = path.parts
    lowered = [part.casefold() for part in parts]
    for index, part in enumerate(lowered):
        if part != "users":
            continue
        if index + 1 >= len(parts):
            continue
        return Path(*parts[: index + 2]).resolve()
    return None


def _profile_root_from_env(env: Mapping[str, str]) -> Path | None:
    codex_home = str(env.get("CODEX_HOME") or "").strip()
    if codex_home:
        profile_root = _windows_profile_root_from_path(codex_home)
        if profile_root is not None:
            return profile_root
    for env_name in ("USERPROFILE", "HOME", "APPDATA"):
        raw = str(env.get(env_name) or "").strip()
        if not raw:
            continue
        profile_root = _windows_profile_root_from_path(raw)
        if profile_root is not None:
            return profile_root
    return None


def workspace_owner_profile_root(
    workspace_root: Path | str | None = None,
    *,
    base_env: Mapping[str, str] | None = None,
) -> Path:
    env = dict(base_env or os.environ)
    profile_root = _profile_root_from_env(env)
    if profile_root is not None:
        return profile_root
    workspace_profile_root = _windows_profile_root_from_path(workspace_root)
    if workspace_profile_root is not None:
        return workspace_profile_root
    fallback = str(env.get("USERPROFILE") or "").strip()
    return Path(fallback or Path.home()).resolve()


def _read_json_object(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(payload, dict):
        return payload
    return None


def _codex_switcher_roots(env: Mapping[str, str]) -> list[Path]:
    roots: list[Path] = []
    explicit = str(env.get(CODEX_SWITCHER_HOME_ENV) or "").strip()
    if explicit:
        roots.append(Path(explicit))
    roots.append(DEFAULT_CODEX_SWITCHER_HOME)

    unique_roots: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root).casefold()
        if key in seen:
            continue
        seen.add(key)
        unique_roots.append(root)
    return unique_roots


def _active_codex_switcher_profile(env: Mapping[str, str]) -> dict[str, str] | None:
    for root in _codex_switcher_roots(env):
        payload = _read_json_object(root / "active_profile.json")
        if payload is None:
            continue
        codex_home = str(payload.get("codex_home") or "").strip()
        if not codex_home:
            continue
        return {
            "codex_home": codex_home,
            "appdata_root": str(payload.get("appdata_root") or "").strip(),
            "localappdata_root": str(payload.get("localappdata_root") or "").strip(),
        }
    return None


def _apply_appserver_codex_environment(env: dict[str, str], profile_root: Path) -> None:
    override_codex_home = str(env.get(AE_APPSERVER_CODEX_HOME_ENV) or "").strip()
    if override_codex_home:
        env["CODEX_HOME"] = override_codex_home
        override_appdata = str(env.get(AE_APPSERVER_APPDATA_ENV) or "").strip()
        override_localappdata = str(env.get(AE_APPSERVER_LOCALAPPDATA_ENV) or "").strip()
        if override_appdata:
            env["APPDATA"] = override_appdata
        if override_localappdata:
            env["LOCALAPPDATA"] = override_localappdata
        return

    codex_home = str(env.get("CODEX_HOME") or "").strip()
    if codex_home:
        env["CODEX_HOME"] = codex_home
        return

    active_profile = _active_codex_switcher_profile(env)
    if active_profile is not None:
        env["CODEX_HOME"] = active_profile["codex_home"]
        if active_profile["appdata_root"]:
            env["APPDATA"] = active_profile["appdata_root"]
        if active_profile["localappdata_root"]:
            env["LOCALAPPDATA"] = active_profile["localappdata_root"]
        return

    env["CODEX_HOME"] = str(profile_root / ".codex")


def build_codex_subprocess_env(
    workspace_root: Path | str | None = None,
    *,
    base_env: Mapping[str, str] | None = None,
) -> dict[str, str]:
    env = dict(base_env or os.environ)
    profile_root = workspace_owner_profile_root(workspace_root, base_env=env)
    appdata_root = profile_root / "AppData" / "Roaming"
    localappdata_root = profile_root / "AppData" / "Local"
    env["HOME"] = str(profile_root)
    env["USERPROFILE"] = str(profile_root)
    env["APPDATA"] = str(appdata_root)
    env["LOCALAPPDATA"] = str(localappdata_root)
    drive = profile_root.drive
    if drive:
        env["HOMEDRIVE"] = drive
        env["HOMEPATH"] = str(profile_root)[len(drive) :] or "\\"
    _apply_appserver_codex_environment(env, profile_root)
    return env
