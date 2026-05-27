#!/usr/bin/env python3
"""Shared helpers for short-video slot-library scripts."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

CANONICAL_FILENAMES = {
    "manifest": "manifest.json",
    "slots": "slots.json",
    "scriptAtoms": "atoms.script.json",
    "rhythmAtoms": "atoms.rhythm.json",
    "packagingAtoms": "atoms.packaging.json",
    "bindings": "bindings.json",
    "rules": "rules.json",
    "templates": "templates.json",
}

GLOB_PATTERNS = {
    "manifest": "manifest*.json",
    "slots": "slots*.json",
    "scriptAtoms": "atoms.script*.json",
    "rhythmAtoms": "atoms.rhythm*.json",
    "packagingAtoms": "atoms.packaging*.json",
    "bindings": "bindings*.json",
    "rules": "rules*.json",
    "templates": "templates*.json",
}


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _latest(paths: Iterable[Path]) -> Optional[Path]:
    paths = [p for p in paths if p.is_file()]
    if not paths:
        return None
    # Prefer canonical name, otherwise newest modified file.
    canonical = [p for p in paths if "(" not in p.name]
    if canonical:
        return sorted(canonical, key=lambda p: p.name)[0]
    return max(paths, key=lambda p: p.stat().st_mtime)


def find_file(sample_dir: Path, logical_name: str, manifest: Optional[Dict[str, Any]] = None) -> Optional[Path]:
    if manifest:
        rel = manifest.get("files", {}).get(logical_name)
        if rel:
            p = sample_dir / rel
            if p.exists():
                return p
    canonical = sample_dir / CANONICAL_FILENAMES[logical_name]
    if canonical.exists():
        return canonical
    return _latest(sample_dir.glob(GLOB_PATTERNS[logical_name]))


def discover_sample_dirs(root: Path) -> List[Path]:
    """Find directories that look like sample-video libraries."""
    root = root.resolve()
    dirs = set()
    for p in root.rglob("manifest*.json"):
        if p.is_file():
            dirs.add(p.parent)
    if not dirs:
        # Allow a directory with all non-manifest files as a partial sample.
        for p in root.rglob("slots*.json"):
            dirs.add(p.parent)
    return sorted(dirs)


def load_sample(sample_dir: Path) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Load one sample library directory.

    Returns (metadata, files). files contains parsed JSON keyed by logical names.
    """
    manifest_path = find_file(sample_dir, "manifest")
    manifest: Dict[str, Any] = read_json(manifest_path) if manifest_path else {}
    files: Dict[str, Any] = {}
    paths: Dict[str, str] = {}
    for logical in CANONICAL_FILENAMES:
        p = find_file(sample_dir, logical, manifest)
        if p is not None:
            files[logical] = read_json(p)
            paths[logical] = str(p)
    sample_id = manifest.get("sampleVideoId") or manifest.get("artifactId") or sample_dir.name
    metadata = {
        "sampleDir": str(sample_dir),
        "sampleId": str(sample_id),
        "artifactId": manifest.get("artifactId"),
        "schemaVersion": manifest.get("schemaVersion"),
        "paths": paths,
    }
    return metadata, files


def as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def by_id(items: Iterable[Dict[str, Any]], key: str = "id") -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for item in items:
        item_id = item.get(key)
        if item_id is not None:
            out[str(item_id)] = item
    return out


def slot_key(slot_type: str) -> str:
    return normalize_text(slot_type).replace(" ", "_")


def normalize_text(text: Any) -> str:
    text = "" if text is None else str(text)
    text = text.strip().lower()
    text = re.sub(r"[\s\-/]+", " ", text)
    return text


def tokenize(text: Any) -> List[str]:
    text = normalize_text(text)
    # Keep latin words/numbers and Chinese character runs as loose tokens.
    return re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]+", text)


def text_blob(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        return " ".join(text_blob(v) for v in value.values())
    if isinstance(value, list):
        return " ".join(text_blob(v) for v in value)
    return str(value)
