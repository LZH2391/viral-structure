#!/usr/bin/env python3
"""Validate a corpus of short-video function-slot sample libraries."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List

from common import as_list, by_id, discover_sample_dirs, display_path, load_sample, resolve_corpus_root, resolve_default_output_path, write_json

REQUIRED_SAMPLE_FILES = [
    "slots",
    "scriptAtoms",
    "rhythmAtoms",
    "packagingAtoms",
    "bindings",
    "rules",
    "templates",
]


def validate_sample(meta: Dict[str, Any], files: Dict[str, Any]) -> Dict[str, Any]:
    errors: List[str] = []
    warnings: List[str] = []

    for logical in REQUIRED_SAMPLE_FILES:
        if logical not in files:
            warnings.append(f"missing optional/expected file: {logical}")

    slots = as_list(files.get("slots"))
    script_atoms = as_list(files.get("scriptAtoms"))
    rhythm_atoms = as_list(files.get("rhythmAtoms"))
    packaging_atoms = as_list(files.get("packagingAtoms"))
    bindings = as_list(files.get("bindings"))
    templates = as_list(files.get("templates"))
    rules = files.get("rules") or {}

    slot_ids = by_id(slots, "slotId")
    slot_types = {str(s.get("slotType")) for s in slots if s.get("slotType")}
    atom_ids: Dict[str, Dict[str, Any]] = {}
    for collection_name, collection in [
        ("scriptAtoms", script_atoms),
        ("rhythmAtoms", rhythm_atoms),
        ("packagingAtoms", packaging_atoms),
    ]:
        for atom in collection:
            atom_id = atom.get("id")
            if not atom_id:
                errors.append(f"{collection_name} atom missing id: {atom}")
                continue
            if str(atom_id) in atom_ids:
                warnings.append(f"duplicate atom id inside sample: {atom_id}")
            atom_ids[str(atom_id)] = atom
            atom_slot = atom.get("slot")
            if atom_slot and atom_slot not in slot_types:
                warnings.append(f"atom {atom_id} references slot type not present in slots: {atom_slot}")

    for slot in slots:
        slot_id = slot.get("slotId")
        if not slot_id:
            errors.append(f"slot missing slotId: {slot}")
            continue
        if not slot.get("slotType"):
            errors.append(f"slot {slot_id} missing slotType")
        for field in ["scriptAtomIds", "rhythmAtomIds", "packagingAtomIds"]:
            for atom_id in as_list(slot.get(field)):
                if str(atom_id) not in atom_ids:
                    errors.append(f"slot {slot_id} references missing atom {atom_id} via {field}")

    for binding in bindings:
        binding_id = binding.get("id", "<missing>")
        for slot_id in as_list(binding.get("slotIds")):
            if str(slot_id) not in slot_ids:
                errors.append(f"binding {binding_id} references missing slot {slot_id}")
        for atom_id in as_list(binding.get("atomIds")):
            if str(atom_id) not in atom_ids:
                errors.append(f"binding {binding_id} references missing atom {atom_id}")

    for template in templates:
        template_id = template.get("templateId", "<missing>")
        for slot_type in as_list(template.get("sequence")):
            if str(slot_type) not in slot_types:
                warnings.append(f"template {template_id} sequence references slot type not present in sample: {slot_type}")

    conflict_checks = as_list(rules.get("conflictChecks")) if isinstance(rules, dict) else []
    recombination_rules = as_list(rules.get("recombinationRules")) if isinstance(rules, dict) else []
    for rule in conflict_checks + recombination_rules:
        for slot_id in as_list(rule.get("slotIds")):
            if slot_id and str(slot_id) not in slot_ids:
                warnings.append(f"rule {rule.get('id')} references missing slot id {slot_id}")
        for slot_type in as_list(rule.get("appliesTo")):
            if slot_type and str(slot_type) not in slot_types:
                warnings.append(f"rule {rule.get('id')} applies to slot type not present in this sample: {slot_type}")

    need_review = sum(1 for item in slots + script_atoms + rhythm_atoms + packaging_atoms if item.get("needReview"))
    return {
        "sampleId": meta["sampleId"],
        "sampleDir": meta["sampleDir"],
        "artifactId": meta.get("artifactId"),
        "lineage": meta.get("lineage", {}),
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "counts": {
            "slots": len(slots),
            "scriptAtoms": len(script_atoms),
            "rhythmAtoms": len(rhythm_atoms),
            "packagingAtoms": len(packaging_atoms),
            "bindings": len(bindings),
            "templates": len(templates),
            "rules": len(conflict_checks) + len(recombination_rules),
            "needReview": need_review,
        },
        "slotTypes": sorted(slot_types),
    }


def validate_corpus(root: Path) -> Dict[str, Any]:
    corpus_root = resolve_corpus_root(root)
    sample_dirs = discover_sample_dirs(corpus_root)
    sample_results = []
    slot_type_counter: Counter[str] = Counter()
    chain_counter: Counter[str] = Counter()
    category_support: Dict[str, set] = defaultdict(set)

    for sample_dir in sample_dirs:
        meta, files = load_sample(sample_dir)
        result = validate_sample(meta, files)
        sample_results.append(result)
        for slot_type in result.get("slotTypes", []):
            slot_type_counter[slot_type] += 1
            category_support[slot_type].add(meta["sampleId"])
        for template in as_list(files.get("templates")):
            seq = template.get("sequence") or []
            if seq:
                chain_counter[" > ".join(map(str, seq))] += 1

    errors = [e for r in sample_results for e in r["errors"]]
    warnings = [w for r in sample_results for w in r["warnings"]]
    if not sample_results:
        errors.append("no sample libraries found")
    return {
        "ok": not errors,
        "corpusRoot": display_path(corpus_root),
        "sampleCount": len(sample_results),
        "sampleResults": sample_results,
        "errors": errors,
        "warnings": warnings,
        "slotTypeSupport": dict(sorted(slot_type_counter.items())),
        "chainPatternSupport": dict(chain_counter.most_common()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus_dir", help="Directory containing one or many sample libraries")
    parser.add_argument("--out", help="Optional path to write validation JSON. Defaults to Runtime/Temp/FunctionSlotLibrary/validation.json for repo-root input.")
    args = parser.parse_args()

    result = validate_corpus(Path(args.corpus_dir))
    if args.out or _is_repo_root_input(Path(args.corpus_dir)):
        out_path = Path(args.out) if args.out else resolve_default_output_path(Path(args.corpus_dir), "validation.json")
        write_json(out_path, result)
        if not args.out:
            print(f"wrote {display_path(out_path)}")
    else:
        import json
        print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["ok"] else 1)


def _is_repo_root_input(path: Path) -> bool:
    root = path.expanduser().resolve()
    return (root / "Artifacts" / "FunctionSlotLibrary").exists()


if __name__ == "__main__":
    main()
