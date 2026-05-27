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


def score_candidate(candidate: Dict[str, Any], target_slot_type: str, query_tokens: set[str]) -> Dict[str, Any]:
    c_type = str(candidate.get("slotType", ""))
    score = 0.0
    reasons: List[str] = []

    if c_type == target_slot_type:
        score += 50
        reasons.append("exact slotType match")
    elif c_type in related_types(target_slot_type):
        score += 25
        reasons.append("related slotType match")

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

    return {"candidate": candidate, "score": round(score, 3), "reasons": reasons}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", help="slot index JSON")
    parser.add_argument("--brief", help="brief JSON file")
    parser.add_argument("--query", default="", help="plain text query/brief")
    parser.add_argument("--chain", help="comma-separated target slot types")
    parser.add_argument("--top", type=int, default=3)
    args = parser.parse_args()

    index = json.loads(Path(args.index).read_text(encoding="utf-8"))
    brief = json.loads(Path(args.brief).read_text(encoding="utf-8")) if args.brief else None
    target_text = brief_text(brief, args.query)
    query_tokens = tokenize(target_text)
    chain = [x.strip() for x in args.chain.split(",") if x.strip()] if args.chain else DEFAULT_CHAIN

    output = {
        "strategy": "candidate_retrieval",
        "targetText": target_text,
        "targetChain": chain,
        "results": [],
    }

    slots = index.get("slotCandidates") or index.get("slotVariants") or []
    for target_slot_type in chain:
        scored = [score_candidate(slot, target_slot_type, query_tokens) for slot in slots if isinstance(slot, dict)]
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
