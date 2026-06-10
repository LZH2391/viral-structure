#!/usr/bin/env python3
"""Build a semantic-governance skeleton from the FunctionSlotLibrary evidence index.

This script only creates the governance file shape, source snapshot, and coverage
summary. It must not infer or merge semantic families, archetypes, patterns,
principles, or policies.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


from common import read_governance, write_json, write_split_governance


DEFAULT_SOURCE_INDEX = Path("Runtime") / "Temp" / "FunctionSlotLibrary" / "slot_index.json"
DEFAULT_OUTPUT = (
    Path("Runtime")
    / "Temp"
    / "FunctionSlotLibrary"
    / "semantic-governance.skeleton.json"
)
FORMAL_OUTPUT = (
    Path("Artifacts")
    / "FunctionSlotLibrary"
    / "_governance"
    / "semantic-governance.v1.json"
)
REQUIRED_LIST_FIELDS = [
    "sourceVariants",
    "slotFamilies",
    "slotArchetypes",
    "slotSubtypes",
    "atomArchetypes",
    "atomPatterns",
    "bindingPatterns",
    "bindingPrinciples",
    "rulePatterns",
    "recompositionPolicies",
    "implementationBundles",
    "observedChainPatterns",
    "unmappedAtomVariants",
    "unmappedBindingVariants",
    "unmappedRuleVariants",
    "reviewItems",
    "openQuestions",
]


def repo_relative(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def resolve_cli_path(value: str, root: Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = root / path
    return path


def read_json_file(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def normalize_counts(counts: Dict[str, Any]) -> Dict[str, int]:
    return {
        "slotCount": int(counts.get("slotCount") or 0),
        "atomCount": int(counts.get("atomCount") or 0),
        "bindingCount": int(counts.get("bindingCount") or 0),
        "ruleCount": int(counts.get("ruleCount") or 0),
        "templateCount": int(counts.get("templateCount") or 0),
    }


def build_source_snapshot(index: Dict[str, Any]) -> List[Dict[str, Any]]:
    snapshot: List[Dict[str, Any]] = []
    for sample in index.get("samples", []):
        lineage = sample.get("lineage") or {}
        counts = sample.get("counts") or lineage.get("counts") or {}
        snapshot.append(
            {
                "artifactId": sample.get("artifactId") or lineage.get("artifactId"),
                "sampleVideoId": sample.get("sampleId") or lineage.get("sampleVideoId"),
                "traceId": lineage.get("traceId"),
                "contentHash": lineage.get("contentHash"),
                "counts": normalize_counts(counts),
            }
        )
    return snapshot


def build_coverage(index: Dict[str, Any]) -> Dict[str, Any]:
    summary = index.get("summary") or {}
    return {
        "sampleCount": int(summary.get("sampleCount") or 0),
        "slotVariantCount": int(summary.get("slotVariantCount") or 0),
        "atomVariantCount": int(summary.get("atomVariantCount") or 0),
        "bindingCount": int(summary.get("bindingCount") or 0),
        "ruleCount": int(summary.get("ruleCount") or 0),
        "templateCount": int(summary.get("templateCount") or 0),
        "slotTypeSupport": summary.get("slotTypeSupport") or {},
        "chainPatternSupport": summary.get("chainPatternSupport") or {},
    }


def first_text(*values: Any) -> str | None:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def variant_source_id(variant_id: str) -> str | None:
    parts = str(variant_id or "").split("::")
    if len(parts) >= 3:
        return parts[-1]
    if len(parts) == 2:
        return parts[1]
    return None


def build_source_variants(index: Dict[str, Any]) -> List[Dict[str, Any]]:
    variants: Dict[str, Dict[str, Any]] = {}
    for slot in index.get("slotVariants", []):
        variant_id = first_text(slot.get("variantId"))
        if not variant_id:
            continue
        variants[variant_id] = {
            "variantId": variant_id,
            "sampleId": first_text(slot.get("sampleId")),
            "kind": "slot",
            "sourceId": first_text(slot.get("sourceSlotId"), variant_source_id(variant_id)),
            "label": first_text(slot.get("slotName"), slot.get("slotType"), slot.get("sourceSlotId"), variant_id),
        }
    for atom in index.get("atomVariants", []):
        variant_id = first_text(atom.get("variantId"))
        if not variant_id:
            continue
        variants[variant_id] = {
            "variantId": variant_id,
            "sampleId": first_text(atom.get("sampleId")),
            "kind": first_text(atom.get("kind"), "atom"),
            "sourceId": first_text(atom.get("sourceAtomId"), variant_source_id(variant_id)),
            "label": first_text(atom.get("label"), atom.get("function"), atom.get("sourceAtomId"), variant_id),
        }
    for binding in index.get("bindings", []):
        variant_id = first_text(binding.get("variantId"))
        if not variant_id:
            continue
        variants[variant_id] = {
            "variantId": variant_id,
            "sampleId": first_text(binding.get("sampleId")),
            "kind": "binding",
            "sourceId": first_text(binding.get("id"), variant_source_id(variant_id)),
            "label": first_text(binding.get("type"), binding.get("rule"), binding.get("id"), variant_id),
        }
    for rule in index.get("rules", []):
        variant_id = first_text(rule.get("variantId"))
        if not variant_id:
            continue
        variants[variant_id] = {
            "variantId": variant_id,
            "sampleId": first_text(rule.get("sampleId")),
            "kind": "rule",
            "sourceId": first_text(rule.get("id"), variant_source_id(variant_id)),
            "label": first_text(rule.get("reason"), rule.get("ruleKind"), rule.get("id"), variant_id),
        }
    for template in index.get("templates", []):
        variant_id = first_text(template.get("variantId"))
        if not variant_id:
            continue
        variants[variant_id] = {
            "variantId": variant_id,
            "sampleId": first_text(template.get("sampleId")),
            "kind": "template",
            "sourceId": first_text(template.get("templateId"), variant_source_id(variant_id)),
            "label": first_text(template.get("name"), template.get("chainKey"), template.get("templateId"), variant_id),
        }
    return [variants[key] for key in sorted(variants)]


def build_skeleton(root: Path, source_index: Path, output_path: Path) -> Dict[str, Any]:
    index = read_json_file(source_index)
    now = datetime.now(timezone.utc).isoformat()
    governance_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    skeleton = {
        "schemaVersion": "function_slot_semantic_governance.v1",
        "governanceId": f"governance_skeleton_{governance_id}",
        "outputPath": repo_relative(output_path, root),
        "sourceRoot": "Artifacts/FunctionSlotLibrary",
        "sourceIndex": repo_relative(source_index, root),
        "createdAt": now,
        "sourceSnapshot": build_source_snapshot(index),
        "coverage": build_coverage(index),
        "sourceVariants": build_source_variants(index),
        "slotFamilies": [],
        "slotArchetypes": [],
        "slotSubtypes": [],
        "atomArchetypes": [],
        "atomPatterns": [],
        "bindingPatterns": [],
        "bindingPrinciples": [],
        "rulePatterns": [],
        "recompositionPolicies": [],
        "implementationBundles": [],
        "observedChainPatterns": [],
        "unmappedAtomVariants": [],
        "unmappedBindingVariants": [],
        "unmappedRuleVariants": [],
        "reviewItems": [],
        "openQuestions": [],
    }
    for field in REQUIRED_LIST_FIELDS:
        skeleton.setdefault(field, [])
    return skeleton


def merge_existing(existing: Dict[str, Any], skeleton: Dict[str, Any]) -> Dict[str, Any]:
    """Add missing skeleton fields while preserving human/agent governance content."""
    merged = dict(existing)
    merged.pop("chainPatterns", None)
    for field in ["status", "reviewStatus", "maturityStatus", "needReviewMap"]:
        merged.pop(field, None)
    for field in ["schemaVersion", "governanceId", "createdAt"]:
        merged.setdefault(field, skeleton[field])
    for field in ["outputPath", "sourceRoot", "sourceIndex", "sourceSnapshot", "coverage", "sourceVariants"]:
        merged[field] = skeleton[field]
    for field in REQUIRED_LIST_FIELDS:
        if not isinstance(merged.get(field), list):
            merged[field] = []
        else:
            merged[field] = strip_status_fields(merged[field])
    prune_stale_source_references(merged, skeleton)
    return merged


def prune_stale_source_references(governance: Dict[str, Any], skeleton: Dict[str, Any]) -> None:
    valid_variant_ids = {
        str(item.get("variantId"))
        for item in skeleton.get("sourceVariants", [])
        if item.get("variantId")
    }
    for field in REQUIRED_LIST_FIELDS:
        items = governance.get(field)
        if not isinstance(items, list):
            continue
        if field in {"unmappedAtomVariants", "unmappedBindingVariants", "unmappedRuleVariants"}:
            governance[field] = [
                item for item in items
                if not isinstance(item, dict) or str(item.get("variantId")) in valid_variant_ids
            ]
            continue
        for item in items:
            if not isinstance(item, dict) or "sourceVariantIds" not in item:
                continue
            item["sourceVariantIds"] = [
                str(variant_id)
                for variant_id in as_list(item.get("sourceVariantIds"))
                if str(variant_id) in valid_variant_ids
            ]
            item["support"] = support_from_source_variant_ids(item["sourceVariantIds"])


def as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def support_from_source_variant_ids(source_variant_ids: List[str]) -> Dict[str, Any]:
    sample_ids = sorted({
        str(variant_id).split("::", 1)[0]
        for variant_id in source_variant_ids
        if variant_id
    })
    return {
        "variantCount": len(source_variant_ids),
        "sampleCount": len(sample_ids),
        "sampleIds": sample_ids,
    }


def strip_status_fields(value: Any) -> Any:
    if isinstance(value, list):
        return [strip_status_fields(item) for item in value]
    if isinstance(value, dict):
        return {
            key: strip_status_fields(item)
            for key, item in value.items()
            if key not in {"status", "reviewStatus", "maturityStatus", "needReview"}
        }
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate an empty semantic-governance skeleton from slot_index.json. "
            "This does not perform semantic merging."
        )
    )
    parser.add_argument(
        "root",
        nargs="?",
        default=".",
        help="Repository root. Defaults to the current directory.",
    )
    parser.add_argument(
        "--source-index",
        default=None,
        help="Path to slot_index.json. Defaults to Runtime/Temp/FunctionSlotLibrary/slot_index.json.",
    )
    parser.add_argument(
        "--out",
        default=None,
        help=(
            "Output path. Defaults to Runtime/Temp/FunctionSlotLibrary/"
            "semantic-governance.skeleton.json."
        ),
    )
    parser.add_argument(
        "--formal-out",
        action="store_true",
        help=(
            "Write to Artifacts/FunctionSlotLibrary/_governance/"
            "semantic-governance.v1.json. Requires --force if the file exists."
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow overwriting an existing output file.",
    )
    parser.add_argument(
        "--update-existing",
        action="store_true",
        help=(
            "If the output exists, preserve existing governance content, add missing "
            "skeleton fields, and refresh sourceSnapshot/coverage."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    source_index = (
        resolve_cli_path(args.source_index, root)
        if args.source_index
        else root / DEFAULT_SOURCE_INDEX
    )
    output_path = (
        root / FORMAL_OUTPUT
        if args.formal_out
        else resolve_cli_path(args.out, root)
        if args.out
        else root / DEFAULT_OUTPUT
    )

    if not source_index.exists():
        print(f"source index not found: {source_index}", file=sys.stderr)
        return 2
    if output_path.exists() and not args.force and not args.update_existing:
        print(f"output already exists, pass --force to overwrite: {output_path}", file=sys.stderr)
        return 3

    skeleton = build_skeleton(root, source_index.resolve(), output_path.resolve())
    if output_path.exists() and args.update_existing:
        existing = read_governance(output_path.resolve())
        skeleton = merge_existing(existing, skeleton)
        action = "updated governance skeleton"
    else:
        action = "wrote governance skeleton"
    if args.formal_out:
        write_split_governance(output_path.resolve(), skeleton)
    else:
        write_json(output_path.resolve(), skeleton)
    print(f"{action}: {repo_relative(output_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
