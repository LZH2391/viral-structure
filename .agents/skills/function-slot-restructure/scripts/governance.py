#!/usr/bin/env python3
"""Governance helpers for FunctionSlotLibrary recomposition scripts."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from common import read_json, text_blob, tokenize

DEFAULT_GOVERNANCE_RELATIVE = (
    Path("Artifacts")
    / "FunctionSlotLibrary"
    / "_governance"
    / "semantic-governance.v1.json"
)


def default_governance_path(index_path: Optional[Path] = None) -> Path:
    """Resolve the repo-local semantic governance file for common invocations."""
    cwd_path = Path.cwd() / DEFAULT_GOVERNANCE_RELATIVE
    if cwd_path.exists():
        return cwd_path
    if index_path is not None:
        parts = list(index_path.resolve().parts)
        for i in range(len(parts), 0, -1):
            root = Path(*parts[:i])
            candidate = root / DEFAULT_GOVERNANCE_RELATIVE
            if candidate.exists():
                return candidate
    return cwd_path


def load_governance(path: Optional[str | Path]) -> Optional[Dict[str, Any]]:
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        return None
    data = read_json(p)
    if isinstance(data, dict):
        data["_path"] = str(p)
        return data
    return None


def _ids(items: Iterable[Dict[str, Any]], field: str) -> Set[str]:
    out: Set[str] = set()
    for item in items:
        for value in item.get(field) or []:
            out.add(str(value))
    return out


def governance_status(index: Dict[str, Any], governance: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Return audit-safe status for evidence/governance alignment."""
    if not governance:
        return {
            "available": False,
            "path": None,
            "schemaVersion": None,
            "reviewStatus": None,
            "maturityStatus": None,
            "sourceSnapshotMatchesIndex": None,
            "warnings": ["semantic governance not loaded; falling back to evidence-layer ranking"],
        }

    index_samples = index.get("samples") or []
    index_hashes = {
        str(s.get("artifactId")): (s.get("lineage") or {}).get("contentHash")
        for s in index_samples
        if s.get("artifactId")
    }
    snapshot_hashes = {
        str(s.get("artifactId")): s.get("contentHash")
        for s in governance.get("sourceSnapshot") or []
        if s.get("artifactId")
    }

    warnings: List[str] = []
    matches: Optional[bool]
    if not index_hashes or not snapshot_hashes:
        matches = None
        warnings.append("cannot compare governance sourceSnapshot with index samples")
    else:
        missing = sorted(set(index_hashes) - set(snapshot_hashes))
        changed = sorted(
            artifact_id
            for artifact_id, content_hash in index_hashes.items()
            if artifact_id in snapshot_hashes and snapshot_hashes[artifact_id] != content_hash
        )
        matches = not missing and not changed
        if missing:
            warnings.append("governance sourceSnapshot missing artifacts: " + ", ".join(missing))
        if changed:
            warnings.append("governance sourceSnapshot contentHash differs: " + ", ".join(changed))

    return {
        "available": True,
        "path": governance.get("_path") or governance.get("outputPath"),
        "schemaVersion": governance.get("schemaVersion"),
        "reviewStatus": governance.get("reviewStatus"),
        "maturityStatus": governance.get("maturityStatus"),
        "sourceSnapshotMatchesIndex": matches,
        "warnings": warnings,
    }


