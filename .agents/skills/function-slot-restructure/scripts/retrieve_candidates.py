#!/usr/bin/env python3
"""Retrieve slot candidates from a built short-video slot index."""
from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Sequence

from common import read_json, text_blob, tokenize, write_json


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
    if args.duration:
        brief["durationSec"] = args.duration
    return brief


def candidate_score(candidate: Dict[str, Any], brief: Dict[str, Any]) -> Dict[str, Any]:
    score = 0.0
    reasons: List[str] = []
    requested_slot_types = set(brief.get("slotTypes") or [])
    if requested_slot_types and candidate.get("slotType") in requested_slot_types:
        score += 5
        reasons.append("requested slot type match")
    elif requested_slot_types:
        score -= 3

    query_text = " ".join(str(brief.get(k, "")) for k in ["query", "category", "goal", "audience", "style", "mode"])
    query_tokens = set(tokenize(query_text))
    candidate_tokens = set(tokenize(candidate.get("searchText") or text_blob(candidate)))
    matches = sorted(query_tokens & candidate_tokens)
    if matches:
        bump = min(2.0, 0.2 * len(matches))
        score += bump
        reasons.append(f"keyword/function overlap: {', '.join(matches[:8])}")

    confidence = candidate.get("confidence")
    if isinstance(confidence, (int, float)):
        score += float(confidence) * 1.5
        reasons.append(f"confidence {confidence}")

    if candidate.get("needReview"):
        score -= 0.75
        reasons.append("needs review")

    mode = str(brief.get("mode", "")).lower()
    slot_type = str(candidate.get("slotType", ""))
    if "compressed" in mode and slot_type in {"mechanism_credibility", "long_term_trust_close"}:
        score -= 0.3
        reasons.append("possibly heavy for compressed mode")
    if "trust" in mode and "trust" in slot_type:
        score += 1.0
        reasons.append("trust mode fit")
    if "result" in mode and "result" in slot_type:
        score += 1.0
        reasons.append("result-first mode fit")

    # Reward candidates whose atoms have no review flags.
    atom_review_flags = []
    for field in ["scriptAtoms", "rhythmAtoms", "packagingAtoms"]:
        for atom in candidate.get(field, []) or []:
            if atom.get("needReview"):
                atom_review_flags.append(atom.get("id"))
    if atom_review_flags:
        score -= min(1.0, 0.25 * len(atom_review_flags))
        reasons.append("some atoms need review")

    return {"score": round(score, 3), "reasons": reasons}


def retrieve(index: Dict[str, Any], brief: Dict[str, Any], limit: int) -> Dict[str, Any]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for candidate in index.get("slotVariants", []):
        scored = dict(candidate)
        scored.pop("searchText", None)
        scored.pop("raw", None)
        result = candidate_score(candidate, brief)
        scored["score"] = result["score"]
        scored["scoreReasons"] = result["reasons"]
        if not brief.get("slotTypes") or candidate.get("slotType") in set(brief.get("slotTypes") or []):
            grouped[str(candidate.get("slotType"))].append(scored)

    for slot_type in list(grouped):
        grouped[slot_type] = sorted(grouped[slot_type], key=lambda x: x["score"], reverse=True)[:limit]

    requested = brief.get("slotTypes") or sorted(grouped)
    missing = [s for s in requested if s not in grouped or not grouped[s]]

    chain_suggestions = []
    for template in index.get("templates", []):
        seq = template.get("sequence") or []
        if not brief.get("slotTypes") or all(s in seq for s in brief.get("slotTypes", [])):
            chain_suggestions.append({
                "templateId": template.get("templateId"),
                "templateName": template.get("templateName"),
                "sequence": seq,
                "sampleId": template.get("sampleId"),
                "chainKey": template.get("chainKey"),
            })

    return {
        "brief": brief,
        "indexSummary": index.get("summary", {}),
        "candidateGroups": grouped,
        "missingSlotTypes": missing,
        "chainSuggestions": chain_suggestions[:10],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index_json", help="Index JSON from build_slot_index.py")
    parser.add_argument("--brief", help="Brief JSON file")
    parser.add_argument("--query", help="Free-text query or target brief")
    parser.add_argument("--slot-types", help="Comma-separated required slot types")
    parser.add_argument("--category", help="Target category")
    parser.add_argument("--mode", help="Recomposition mode")
    parser.add_argument("--duration", type=float, help="Target duration in seconds")
    parser.add_argument("--limit", type=int, default=3, help="Candidates per slot type")
    parser.add_argument("--out", help="Output JSON path")
    args = parser.parse_args()

    index = read_json(Path(args.index_json))
    brief = load_brief(args.brief, args)
    result = retrieve(index, brief, args.limit)
    if args.out:
        write_json(Path(args.out), result)
        print(f"wrote {args.out}")
    else:
        import json
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
