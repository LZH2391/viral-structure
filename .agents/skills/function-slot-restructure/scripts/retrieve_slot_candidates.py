#!/usr/bin/env python3
"""Rank slot candidates from a corpus index for a target brief.

Usage:
  python retrieve_slot_candidates.py slot_index.json --brief brief.json --chain problem_activation,result_confirmation
  python retrieve_slot_candidates.py slot_index.json --query "SaaS sales report one click dashboard" --top 3
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, List

from governance import (
    build_governance_maps,
    candidate_governance_ids,
    default_governance_path,
    enrich_candidate,
    governance_score,
    governance_status,
    load_governance,
)

DEFAULT_CHAIN = [
    "problem_activation",
    "mechanism_credibility",
    "low_barrier_operation",
    "result_confirmation",
    "long_term_trust_close",
]

ALIASES = {
    "hook": ["problem_activation", "contradiction_hook", "result_proof_hook"],
    "problem": ["problem_activation"],
    "mechanism": ["mechanism_credibility", "mechanism_explanation"],
    "step": ["low_barrier_operation", "operation_simplification"],
    "result": ["result_confirmation", "benefit_translation"],
    "trust": ["long_term_trust_close", "trust_close", "social_proof"],
    "close": ["long_term_trust_close", "choice_close"],
}


def tokenize(text: str) -> set[str]:
    return {t for t in re.split(r"[^0-9a-zA-Z_\u4e00-\u9fff]+", text.lower()) if len(t) > 1}


def brief_text(brief: Dict[str, Any] | None, query: str) -> str:
    parts: List[str] = [query or ""]
    if brief:
        for value in brief.values():
            if isinstance(value, str):
                parts.append(value)
            elif isinstance(value, list):
                parts.extend(str(x) for x in value)
            elif isinstance(value, dict):
                parts.extend(str(x) for x in value.values())
            else:
                parts.append(str(value))
    return " ".join(parts)


def related_types(slot_type: str) -> set[str]:
    related = {slot_type}
    for key, values in ALIASES.items():
        if slot_type == key or slot_type in values:
            related.update(values)
    return related


def score_candidate(candidate: Dict[str, Any], target_slot_type: str, query_tokens: set[str], governance_maps: Dict[str, Any] | None = None, brief: Dict[str, Any] | None = None) -> Dict[str, Any]:
    c_type = str(candidate.get("slotType", ""))
    score = 0.0
    reasons: List[str] = []

    if c_type == target_slot_type:
        score += 50
        reasons.append("exact slotType match")
    elif c_type in related_types(target_slot_type):
        score += 25
        reasons.append("related slotType match")

    if governance_maps and brief:
        g_ids = candidate_governance_ids(candidate, governance_maps)
        subtype_ids = set(brief.get("slotSubtypeIds") or [])
        archetype_ids = set(brief.get("slotArchetypeIds") or [])
        bundle_ids = set(brief.get("implementationBundleIds") or [])
        if subtype_ids and subtype_ids & g_ids["slotSubtypeIds"]:
            score += 30
            reasons.append("requested slot subtype match")
        if archetype_ids and archetype_ids & g_ids["slotArchetypeIds"]:
            score += 20
            reasons.append("requested slot archetype match")
        if bundle_ids and bundle_ids & g_ids["implementationBundleIds"]:
            score += 10
            reasons.append("requested implementation bundle prior match")

    text = str(candidate.get("textSignature") or candidate.get("searchText") or "")
    overlap = tokenize(text) & query_tokens
    if overlap:
        score += min(20, len(overlap) * 2)
        reasons.append("brief keyword overlap: " + ", ".join(sorted(list(overlap))[:8]))

    confidence = candidate.get("confidence")
    if isinstance(confidence, (int, float)):
        score += float(confidence) * 10
        reasons.append(f"confidence {confidence}")

    if candidate.get("needReview"):
        score -= 5
        reasons.append("needReview penalty")

    if candidate.get("scriptAtomDetails"):
        score += 2
    if candidate.get("rhythmAtomDetails"):
        score += 2
    if candidate.get("packagingAtomDetails"):
        score += 2

    if governance_maps:
        g_score, g_reasons = governance_score(candidate, brief or {}, governance_maps)
        if g_reasons:
            score += g_score
            reasons.extend(g_reasons)

    enriched = enrich_candidate(candidate, governance_maps or {})
    return {"candidate": enriched, "score": round(score, 3), "reasons": reasons}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", help="slot index JSON")
    parser.add_argument("--governance", help="semantic-governance.v1.json path")
    parser.add_argument("--no-governance", action="store_true", help="Disable semantic governance enrichment")
    parser.add_argument("--brief", help="brief JSON file")
    parser.add_argument("--slot-subtypes", help="comma-separated required slot subtype ids")
    parser.add_argument("--slot-archetypes", help="comma-separated required slot archetype ids")
    parser.add_argument("--bundles", help="comma-separated implementation bundle ids used as retrieval priors")
    parser.add_argument("--query", default="", help="plain text query/brief")
    parser.add_argument("--chain", help="comma-separated target slot types")
    parser.add_argument("--top", type=int, default=3)
    args = parser.parse_args()

    index = json.loads(Path(args.index).read_text(encoding="utf-8"))
    governance_path = None if args.no_governance else (Path(args.governance) if args.governance else default_governance_path(Path(args.index)))
    governance = None if args.no_governance else load_governance(governance_path)
    governance_maps = build_governance_maps(governance)
    brief = json.loads(Path(args.brief).read_text(encoding="utf-8")) if args.brief else None
    if brief is None:
        brief = {}
    if args.slot_subtypes:
        brief["slotSubtypeIds"] = [x.strip() for x in args.slot_subtypes.split(",") if x.strip()]
    if args.slot_archetypes:
        brief["slotArchetypeIds"] = [x.strip() for x in args.slot_archetypes.split(",") if x.strip()]
    if args.bundles:
        brief["implementationBundleIds"] = [x.strip() for x in args.bundles.split(",") if x.strip()]
    target_text = brief_text(brief, args.query)
    query_tokens = tokenize(target_text)
    chain = [x.strip() for x in args.chain.split(",") if x.strip()] if args.chain else DEFAULT_CHAIN

    output = {
        "strategy": "candidate_retrieval",
        "targetText": target_text,
        "targetChain": chain,
        "governanceStatus": governance_status(index, governance),
        "results": [],
    }

    slots = index.get("slotCandidates") or index.get("slotVariants") or []
    for target_slot_type in chain:
        scored = [score_candidate(slot, target_slot_type, query_tokens, governance_maps, brief) for slot in slots if isinstance(slot, dict)]
        scored = [item for item in scored if item["score"] > 0]
        scored.sort(key=lambda item: item["score"], reverse=True)
        output["results"].append({
            "targetSlotType": target_slot_type,
            "topCandidates": scored[: args.top],
        })

    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
