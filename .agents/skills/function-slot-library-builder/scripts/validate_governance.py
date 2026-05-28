#!/usr/bin/env python3
"""Validate FunctionSlotLibrary semantic-governance structure.

The validator checks provenance closure, coverage accounting, and explicit
review/unmapped bookkeeping. It does not repair or infer semantic classes.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


DEFAULT_GOVERNANCE = (
    Path("Artifacts")
    / "FunctionSlotLibrary"
    / "_governance"
    / "semantic-governance.v1.json"
)
DEFAULT_SOURCE_INDEX = Path("Runtime") / "Temp" / "FunctionSlotLibrary" / "slot_index.json"
NODE_LIST_FIELDS = [
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
]


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def resolve_cli_path(value: str, root: Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = root / path
    return path


def as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def as_set(value: Any) -> Set[str]:
    return {str(item) for item in as_list(value) if item not in [None, ""]}


def index_by_id(items: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for item in items:
        item_id = item.get("id")
        if item_id:
            out[str(item_id)] = item
    return out


def sample_id(variant_id: str) -> str:
    return str(variant_id).split("::", 1)[0]


def expected_support(source_variant_ids: Iterable[str]) -> Dict[str, Any]:
    ids = [str(item) for item in source_variant_ids]
    samples = sorted({sample_id(item) for item in ids})
    return {
        "variantCount": len(ids),
        "sampleCount": len(samples),
        "sampleIds": samples,
    }


def describe_missing(values: Set[str], limit: int = 8) -> str:
    ordered = sorted(values)
    shown = ordered[:limit]
    suffix = "" if len(ordered) <= limit else f" ... +{len(ordered) - limit} more"
    return ", ".join(shown) + suffix


def add_issue(issues: List[Dict[str, Any]], severity: str, code: str, message: str) -> None:
    issues.append({"severity": severity, "code": code, "message": message})


def all_nodes(governance: Dict[str, Any]) -> List[Tuple[str, Dict[str, Any]]]:
    nodes: List[Tuple[str, Dict[str, Any]]] = []
    for field in NODE_LIST_FIELDS + ["reviewItems"]:
        for item in as_list(governance.get(field)):
            if isinstance(item, dict):
                nodes.append((field, item))
    return nodes


def evidence_sets(source_index: Optional[Dict[str, Any]]) -> Dict[str, Set[str]]:
    if not source_index:
        return {}
    return {
        "atom": {str(item.get("variantId")) for item in source_index.get("atomVariants", [])},
        "binding": {str(item.get("variantId")) for item in source_index.get("bindings", [])},
        "rule": {str(item.get("variantId")) for item in source_index.get("rules", [])},
        "needReview": {
            str(item.get("variantId"))
            for field in ["slotVariants", "atomVariants", "bindings", "rules"]
            for item in source_index.get(field, [])
            if item.get("needReview")
        },
    }


def validate_parent_variant_closure(
    issues: List[Dict[str, Any]],
    *,
    parent: Dict[str, Any],
    child: Dict[str, Any],
    parent_label: str,
    child_label: str,
) -> None:
    parent_ids = as_set(parent.get("sourceVariantIds"))
    child_ids = as_set(child.get("sourceVariantIds"))
    missing = child_ids - parent_ids
    if missing:
        add_issue(
            issues,
            "error",
            "parent_source_variant_closure",
            (
                f"{parent_label} {parent.get('id')} does not include "
                f"{child_label} {child.get('id')} sourceVariantIds: "
                f"{describe_missing(missing)}"
            ),
        )


def validate_slot_hierarchy(governance: Dict[str, Any], issues: List[Dict[str, Any]]) -> None:
    families = index_by_id(as_list(governance.get("slotFamilies")))
    archetypes = index_by_id(as_list(governance.get("slotArchetypes")))
    subtypes = index_by_id(as_list(governance.get("slotSubtypes")))

    for archetype in archetypes.values():
        if not archetype.get("primaryProofObligationClass"):
            add_issue(
                issues,
                "error",
                "missing_primary_proof_obligation_class",
                f"slotArchetype {archetype.get('id')} must declare primaryProofObligationClass",
            )
        if not archetype.get("chainDependencyClass"):
            add_issue(
                issues,
                "error",
                "missing_chain_dependency_class",
                f"slotArchetype {archetype.get('id')} must declare chainDependencyClass",
            )
        if not isinstance(archetype.get("excludes"), list) or not archetype.get("excludes"):
            add_issue(
                issues,
                "error",
                "missing_archetype_excludes",
                f"slotArchetype {archetype.get('id')} must declare non-empty excludes",
            )
        family_id = archetype.get("familyId")
        if not family_id:
            add_issue(issues, "error", "missing_family_id", f"slotArchetype {archetype.get('id')} has no familyId")
            continue
        family = families.get(str(family_id))
        if not family:
            add_issue(issues, "error", "unknown_family_id", f"slotArchetype {archetype.get('id')} references missing familyId {family_id}")
            continue
        validate_parent_variant_closure(issues, parent=family, child=archetype, parent_label="slotFamily", child_label="slotArchetype")

    for subtype in subtypes.values():
        boundary = subtype.get("subtypeBoundary")
        if not isinstance(boundary, dict):
            add_issue(
                issues,
                "error",
                "missing_subtype_boundary",
                f"slotSubtype {subtype.get('id')} must declare subtypeBoundary",
            )
        else:
            if "primaryProofObligationClass" not in as_set(boundary.get("mustNotChange")):
                add_issue(
                    issues,
                    "error",
                    "invalid_subtype_boundary",
                    f"slotSubtype {subtype.get('id')} subtypeBoundary.mustNotChange must include primaryProofObligationClass",
                )
        archetype_id = subtype.get("archetypeId")
        if not archetype_id:
            add_issue(issues, "error", "missing_archetype_id", f"slotSubtype {subtype.get('id')} has no archetypeId")
            continue
        archetype = archetypes.get(str(archetype_id))
        if not archetype:
            add_issue(issues, "error", "unknown_archetype_id", f"slotSubtype {subtype.get('id')} references missing archetypeId {archetype_id}")
            continue
        validate_parent_variant_closure(issues, parent=archetype, child=subtype, parent_label="slotArchetype", child_label="slotSubtype")


def validate_atom_hierarchy(governance: Dict[str, Any], issues: List[Dict[str, Any]]) -> None:
    archetypes = index_by_id(as_list(governance.get("atomArchetypes")))
    patterns = index_by_id(as_list(governance.get("atomPatterns")))
    slot_subtypes = index_by_id(as_list(governance.get("slotSubtypes")))

    for pattern in patterns.values():
        if "forSlotSubtype" in pattern:
            add_issue(issues, "error", "legacy_for_slot_subtype", f"atomPattern {pattern.get('id')} still uses forSlotSubtype string")
        subtype_ids = pattern.get("forSlotSubtypeIds")
        if not isinstance(subtype_ids, list):
            add_issue(issues, "error", "invalid_for_slot_subtype_ids", f"atomPattern {pattern.get('id')} forSlotSubtypeIds must be an array")
        else:
            for subtype_id in as_set(subtype_ids):
                if subtype_id not in slot_subtypes:
                    add_issue(issues, "error", "unknown_for_slot_subtype_id", f"atomPattern {pattern.get('id')} references missing slotSubtype {subtype_id}")

        parent_id = pattern.get("parentAtomArchetype")
        if not parent_id:
            add_issue(issues, "error", "missing_parent_atom_archetype", f"atomPattern {pattern.get('id')} has no parentAtomArchetype")
            continue
        parent = archetypes.get(str(parent_id))
        if not parent:
            add_issue(issues, "error", "unknown_parent_atom_archetype", f"atomPattern {pattern.get('id')} references missing parentAtomArchetype {parent_id}")
            continue
        if pattern.get("id") not in as_set(parent.get("sourcePatternIds")):
            add_issue(issues, "error", "parent_source_pattern_closure", f"atomArchetype {parent.get('id')} sourcePatternIds does not include atomPattern {pattern.get('id')}")
        validate_parent_variant_closure(issues, parent=parent, child=pattern, parent_label="atomArchetype", child_label="atomPattern")


def validate_pattern_references(governance: Dict[str, Any], issues: List[Dict[str, Any]]) -> None:
    binding_patterns = index_by_id(as_list(governance.get("bindingPatterns")))
    rule_patterns = index_by_id(as_list(governance.get("rulePatterns")))
    atom_patterns = index_by_id(as_list(governance.get("atomPatterns")))
    slot_subtypes = index_by_id(as_list(governance.get("slotSubtypes")))

    for principle in as_list(governance.get("bindingPrinciples")):
        for pattern_id in as_set(principle.get("sourcePatternIds")):
            if pattern_id not in binding_patterns:
                add_issue(issues, "error", "unknown_binding_pattern_id", f"bindingPrinciple {principle.get('id')} references missing bindingPattern {pattern_id}")

    for policy in as_list(governance.get("recompositionPolicies")):
        if policy.get("policyScope") != "composition_safety":
            add_issue(issues, "error", "missing_policy_scope", f"recompositionPolicy {policy.get('id')} must use policyScope=composition_safety")
        for pattern_id in as_set(policy.get("sourceRulePatternIds")):
            if pattern_id not in rule_patterns:
                add_issue(issues, "error", "unknown_rule_pattern_id", f"recompositionPolicy {policy.get('id')} references missing rulePattern {pattern_id}")

    for bundle in as_list(governance.get("implementationBundles")):
        for field in ["bundleType", "useAs", "notUseAs"]:
            if not bundle.get(field):
                add_issue(issues, "error", "missing_bundle_usage_field", f"implementationBundle {bundle.get('id')} must declare {field}")
        slot_variant_ids: Set[str] = set()
        for subtype_id in as_set(bundle.get("slotSubtypeIds")):
            subtype = slot_subtypes.get(subtype_id)
            if not subtype:
                add_issue(issues, "error", "unknown_bundle_slot_subtype", f"implementationBundle {bundle.get('id')} references missing slotSubtype {subtype_id}")
                continue
            slot_variant_ids.update(as_set(subtype.get("sourceVariantIds")))
        for field in ["scriptPatternIds", "rhythmPatternIds", "packagingPatternIds"]:
            for pattern_id in as_set(bundle.get(field)):
                if pattern_id not in atom_patterns:
                    add_issue(issues, "error", "unknown_bundle_atom_pattern", f"implementationBundle {bundle.get('id')} references missing atomPattern {pattern_id}")
        missing_sources = as_set(bundle.get("sourceVariantIds")) - slot_variant_ids
        if missing_sources:
            add_issue(issues, "error", "bundle_source_variant_closure", f"implementationBundle {bundle.get('id')} sourceVariantIds are not covered by its slotSubtypeIds: {describe_missing(missing_sources)}")


def validate_observed_chains(governance: Dict[str, Any], issues: List[Dict[str, Any]]) -> None:
    if as_list(governance.get("chainPatterns")):
        add_issue(
            issues,
            "error",
            "legacy_chain_patterns",
            "chainPatterns must stay empty; use observedChainPatterns for observed slot order evidence",
        )
    for chain in as_list(governance.get("observedChainPatterns")):
        if not isinstance(chain.get("sequence"), list) or not chain.get("sequence"):
            add_issue(
                issues,
                "error",
                "invalid_observed_chain_sequence",
                f"observedChainPattern {chain.get('id')} must declare non-empty sequence",
            )
        if chain.get("notUseAs") != "archetype_merge_basis_or_fixed_template":
            add_issue(
                issues,
                "error",
                "invalid_observed_chain_usage",
                f"observedChainPattern {chain.get('id')} must not be usable as archetype merge basis or fixed template",
            )


def validate_support_counts(governance: Dict[str, Any], issues: List[Dict[str, Any]]) -> None:
    for field, item in all_nodes(governance):
        if "sourceVariantIds" not in item:
            continue
        expected = expected_support(as_list(item.get("sourceVariantIds")))
        actual = item.get("support")
        if not isinstance(actual, dict):
            add_issue(issues, "error", "missing_support", f"{field} {item.get('id')} has sourceVariantIds but no support")
            continue
        for key in ["variantCount", "sampleCount"]:
            if actual.get(key) != expected[key]:
                add_issue(issues, "error", "support_count_mismatch", f"{field} {item.get('id')} support.{key}={actual.get(key)} expected {expected[key]}")
        if sorted(as_list(actual.get("sampleIds"))) != expected["sampleIds"]:
            add_issue(issues, "error", "support_sample_ids_mismatch", f"{field} {item.get('id')} support.sampleIds does not match sourceVariantIds")


def validate_status_fields(governance: Dict[str, Any], issues: List[Dict[str, Any]]) -> None:
    for field, item in all_nodes(governance):
        if not item.get("reviewStatus"):
            add_issue(issues, "error", "missing_review_status", f"{field} {item.get('id')} has no reviewStatus")
        if not item.get("maturityStatus"):
            add_issue(issues, "error", "missing_maturity_status", f"{field} {item.get('id')} has no maturityStatus")


def validate_need_review_map(governance: Dict[str, Any], source_index: Optional[Dict[str, Any]], issues: List[Dict[str, Any]]) -> None:
    if not source_index:
        return
    expected = evidence_sets(source_index)["needReview"]
    actual = {str(item.get("variantId")) for item in as_list(governance.get("needReviewMap"))}
    missing = expected - actual
    extra = actual - expected
    if missing:
        add_issue(issues, "error", "need_review_map_missing", f"needReviewMap missing variants: {describe_missing(missing)}")
    if extra:
        add_issue(issues, "error", "need_review_map_extra", f"needReviewMap contains non-needReview variants: {describe_missing(extra)}")
    coverage = governance.get("coverage") or {}
    if coverage.get("needReviewCount") != len(expected):
        add_issue(issues, "error", "need_review_count_mismatch", f"coverage.needReviewCount={coverage.get('needReviewCount')} expected {len(expected)}")


def validate_unmapped_coverage(governance: Dict[str, Any], source_index: Optional[Dict[str, Any]], issues: List[Dict[str, Any]]) -> None:
    if not source_index:
        return
    evidence = evidence_sets(source_index)
    checks = [
        ("atom", "atomPatterns", "unmappedAtomVariants"),
        ("binding", "bindingPatterns", "unmappedBindingVariants"),
        ("rule", "rulePatterns", "unmappedRuleVariants"),
    ]
    for kind, pattern_field, unmapped_field in checks:
        all_ids = evidence[kind]
        covered = {str(variant_id) for item in as_list(governance.get(pattern_field)) for variant_id in as_list(item.get("sourceVariantIds"))}
        unmapped = {str(item.get("variantId")) for item in as_list(governance.get(unmapped_field))}
        missing = all_ids - covered - unmapped
        extra = (covered | unmapped) - all_ids
        overlap = covered & unmapped
        if missing:
            add_issue(issues, "error", f"{kind}_coverage_missing", f"{kind} variants missing from patterns and unmapped list: {describe_missing(missing)}")
        if extra:
            add_issue(issues, "error", f"{kind}_coverage_extra", f"{kind} coverage references unknown variants: {describe_missing(extra)}")
        if overlap:
            add_issue(issues, "error", f"{kind}_coverage_overlap", f"{kind} variants appear in both patterns and unmapped list: {describe_missing(overlap)}")
        for item in as_list(governance.get(unmapped_field)):
            if not item.get("variantId") or not item.get("reason") or not item.get("suggestedAction"):
                add_issue(issues, "error", "invalid_unmapped_item", f"{unmapped_field} item must include variantId/reason/suggestedAction")


def validate_governance(governance: Dict[str, Any], source_index: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    validate_slot_hierarchy(governance, issues)
    validate_atom_hierarchy(governance, issues)
    validate_pattern_references(governance, issues)
    validate_observed_chains(governance, issues)
    validate_support_counts(governance, issues)
    validate_status_fields(governance, issues)
    validate_need_review_map(governance, source_index, issues)
    validate_unmapped_coverage(governance, source_index, issues)
    return issues


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate semantic-governance parent/child closure and coverage.")
    parser.add_argument("root", nargs="?", default=".", help="Repository root. Defaults to the current directory.")
    parser.add_argument(
        "--governance",
        default=None,
        help="Path to semantic-governance JSON. Defaults to Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json.",
    )
    parser.add_argument(
        "--source-index",
        default=None,
        help="Path to slot_index.json. Defaults to Runtime/Temp/FunctionSlotLibrary/slot_index.json when present.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON report.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    governance_path = resolve_cli_path(args.governance, root) if args.governance else root / DEFAULT_GOVERNANCE
    source_index_path = resolve_cli_path(args.source_index, root) if args.source_index else root / DEFAULT_SOURCE_INDEX
    governance = read_json(governance_path)
    source_index = read_json(source_index_path) if source_index_path.exists() else None
    issues = validate_governance(governance, source_index)

    report = {
        "ok": not any(issue["severity"] == "error" for issue in issues),
        "errorCount": sum(1 for issue in issues if issue["severity"] == "error"),
        "warningCount": sum(1 for issue in issues if issue["severity"] == "warning"),
        "issues": issues,
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"ok: {str(report['ok']).lower()}")
        print(f"errors: {report['errorCount']}")
        print(f"warnings: {report['warningCount']}")
        for issue in issues:
            print(f"[{issue['severity']}] {issue['code']}: {issue['message']}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
