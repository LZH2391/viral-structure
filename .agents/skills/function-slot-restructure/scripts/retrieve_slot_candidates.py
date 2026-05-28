#!/usr/bin/env python3
"""List slot evidence variants from a corpus index for a target brief.

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
    governance_status,
    load_governance,
)


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
    normalized = slot_type.replace("-", "_")
    parts = {part for part in normalized.split("_") if part}
    return {slot_type, normalized, *parts}


def default_chain_from_index(index: Dict[str, Any], limit: int = 5) -> List[str]:
    canonical = index.get("canonicalSlots") or []
    if canonical:
        ordered = sorted(
            canonical,
            key=lambda item: (item.get("support") or {}).get("variantCount") or 0,
            reverse=True,
        )
        return [str(item.get("slotType")) for item in ordered[:limit] if item.get("slotType")]
    seen: List[str] = []
    for slot in index.get("slotVariants") or []:
        slot_type = slot.get("slotType")
        if slot_type and slot_type not in seen:
            seen.append(str(slot_type))
    return seen[:limit]


def fit_candidate(candidate: Dict[str, Any], target_slot_type: str, query_tokens: set[str], governance_maps: Dict[str, Any] | None = None, brief: Dict[str, Any] | None = None) -> Dict[str, Any]:
    c_type = str(candidate.get("slotType", ""))
    reasons: List[str] = []
    matched = False

    if c_type == target_slot_type:
        matched = True
        reasons.append("exact slotType match")
    elif c_type in related_types(target_slot_type):
        matched = True
        reasons.append("related slotType match")

    if governance_maps and brief:
        g_ids = candidate_governance_ids(candidate, governance_maps)
        subtype_ids = set(brief.get("slotSubtypeIds") or [])
        archetype_ids = set(brief.get("slotArchetypeIds") or [])
        bundle_ids = set(brief.get("implementationBundleIds") or [])
        if subtype_ids and subtype_ids & g_ids["slotSubtypeIds"]:
            matched = True
            reasons.append("requested slot subtype match")
        if archetype_ids and archetype_ids & g_ids["slotArchetypeIds"]:
            matched = True
            reasons.append("requested slot archetype match")
        if bundle_ids and bundle_ids & g_ids["implementationBundleIds"]:
            matched = True
            reasons.append("requested implementation bundle prior match")

    text = str(candidate.get("textSignature") or candidate.get("searchText") or "")
    overlap = tokenize(text) & query_tokens
    if overlap:
        reasons.append("brief keyword overlap: " + ", ".join(sorted(list(overlap))[:8]))

    enriched = enrich_candidate(candidate, governance_maps or {})
    return {"candidate": enriched, "matched": matched, "reasons": reasons}


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

    index = json.loads(Path(args.index).read_text(encoding="utf-8-sig"))
    governance_path = None if args.no_governance else (Path(args.governance) if args.governance else default_governance_path(Path(args.index)))
    governance = None if args.no_governance else load_governance(governance_path)
    governance_maps = build_governance_maps(governance)
    brief = json.loads(Path(args.brief).read_text(encoding="utf-8-sig")) if args.brief else None
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
    chain = [x.strip() for x in args.chain.split(",") if x.strip()] if args.chain else default_chain_from_index(index)

    output = {
        "strategy": "evidence_variant_listing",
        "targetText": target_text,
        "targetChain": chain,
        "governanceStatus": governance_status(index, governance),
        "results": [],
    }

    slots = index.get("slotCandidates") or index.get("slotVariants") or []
    for target_slot_type in chain:
        scored = [fit_candidate(slot, target_slot_type, query_tokens, governance_maps, brief) for slot in slots if isinstance(slot, dict)]
        scored = [item for item in scored if item["matched"]]
        output["results"].append({
            "targetSlotType": target_slot_type,
            "evidenceVariants": scored[: args.top],
        })

    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
