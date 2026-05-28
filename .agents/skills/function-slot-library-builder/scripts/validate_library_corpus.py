#!/usr/bin/env python3
"""Validate one or more short-video function-slot sample libraries.

Usage:
  python validate_library_corpus.py /path/to/sample_or_corpus
  python validate_library_corpus.py /path/to/sample_or_corpus --json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from common import display_path, resolve_corpus_root

REQUIRED_FILES = {
    "slots": "slots.json",
    "script_atoms": "atoms.script.json",
    "rhythm_atoms": "atoms.rhythm.json",
    "packaging_atoms": "atoms.packaging.json",
    "bindings": "bindings.json",
    "rules": "rules.json",
    "templates": "templates.json",
}
OPTIONAL_FILES = {"manifest": "manifest.json"}


def load_json(path: Path) -> Tuple[Any, str | None]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except Exception as exc:  # pragma: no cover - human-facing tool
        return None, f"failed to read {path.name}: {exc}"


def looks_like_sample_dir(path: Path) -> bool:
    return any((path / name).exists() for name in REQUIRED_FILES.values())


def find_samples(root: Path) -> List[Path]:
    root = resolve_corpus_root(root)
    if looks_like_sample_dir(root):
        return [root]
    samples = [p for p in sorted(root.iterdir()) if p.is_dir() and looks_like_sample_dir(p)]
    return samples


def ids(items: Any) -> set[str]:
    if not isinstance(items, list):
        return set()
    out = set()
    for item in items:
        if isinstance(item, dict):
            value = item.get("id") or item.get("slotId") or item.get("templateId")
            if value:
                out.add(str(value))
    return out


def validate_sample(sample_dir: Path) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "samplePath": display_path(sample_dir),
        "sampleId": sample_dir.name,
        "ok": True,
        "errors": [],
        "warnings": [],
        "counts": {},
    }
    data: Dict[str, Any] = {}

    for key, filename in REQUIRED_FILES.items():
        path = sample_dir / filename
        if not path.exists():
            result["errors"].append(f"missing required file: {filename}")
            continue
        loaded, error = load_json(path)
        if error:
            result["errors"].append(error)
        else:
            data[key] = loaded
            result["counts"][key] = len(loaded) if isinstance(loaded, list) else 1

    for key, filename in OPTIONAL_FILES.items():
        path = sample_dir / filename
        if path.exists():
            loaded, error = load_json(path)
            if error:
                result["warnings"].append(error)
            else:
                data[key] = loaded
                result["sampleId"] = str(loaded.get("sampleVideoId") or loaded.get("artifactId") or result["sampleId"])

    if result["errors"]:
        result["ok"] = False
        return result

    slots = data.get("slots", [])
    script_atoms = data.get("script_atoms", [])
    rhythm_atoms = data.get("rhythm_atoms", [])
    packaging_atoms = data.get("packaging_atoms", [])
    bindings = data.get("bindings", [])
    templates = data.get("templates", [])

    slot_ids = ids(slots)
    script_ids = ids(script_atoms)
    rhythm_ids = ids(rhythm_atoms)
    packaging_ids = ids(packaging_atoms)
    all_atom_ids = script_ids | rhythm_ids | packaging_ids
    slot_types = {str(s.get("slotType")) for s in slots if isinstance(s, dict) and s.get("slotType")}

    for slot in slots if isinstance(slots, list) else []:
        if not isinstance(slot, dict):
            result["errors"].append("slot item is not an object")
            continue
        sid = str(slot.get("slotId", ""))
        if not sid:
            result["errors"].append("slot missing slotId")
        if not slot.get("slotType"):
            result["errors"].append(f"slot {sid or '<unknown>'} missing slotType")
        for field, valid_ids in [
            ("scriptAtomIds", script_ids),
            ("rhythmAtomIds", rhythm_ids),
            ("packagingAtomIds", packaging_ids),
        ]:
            for atom_id in slot.get(field, []) or []:
                if str(atom_id) not in valid_ids:
                    result["errors"].append(f"slot {sid} references missing {field}: {atom_id}")

    for atom_key, atom_list in [
        ("script", script_atoms),
        ("rhythm", rhythm_atoms),
        ("packaging", packaging_atoms),
    ]:
        if not isinstance(atom_list, list):
            result["errors"].append(f"{atom_key} atoms file must be a list")
            continue
        for atom in atom_list:
            if not isinstance(atom, dict):
                result["errors"].append(f"{atom_key} atom item is not an object")
                continue
            if not atom.get("id"):
                result["errors"].append(f"{atom_key} atom missing id")
            if not atom.get("slot"):
                result["warnings"].append(f"{atom_key} atom {atom.get('id', '<unknown>')} missing slot type")
            elif str(atom.get("slot")) not in slot_types:
                result["warnings"].append(
                    f"{atom_key} atom {atom.get('id')} has slot type not present in slots: {atom.get('slot')}"
                )

    if isinstance(bindings, list):
        for binding in bindings:
            if not isinstance(binding, dict):
                result["errors"].append("binding item is not an object")
                continue
            bid = binding.get("id", "<unknown>")
            for slot_id in binding.get("slotIds", []) or []:
                if str(slot_id) not in slot_ids:
                    result["errors"].append(f"binding {bid} references missing slot: {slot_id}")
            for atom_id in binding.get("atomIds", []) or []:
                if str(atom_id) not in all_atom_ids:
                    result["errors"].append(f"binding {bid} references missing atom: {atom_id}")
    else:
        result["errors"].append("bindings file must be a list")

    if isinstance(templates, list):
        for template in templates:
            if not isinstance(template, dict):
                result["errors"].append("template item is not an object")
                continue
            for slot_type in template.get("sequence", []) or []:
                if str(slot_type) not in slot_types:
                    result["warnings"].append(
                        f"template {template.get('templateId', '<unknown>')} uses slotType not found in slots: {slot_type}"
                    )
    else:
        result["errors"].append("templates file must be a list")

    for atom in packaging_atoms if isinstance(packaging_atoms, list) else []:
        if not isinstance(atom, dict):
            continue
        if not (atom.get("packagingFunction") or atom.get("function")):
            result["warnings"].append(f"packaging atom {atom.get('id', '<unknown>')} missing packagingFunction")
        if not (atom.get("visualHierarchy") or atom.get("visualElements")):
            result["warnings"].append(f"packaging atom {atom.get('id', '<unknown>')} missing visualHierarchy/visualElements")

    result["ok"] = not result["errors"]
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="sample folder or corpus folder")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    args = parser.parse_args()

    root = Path(args.path).expanduser().resolve()
    if not root.exists():
        print(json.dumps({"ok": False, "errors": [f"path does not exist: {root}"]}, ensure_ascii=False, indent=2))
        return 2

    samples = find_samples(root)
    if not samples:
        output = {"ok": False, "errors": ["no sample libraries found"], "samples": []}
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 2

    results = [validate_sample(sample) for sample in samples]
    output = {
        "ok": all(item["ok"] for item in results),
        "sampleCount": len(results),
        "samples": results,
    }

    if args.json:
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print(f"ok: {output['ok']}")
        print(f"sampleCount: {output['sampleCount']}")
        for item in results:
            print(f"- {item['sampleId']}: ok={item['ok']} errors={len(item['errors'])} warnings={len(item['warnings'])}")
            for error in item["errors"]:
                print(f"  error: {error}")
            for warning in item["warnings"][:8]:
                print(f"  warning: {warning}")
            if len(item["warnings"]) > 8:
                print(f"  ... {len(item['warnings']) - 8} more warnings")
    return 0 if output["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
