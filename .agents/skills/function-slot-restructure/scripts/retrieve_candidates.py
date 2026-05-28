#!/usr/bin/env python3
"""Retrieve slot candidates from a built short-video slot index."""
from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Sequence

from common import read_json, text_blob, tokenize, write_json
from governance import (
    build_governance_maps,
    candidate_governance_ids,
    default_governance_path,
    enrich_candidate,
    governance_audit,
    governance_status,
    load_governance,
)


def load_brief(path: str | None, args: argparse.Namespace) -> Dict[str, Any]:
    brief: Dict[str, Any] = {}
    if path:
        brief.update(read_json(Path(path)))
    if args.query:
        brief["query"] = args.query
    if args.slot_types:
        brief["slotTypes"] = [x.strip() for x in args.slot_types.split(",") if x.strip()]
    if args.category:
        brief["category"] = args.category
    if args.mode:
        brief["mode"] = args.mode
    if getattr(args, "slot_subtypes", None):
        brief["slotSubtypeIds"] = [x.strip() for x in args.slot_subtypes.split(",") if x.strip()]
    if getattr(args, "slot_archetypes", None):
        brief["slotArchetypeIds"] = [x.strip() for x in args.slot_archetypes.split(",") if x.strip()]
    if getattr(args, "bundles", None):
        brief["implementationBundleIds"] = [x.strip() for x in args.bundles.split(",") if x.strip()]
    if args.duration:
        brief["durationSec"] = args.duration
    return brief


def candidate_fit(candidate: Dict[str, Any], brief: Dict[str, Any], governance_maps: Dict[str, Any] | None = None) -> Dict[str, Any]:
    reasons: List[str] = []
    requested_slot_types = set(brief.get("slotTypes") or [])
    requested_subtypes = set(brief.get("slotSubtypeIds") or [])
    requested_archetypes = set(brief.get("slotArchetypeIds") or [])
    requested_bundles = set(brief.get("implementationBundleIds") or [])
    matched = True
    if requested_slot_types:
        matched = candidate.get("slotType") in requested_slot_types
        if matched:
            reasons.append("requested slot type match")

    if governance_maps:
        g_ids = candidate_governance_ids(candidate, governance_maps)
        if requested_subtypes:
            if requested_subtypes & g_ids["slotSubtypeIds"]:
                reasons.append("requested slot subtype match")
            else:
                matched = False
        if requested_archetypes:
            if requested_archetypes & g_ids["slotArchetypeIds"]:
                reasons.append("requested slot archetype match")
            else:
                matched = False
        if requested_bundles:
            if requested_bundles & g_ids["implementationBundleIds"]:
                reasons.append("requested implementation bundle prior match")
            else:
                matched = False

    query_text = " ".join(str(brief.get(k, "")) for k in ["query", "category", "goal", "audience", "style", "mode"])
    query_tokens = set(tokenize(query_text))
    candidate_tokens = set(tokenize(candidate.get("searchText") or text_blob(candidate)))
    matches = sorted(query_tokens & candidate_tokens)
    if matches:
        reasons.append(f"keyword/function overlap: {', '.join(matches[:8])}")

    return {"matched": matched, "reasons": reasons}


def retrieve(index: Dict[str, Any], brief: Dict[str, Any], limit: int, governance: Dict[str, Any] | None = None) -> Dict[str, Any]:
    governance_maps = build_governance_maps(governance)
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for candidate in index.get("slotVariants", []):
        scored = dict(candidate)
        scored.pop("searchText", None)
        scored.pop("raw", None)
        result = candidate_fit(candidate, brief, governance_maps)
        scored["fitReasons"] = result["reasons"]
        scored = enrich_candidate(scored, governance_maps)
        g_ids = candidate_governance_ids(candidate, governance_maps)
        requested_subtypes = set(brief.get("slotSubtypeIds") or [])
        requested_archetypes = set(brief.get("slotArchetypeIds") or [])
        requested_bundles = set(brief.get("implementationBundleIds") or [])
        governance_filter = (
            (not requested_subtypes or bool(requested_subtypes & g_ids["slotSubtypeIds"]))
            and (not requested_archetypes or bool(requested_archetypes & g_ids["slotArchetypeIds"]))
            and (not requested_bundles or bool(requested_bundles & g_ids["implementationBundleIds"]))
        )
        slot_filter = not brief.get("slotTypes") or candidate.get("slotType") in set(brief.get("slotTypes") or [])
        if result["matched"] and slot_filter and governance_filter:
            grouped[str(candidate.get("slotType"))].append(scored)

    for slot_type in list(grouped):
        grouped[slot_type] = grouped[slot_type][:limit]

    requested = brief.get("slotTypes") or sorted(grouped)
    missing = [s for s in requested if s not in grouped or not grouped[s]]

    chain_suggestions = []
    observed_priors = governance_audit(governance, governance_maps).get("observedChainPriors", [])
    for prior in observed_priors:
        chain_suggestions.append({
            "source": "semantic_governance.observedChainPatterns",
            "chainId": prior.get("id"),
            "chainName": prior.get("name"),
            "sequence": prior.get("sequence"),
            "chainKey": prior.get("chainKey"),
            "useAs": prior.get("useAs"),
            "notUseAs": prior.get("notUseAs"),
        })
    for template in index.get("templates", []):
        seq = template.get("sequence") or []
        if not brief.get("slotTypes") or all(s in seq for s in brief.get("slotTypes", [])):
            chain_suggestions.append({
                "source": "evidence_layer.template",
                "templateId": template.get("templateId"),
                "templateName": template.get("templateName"),
                "sequence": seq,
                "sampleId": template.get("sampleId"),
                "chainKey": template.get("chainKey"),
                "useAs": "historical_evidence_only",
                "notUseAs": "fixed_template",
            })

    return {
        "brief": brief,
        "indexSummary": index.get("summary", {}),
        "governanceStatus": governance_status(index, governance),
        "governanceAudit": governance_audit(governance, governance_maps),
        "candidateGroups": grouped,
        "missingSlotTypes": missing,
        "chainSuggestions": chain_suggestions[:10],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index_json", help="Index JSON from build_slot_index.py")
    parser.add_argument("--governance", help="semantic-governance.v1.json path")
    parser.add_argument("--no-governance", action="store_true", help="Disable semantic governance enrichment")
    parser.add_argument("--brief", help="Brief JSON file")
    parser.add_argument("--query", help="Free-text query or target brief")
    parser.add_argument("--slot-types", help="Comma-separated required slot types")
    parser.add_argument("--slot-subtypes", help="Comma-separated required slot subtype ids")
    parser.add_argument("--slot-archetypes", help="Comma-separated required slot archetype ids")
    parser.add_argument("--bundles", help="Comma-separated implementation bundle ids used as retrieval priors")
    parser.add_argument("--category", help="Target category")
    parser.add_argument("--mode", help="Recomposition mode")
    parser.add_argument("--duration", type=float, help="Target duration in seconds")
    parser.add_argument("--limit", type=int, default=3, help="Candidates per slot type")
    parser.add_argument("--out", help="Output JSON path")
    args = parser.parse_args()

    index = read_json(Path(args.index_json))
    governance_path = None if args.no_governance else (Path(args.governance) if args.governance else default_governance_path(Path(args.index_json)))
    governance = None if args.no_governance else load_governance(governance_path)
    brief = load_brief(args.brief, args)
    result = retrieve(index, brief, args.limit, governance)
    if args.out:
        write_json(Path(args.out), result)
        print(f"wrote {args.out}")
    else:
        import json
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