def build_governance_maps(governance: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Precompute relationships from governance JSON to evidence variants."""
    maps: Dict[str, Any] = {
        "subtypesByVariant": {},
        "archetypesByVariant": {},
        "familiesByVariant": {},
        "atomPatternsByVariant": {},
        "bindingPatternsByVariant": {},
        "rulePatternsByVariant": {},
        "bundlesByVariant": {},
        "needReviewVariants": set(),
        "items": {},
    }
    if not governance:
        return maps

    families = {str(x.get("id")): x for x in governance.get("slotFamilies") or [] if x.get("id")}
    archetypes = {str(x.get("id")): x for x in governance.get("slotArchetypes") or [] if x.get("id")}
    subtypes = {str(x.get("id")): x for x in governance.get("slotSubtypes") or [] if x.get("id")}
    atom_patterns = {str(x.get("id")): x for x in governance.get("atomPatterns") or [] if x.get("id")}
    binding_patterns = {str(x.get("id")): x for x in governance.get("bindingPatterns") or [] if x.get("id")}
    rule_patterns = {str(x.get("id")): x for x in governance.get("rulePatterns") or [] if x.get("id")}
    bundles = {str(x.get("id")): x for x in governance.get("implementationBundles") or [] if x.get("id")}

    maps["items"] = {
        "families": families,
        "archetypes": archetypes,
        "subtypes": subtypes,
        "atomPatterns": atom_patterns,
        "bindingPatterns": binding_patterns,
        "rulePatterns": rule_patterns,
        "bundles": bundles,
        "bindingPrinciples": {
            str(x.get("id")): x for x in governance.get("bindingPrinciples") or [] if x.get("id")
        },
        "recompositionPolicies": {
            str(x.get("id")): x for x in governance.get("recompositionPolicies") or [] if x.get("id")
        },
        "observedChainPatterns": {
            str(x.get("id")): x for x in governance.get("observedChainPatterns") or [] if x.get("id")
        },
    }

    for subtype in subtypes.values():
        archetype = archetypes.get(str(subtype.get("archetypeId")))
        family = archetypes.get(str(subtype.get("archetypeId")), {}).get("familyId")
        family_item = families.get(str(family)) if family else None
        for variant_id in subtype.get("sourceVariantIds") or []:
            variant_id = str(variant_id)
            maps["subtypesByVariant"].setdefault(variant_id, []).append(subtype)
            if archetype:
                maps["archetypesByVariant"].setdefault(variant_id, []).append(archetype)
            if family_item:
                maps["familiesByVariant"].setdefault(variant_id, []).append(family_item)

    for pattern in atom_patterns.values():
        for variant_id in pattern.get("sourceVariantIds") or []:
            maps["atomPatternsByVariant"].setdefault(str(variant_id), []).append(pattern)
    for pattern in binding_patterns.values():
        for variant_id in pattern.get("sourceVariantIds") or []:
            maps["bindingPatternsByVariant"].setdefault(str(variant_id), []).append(pattern)
    for pattern in rule_patterns.values():
        for variant_id in pattern.get("sourceVariantIds") or []:
            maps["rulePatternsByVariant"].setdefault(str(variant_id), []).append(pattern)
    for bundle in bundles.values():
        for variant_id in bundle.get("sourceVariantIds") or []:
            maps["bundlesByVariant"].setdefault(str(variant_id), []).append(bundle)

    maps["needReviewVariants"] = {
        str(x.get("variantId"))
        for x in governance.get("needReviewMap") or []
        if x.get("variantId")
    }
    return maps


def _item_summary(item: Dict[str, Any], extra_fields: Iterable[str] = ()) -> Dict[str, Any]:
    out = {
        "id": item.get("id"),
        "name": item.get("name"),
        "reviewStatus": item.get("reviewStatus"),
        "maturityStatus": item.get("maturityStatus"),
        "support": item.get("support"),
        "judgementReason": item.get("judgementReason"),
        "riskIfMisclassified": item.get("riskIfMisclassified"),
    }
    for field in extra_fields:
        if field in item:
            out[field] = item.get(field)
    return {k: v for k, v in out.items() if v not in (None, [], {})}


def candidate_governance_variant_ids(candidate: Dict[str, Any]) -> List[str]:
    """Return the slot and atom evidence ids that can attach governance nodes."""
    ids: List[str] = []
    variant_id = candidate.get("variantId")
    if variant_id:
        ids.append(str(variant_id))
    sample_id = candidate.get("sampleId")
    if not sample_id:
        return ids
    for layer, field in [
        ("script", "scriptAtoms"),
        ("rhythm", "rhythmAtoms"),
        ("packaging", "packagingAtoms"),
    ]:
        for atom in candidate.get(field, []) or []:
            atom_id = atom.get("id") if isinstance(atom, dict) else atom
            if atom_id:
                ids.append(f"{sample_id}::{layer}::{atom_id}")
    return ids


def concrete_atom_variant_ids(candidate: Dict[str, Any], field: str, layer: str) -> List[str]:
    sample_id = candidate.get("sampleId")
    if not sample_id:
        return []
    ids: List[str] = []
    for atom in candidate.get(field, []) or []:
        atom_id = atom.get("id") if isinstance(atom, dict) else atom
        if atom_id:
            ids.append(f"{sample_id}::{layer}::{atom_id}")
    return ids


def candidate_governance_ids(candidate: Dict[str, Any], maps: Dict[str, Any]) -> Dict[str, Set[str]]:
    variant_id = str(candidate.get("variantId") or "")
    return {
        "slotSubtypeIds": {str(x.get("id")) for x in maps.get("subtypesByVariant", {}).get(variant_id, []) if x.get("id")},
        "slotArchetypeIds": {str(x.get("id")) for x in maps.get("archetypesByVariant", {}).get(variant_id, []) if x.get("id")},
        "slotFamilyIds": {str(x.get("id")) for x in maps.get("familiesByVariant", {}).get(variant_id, []) if x.get("id")},
        "implementationBundleIds": {str(x.get("id")) for x in maps.get("bundlesByVariant", {}).get(variant_id, []) if x.get("id")},
    }


def _collect_by_ids(mapping: Dict[str, List[Dict[str, Any]]], ids: Iterable[str]) -> List[Dict[str, Any]]:
    seen: Set[str] = set()
    out: List[Dict[str, Any]] = []
    for variant_id in ids:
        for item in mapping.get(str(variant_id), []):
            item_id = str(item.get("id"))
            if item_id in seen:
                continue
            seen.add(item_id)
            out.append(item)
    return out


def enrich_candidate(candidate: Dict[str, Any], maps: Dict[str, Any]) -> Dict[str, Any]:
    variant_id = str(candidate.get("variantId") or "")
    related_variant_ids = candidate_governance_variant_ids(candidate)
    enriched = dict(candidate)
    enriched["governance"] = {
        "slotSubtypes": [
            _item_summary(x, ["archetypeId", "sourceSlotTypes", "viewerTransition", "proofObligation", "solutionVisibility"])
            for x in maps.get("subtypesByVariant", {}).get(variant_id, [])
        ],
        "slotArchetypes": [
            _item_summary(x, ["familyId", "viewerStateBeforeClass", "viewerStateAfterClass", "primaryProofObligationClass", "chainDependencyClass"])
            for x in maps.get("archetypesByVariant", {}).get(variant_id, [])
        ],
        "slotFamilies": [
            _item_summary(x, ["coreViewerTransition"])
            for x in maps.get("familiesByVariant", {}).get(variant_id, [])
        ],
        "atomPatterns": [
            _item_summary(x, ["atomLayer", "parentAtomArchetype", "forSlotSubtypeIds", "claimPattern", "proofNeedClass", "rhythmFunction", "proofType"])
            for x in _collect_by_ids(maps.get("atomPatternsByVariant", {}), related_variant_ids)
        ],
        "bindingPatterns": [
            _item_summary(x, ["bindingType", "condition", "requirement", "riskIfBroken"])
            for x in _collect_by_ids(maps.get("bindingPatternsByVariant", {}), related_variant_ids)
        ],
        "rulePatterns": [
            _item_summary(x, ["ruleType", "condition", "requirement", "violation", "fix"])
            for x in _collect_by_ids(maps.get("rulePatternsByVariant", {}), related_variant_ids)
        ],
        "implementationBundles": [
            _item_summary(x, ["bundleType", "useAs", "notUseAs", "slotSubtypeIds", "scriptPatternIds", "rhythmPatternIds", "packagingPatternIds"])
            for x in maps.get("bundlesByVariant", {}).get(variant_id, [])
        ],
        "needReview": variant_id in maps.get("needReviewVariants", set()),
    }
    return enriched


def governance_score(candidate: Dict[str, Any], brief: Dict[str, Any], maps: Dict[str, Any]) -> Tuple[float, List[str]]:
    """Score candidate against semantic governance without replacing agent judgement."""
    variant_id = str(candidate.get("variantId") or "")
    related_variant_ids = candidate_governance_variant_ids(candidate)
    subtypes = maps.get("subtypesByVariant", {}).get(variant_id, [])
    atom_patterns = _collect_by_ids(maps.get("atomPatternsByVariant", {}), related_variant_ids)
    binding_patterns = _collect_by_ids(maps.get("bindingPatternsByVariant", {}), related_variant_ids)
    rule_patterns = _collect_by_ids(maps.get("rulePatternsByVariant", {}), related_variant_ids)
    bundles = maps.get("bundlesByVariant", {}).get(variant_id, [])
    if not any([subtypes, atom_patterns, binding_patterns, rule_patterns, bundles]):
        return 0.0, []

    score = 0.0
    reasons: List[str] = []
    brief_tokens = set(tokenize(text_blob(brief)))

    for subtype in subtypes:
        score += 2.0
        if subtype.get("reviewStatus") == "reviewed":
            score += 1.0
        if subtype.get("maturityStatus") == "stable":
            score += 1.0
        subtype_tokens = set(tokenize(text_blob({
            "name": subtype.get("name"),
            "viewerTransition": subtype.get("viewerTransition"),
            "proofObligation": subtype.get("proofObligation"),
            "sourceSlotTypes": subtype.get("sourceSlotTypes"),
        })))
        overlap = sorted(brief_tokens & subtype_tokens)
        if overlap:
            score += min(1.5, 0.25 * len(overlap))
        reasons.append("governed subtype: " + str(subtype.get("id")))

    pattern_layers = {str(p.get("atomLayer")) for p in atom_patterns if p.get("atomLayer")}
    if pattern_layers:
        score += 0.4 * len(pattern_layers)
        reasons.append("governed atom patterns: " + ", ".join(sorted(pattern_layers)))
    if binding_patterns:
        score += 0.5
        reasons.append("governed binding patterns available")
    if rule_patterns:
        score += 0.5
        reasons.append("governed rule patterns available")
    for bundle in bundles:
        use_as = str(bundle.get("useAs") or "")
        if "retrieval_prior" in use_as:
            score += 0.4
            reasons.append("implementation bundle prior: " + str(bundle.get("id")))

    if variant_id in maps.get("needReviewVariants", set()):
        score -= 1.5
        reasons.append("governance needReview penalty")

    return score, reasons


def governance_prior_hypotheses(graph: Dict[str, Any], maps: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build chain hypotheses from governance bundles as retrieval priors only."""
    nodes = graph.get("nodes", [])
    demand_by_role = {n["slotRole"]: n["demandId"] for n in nodes}
    subtypes = maps.get("items", {}).get("subtypes", {})
    bundles = maps.get("items", {}).get("bundles", {})
    hypotheses: List[Dict[str, Any]] = []
    for bundle in bundles.values():
        if bundle.get("useAs") != "retrieval_prior_only":
            continue
        sequence: List[str] = []
        for subtype_id in bundle.get("slotSubtypeIds") or []:
            subtype = subtypes.get(str(subtype_id))
            for slot_type in (subtype or {}).get("sourceSlotTypes") or []:
                demand_id = demand_by_role.get(str(slot_type))
                if demand_id and demand_id not in sequence:
                    sequence.append(demand_id)
        if len(sequence) < 2:
            continue
        hypotheses.append({
            "chainId": "GOV_" + str(bundle.get("id")),
            "sequence": sequence,
            "operatorsUsed": ["governance_prior", "selective_reuse"],
            "reason": "来自 semantic-governance implementationBundle；仅作为检索先验，不是固定模板",
            "requiredAdapters": [],
            "risks": [str(bundle.get("riskIfMisclassified"))] if bundle.get("riskIfMisclassified") else [],
            "governancePrior": {
                "bundleId": bundle.get("id"),
                "bundleType": bundle.get("bundleType"),
                "useAs": bundle.get("useAs"),
                "notUseAs": bundle.get("notUseAs"),
                "reviewStatus": bundle.get("reviewStatus"),
                "maturityStatus": bundle.get("maturityStatus"),
            },
        })
    return hypotheses


def governance_audit(governance: Optional[Dict[str, Any]], maps: Dict[str, Any]) -> Dict[str, Any]:
    if not governance:
        return {
            "semanticGovernanceUsed": False,
            "availablePolicies": [],
            "availablePrinciples": [],
            "observedChainPriors": [],
        }
    items = maps.get("items", {})
    return {
        "semanticGovernanceUsed": True,
        "availablePolicies": [
            _item_summary(x, ["policyScope", "policy", "riskIfBroken"])
            for x in items.get("recompositionPolicies", {}).values()
        ],
        "availablePrinciples": [
            _item_summary(x, ["sourcePatternIds"])
            for x in items.get("bindingPrinciples", {}).values()
        ],
        "observedChainPriors": [
            _item_summary(x, ["chainKey", "sequence", "useAs", "notUseAs"])
            for x in items.get("observedChainPatterns", {}).values()
        ],
    }
