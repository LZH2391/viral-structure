#!/usr/bin/env python3
"""Assemble a recomposition plan skeleton from a slot index and target brief."""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Dict, List

from common import as_list, read_json, write_json
from retrieve_candidates import retrieve

DEFAULT_SEQUENCES = {
    "faithful_demo": ["problem_activation", "mechanism_credibility", "low_barrier_operation", "result_confirmation", "long_term_trust_close"],
    "result_first": ["result_confirmation", "problem_activation", "low_barrier_operation", "mechanism_credibility", "long_term_trust_close"],
    "compressed": ["problem_activation", "low_barrier_operation", "result_confirmation", "long_term_trust_close"],
    "trust_heavy": ["problem_activation", "long_term_trust_close", "mechanism_credibility", "result_confirmation"],
}


def choose_sequence(index: Dict[str, Any], brief: Dict[str, Any], explicit: List[str] | None) -> List[str]:
    if explicit:
        return explicit
    mode = str(brief.get("mode", "")).lower()
    if "result" in mode:
        return DEFAULT_SEQUENCES["result_first"]
    if "compress" in mode or "short" in mode:
        return DEFAULT_SEQUENCES["compressed"]
    if "trust" in mode:
        return DEFAULT_SEQUENCES["trust_heavy"]
    # Prefer the most supported observed chain, if available.
    support = index.get("summary", {}).get("chainPatternSupport", {})
    if support:
        first = next(iter(support.keys()))
        return [x.strip() for x in first.split(">") if x.strip()]
    return DEFAULT_SEQUENCES["faithful_demo"]


def build_plan(index: Dict[str, Any], brief: Dict[str, Any], sequence: List[str]) -> Dict[str, Any]:
    brief_for_retrieval = dict(brief)
    brief_for_retrieval["slotTypes"] = sequence
    candidates = retrieve(index, brief_for_retrieval, limit=3)

    selected_slots = []
    warnings: List[str] = []
    for order, slot_type in enumerate(sequence, 1):
        group = candidates.get("candidateGroups", {}).get(slot_type) or []
        if not group:
            warnings.append(f"no library candidate found for slot type: {slot_type}; create generated implementation")
            selected_slots.append({
                "order": order,
                "slotType": slot_type,
                "operation": "generated_gap_fill",
                "selectedVariant": None,
                "scriptRole": "generate a script atom matching this slot function",
                "rhythmRole": "select a rhythm pattern compatible with claim density",
                "packagingRole": "assign proof packaging required by the claim",
                "syncPoints": [],
            })
            continue
        candidate = group[0]
        selected_slots.append({
            "order": order,
            "slotType": slot_type,
            "operation": "retrieve_variant",
            "selectedVariant": {
                "variantId": candidate.get("variantId"),
                "sampleId": candidate.get("sampleId"),
                "sourceSlotId": candidate.get("sourceSlotId"),
                "slotName": candidate.get("slotName"),
                "score": candidate.get("score"),
                "scoreReasons": candidate.get("scoreReasons"),
            },
            "viewerStateBefore": candidate.get("viewerStateBefore"),
            "viewerStateAfter": candidate.get("viewerStateAfter"),
            "persuasionTask": candidate.get("persuasionTask"),
            "scriptAtoms": [a.get("id") for a in candidate.get("scriptAtoms", [])],
            "rhythmAtoms": [a.get("id") for a in candidate.get("rhythmAtoms", [])],
            "packagingAtoms": [a.get("id") for a in candidate.get("packagingAtoms", [])],
            "syncPoints": candidate.get("requiredSyncPoints", []),
            "proofNotes": [a.get("proofNeed") for a in candidate.get("scriptAtoms", []) if a.get("proofNeed")],
            "packagingNotes": [a.get("packagingFunction") or a.get("function") for a in candidate.get("packagingAtoms", []) if a.get("packagingFunction") or a.get("function")],
        })

    # Basic cross-slot checks.
    if "problem_activation" in sequence and "result_confirmation" not in sequence:
        warnings.append("problem_activation is present without result_confirmation; ensure the opening concern is paid off elsewhere")
    if "result_confirmation" in sequence and "problem_activation" in sequence:
        if sequence.index("result_confirmation") < sequence.index("problem_activation"):
            warnings.append("result-first chain: later problem_activation must explain the result hook's source concern")
    if "mechanism_credibility" in sequence and sequence[0] == "mechanism_credibility":
        warnings.append("mechanism_credibility as first slot can be slow; add a visual anchor or shorten mechanism")
    if "long_term_trust_close" in sequence:
        warnings.append("long_term_trust_close requires time evidence, usage trace, repeated feedback, or equivalent proof; do not use pure口播 only")

    return {
        "brief": brief,
        "sequence": sequence,
        "selectedSlots": selected_slots,
        "warnings": warnings,
        "nextStep": "Use this skeleton to write script beats, rhythm curve, packaging instructions, and binding audit.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index_json", help="Index JSON from build_slot_index.py")
    parser.add_argument("--brief", help="Brief JSON file")
    parser.add_argument("--mode", help="Mode override, e.g. faithful_demo, result_first, compressed, trust_heavy")
    parser.add_argument("--sequence", help="Comma-separated slot type sequence override")
    parser.add_argument("--out", help="Output JSON path")
    args = parser.parse_args()

    index = read_json(Path(args.index_json))
    brief = read_json(Path(args.brief)) if args.brief else {}
    if args.mode:
        brief["mode"] = args.mode
    sequence = [x.strip() for x in args.sequence.split(",") if x.strip()] if args.sequence else None
    final_sequence = choose_sequence(index, brief, sequence)
    plan = build_plan(index, brief, final_sequence)
    if args.out:
        write_json(Path(args.out), plan)
        print(f"wrote {args.out}")
    else:
        import json
        print(json.dumps(plan, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
