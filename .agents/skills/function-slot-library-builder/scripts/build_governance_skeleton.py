#!/usr/bin/env python3
"""Build a semantic-governance skeleton from the FunctionSlotLibrary evidence index.

This script only creates the governance file shape, source snapshot, and coverage
summary. It must not infer or merge semantic families, archetypes, patterns,
principles, or policies.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


from common import write_json


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
    "needReviewMap",
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
    need_review_count = 0
    for field in ["slotVariants", "atomVariants", "bindings", "rules"]:
        need_review_count += sum(1 for item in index.get(field, []) if item.get("needReview"))
    return {
        "sampleCount": int(summary.get("sampleCount") or 0),
        "slotVariantCount": int(summary.get("slotVariantCount") or 0),
        "atomVariantCount": int(summary.get("atomVariantCount") or 0),
        "bindingCount": int(summary.get("bindingCount") or 0),
        "ruleCount": int(summary.get("ruleCount") or 0),
        "templateCount": int(summary.get("templateCount") or 0),
        "needReviewCount": need_review_count,
        "slotTypeSupport": summary.get("slotTypeSupport") or {},
        "chainPatternSupport": summary.get("chainPatternSupport") or {},
    }


def build_skeleton(root: Path, source_index: Path, output_path: Path) -> Dict[str, Any]:
    index = read_json_file(source_index)
    now = datetime.now(timezone.utc).isoformat()
    governance_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    skeleton = {
        "schemaVersion": "function_slot_semantic_governance.v1",
        "governanceId": f"governance_skeleton_{governance_id}",
        "reviewStatus": "candidate",
        "maturityStatus": "candidate",
        "outputPath": repo_relative(output_path, root),
        "sourceRoot": "Artifacts/FunctionSlotLibrary",
        "sourceIndex": repo_relative(source_index, root),
        "createdAt": now,
        "sourceSnapshot": build_source_snapshot(index),
        "coverage": build_coverage(index),
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
        "needReviewMap": [],
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
    for field in ["schemaVersion", "governanceId", "reviewStatus", "maturityStatus", "createdAt"]:
        merged.setdefault(field, skeleton[field])
    for field in ["outputPath", "sourceRoot", "sourceIndex", "sourceSnapshot", "coverage"]:
        merged[field] = skeleton[field]
    for field in REQUIRED_LIST_FIELDS:
        if not isinstance(merged.get(field), list):
            merged[field] = []
    return merged


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
        existing = read_json_file(output_path.resolve())
        skeleton = merge_existing(existing, skeleton)
        action = "updated governance skeleton"
    else:
        action = "wrote governance skeleton"
    write_json(output_path.resolve(), skeleton)
    print(f"{action}: {repo_relative(output_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
