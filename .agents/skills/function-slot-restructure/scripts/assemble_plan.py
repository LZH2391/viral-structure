#!/usr/bin/env python3
"""Assemble a recomposition plan skeleton from a slot index and target brief.

This script intentionally avoids choosing from a fixed strategy menu. It first
builds a slot-demand graph from the brief, then generates chain hypotheses with
operators, retrieves candidates for the demanded slot roles, and returns a
starter plan for human/LLM recomposition.
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Dict, List, Set

from common import as_list, read_json, write_json
from retrieve_candidates import retrieve

ROLE_DEFAULTS: Dict[str, Dict[str, str]] = {
    "problem_activation": {
        "claimType": "problem_to_action",
        "proofFunction": "visible problem object or concern plus direct first action",
        "rhythmNeed": "hook",
        "packagingNeed": "object_visibility",
        "informationLoad": "low",
    },
    "mechanism_credibility": {
        "claimType": "mechanism_explain",
        "proofFunction": "understandable reason, process, comparison, or explanation proof",
        "rhythmNeed": "steady_explain",
        "packagingNeed": "mechanism_visualization",
        "informationLoad": "high",
    },
    "low_barrier_operation": {
        "claimType": "operation_simplification",
        "proofFunction": "minimal steps plus completion action",
        "rhythmNeed": "pause_action",
        "packagingNeed": "step_prompt",
        "informationLoad": "medium",
    },
    "result_confirmation": {
        "claimType": "result_to_benefit",
        "proofFunction": "result evidence tied to earlier concern",
        "rhythmNeed": "payoff_peak",
        "packagingNeed": "result_proof",
        "informationLoad": "medium",
    },
    "long_term_trust_close": {
        "claimType": "trust_to_choice",
        "proofFunction": "time evidence, usage trace, repeated feedback, review, log, or equivalent",
        "rhythmNeed": "proof_close",
        "packagingNeed": "trust_trace_and_choice_memory",
        "informationLoad": "medium",
    },
}

DEFAULT_CAUSAL_ORDER = [
    "problem_activation",
    "mechanism_credibility",
    "low_barrier_operation",
    "result_confirmation",
    "long_term_trust_close",
]


def _text(brief: Dict[str, Any]) -> str:
    parts: List[str] = []
    for key in [
        "query", "category", "audience", "goal", "pain", "problem", "result", "proofAssets",
        "objections", "style", "mode", "platform", "product", "constraints",
    ]:
        val = brief.get(key)
        if isinstance(val, list):
            parts.extend(str(x) for x in val)
        elif isinstance(val, dict):
            parts.extend(str(x) for x in val.values())
        elif val is not None:
            parts.append(str(val))
    return " ".join(parts).lower()


def _available_slot_types(index: Dict[str, Any]) -> Set[str]:
    types = {str(s.get("slotType")) for s in index.get("canonicalSlots", []) if s.get("slotType")}
    types.update(str(v.get("slotType")) for v in index.get("slotVariants", []) if v.get("slotType"))
    return types


def _supported_or_known(slot_type: str, available: Set[str]) -> bool:
    return not available or slot_type in available or slot_type in ROLE_DEFAULTS


def make_demand(slot_type: str, order: int, brief: Dict[str, Any], optionality: str = "required") -> Dict[str, Any]:
    role = ROLE_DEFAULTS.get(slot_type, {})
    return {
        "demandId": f"D{order:02d}",
        "slotRole": slot_type,
        "targetViewerStateBefore": brief.get("viewerStart") or "viewer has not yet accepted this part of the persuasion path",
        "targetViewerStateAfter": "viewer accepts the claim/proof function for this demand",
        "claimType": role.get("claimType", "target_specific_claim"),
        "proofFunction": role.get("proofFunction", "target-specific proof function required"),
        "informationLoad": role.get("informationLoad", "medium"),
        "rhythmNeed": role.get("rhythmNeed", "target_specific_rhythm"),
        "packagingNeed": role.get("packagingNeed", "target_specific_packaging"),
        "requiredCarryovers": [],
        "optionality": optionality,
        "priority": order,
    }


def infer_slot_roles(index: Dict[str, Any], brief: Dict[str, Any], explicit_sequence: List[str] | None) -> List[str]:
    if explicit_sequence:
        return explicit_sequence
    if brief.get("slotTypes"):
        return [str(x) for x in as_list(brief.get("slotTypes"))]

    text = _text(brief)
    available = _available_slot_types(index)
    duration = brief.get("durationSec") or brief.get("duration") or 0
    try:
        duration_num = float(duration)
    except (TypeError, ValueError):
        duration_num = 0

    roles: List[str] = []

    def add(role: str) -> None:
        if role not in roles and _supported_or_known(role, available):
            roles.append(role)

    # Start from target obligations, not a source template.
    if any(k in text for k in ["pain", "problem", "痛", "问题", "卡点", "困扰", "friction", "mess", "error"]):
        add("problem_activation")
    if any(k in text for k in ["action", "demo", "how", "step", "one click", "一键", "操作", "步骤", "演示", "使用"]):
        add("low_barrier_operation")
    if any(k in text for k in ["result", "output", "payoff", "before", "after", "结果", "效果", "产出", "变化"]):
        add("result_confirmation")
    if any(k in text for k in ["why", "mechanism", "explain", "technical", "原理", "机制", "为什么", "可信", "逻辑"]):
        add("mechanism_credibility")
    if any(k in text for k in ["trust", "review", "testimonial", "proof", "long", "repeat", "信任", "背书", "长期", "复购", "记录", "评价"]):
        add("long_term_trust_close")

    # Defaults are obligations, not strategies: a demonstrable persuasion path usually needs these.
    if not roles:
        for role in ["problem_activation", "low_barrier_operation", "result_confirmation"]:
            add(role)
    if "problem_activation" not in roles:
        add("problem_activation")
    if "result_confirmation" not in roles:
        add("result_confirmation")
    if "low_barrier_operation" not in roles and duration_num > 8:
        add("low_barrier_operation")
    if "mechanism_credibility" not in roles and duration_num >= 18 and "mechanism_credibility" in available:
        add("mechanism_credibility")
    if "long_term_trust_close" not in roles and duration_num >= 20 and "long_term_trust_close" in available:
        add("long_term_trust_close")

    order_index = {r: i for i, r in enumerate(DEFAULT_CAUSAL_ORDER)}
    return sorted(roles, key=lambda r: order_index.get(r, 99))


def build_demand_graph(index: Dict[str, Any], brief: Dict[str, Any], explicit_sequence: List[str] | None) -> Dict[str, Any]:
    roles = infer_slot_roles(index, brief, explicit_sequence)
    nodes = [make_demand(role, i, brief) for i, role in enumerate(roles, 1)]
    by_role = {n["slotRole"]: n for n in nodes}
    edges: List[Dict[str, Any]] = []

    def edge(src_role: str, dst_role: str, edge_type: str, constraint: str, hardness: str = "hard") -> None:
        if src_role in by_role and dst_role in by_role:
            edges.append({
                "from": by_role[src_role]["demandId"],
                "to": by_role[dst_role]["demandId"],
                "edgeType": edge_type,
                "constraint": constraint,
                "hardness": hardness,
            })

    edge("problem_activation", "result_confirmation", "carryover", "result proof must return to the activated problem object or concern")
    edge("low_barrier_operation", "result_confirmation", "causal_precede", "operation/action should cause or explain the result payoff")
    edge("mechanism_credibility", "low_barrier_operation", "proof_payoff", "mechanism should clarify why the operation/action matters", "soft")
    edge("mechanism_credibility", "result_confirmation", "proof_payoff", "mechanism claim should make the result more believable", "soft")
    edge("result_confirmation", "long_term_trust_close", "proof_ladder", "result can be strengthened by durable trust evidence", "soft")
    edge("low_barrier_operation", "result_confirmation", "mergeable", "operation and result may merge if action-to-payoff remains visually continuous", "soft")
    edge("result_confirmation", "problem_activation", "hookable", "result can be fragmented as a hook if a bridge explains the source concern", "soft")
    edge("long_term_trust_close", "problem_activation", "hookable", "trust proof can be fragmented as hook if it points to the relevant problem", "soft")

    return {
        "nodes": nodes,
        "edges": edges,
        "mustSatisfy": [
            "every selected node must have a viewer-state transition",
            "each major claim must have a proof function",
            "problem/result carryover must pass or be bridged",
            "operation/result causality must pass or be bridged",
        ],
        "softPreferences": [
            "source diversity",
            "proof feasibility",
            "rhythm coherence",
            "low unnecessary production complexity",
        ],
    }


def generate_chain_hypotheses(graph: Dict[str, Any], brief: Dict[str, Any]) -> List[Dict[str, Any]]:
    nodes = graph.get("nodes", [])
    by_role = {n["slotRole"]: n for n in nodes}
    causal = [n["demandId"] for role in DEFAULT_CAUSAL_ORDER for n in nodes if n["slotRole"] == role]
    if not causal:
        causal = [n["demandId"] for n in nodes]

    text = _text(brief)
    duration = brief.get("durationSec") or brief.get("duration") or 0
    try:
        duration_num = float(duration)
    except (TypeError, ValueError):
        duration_num = 0

    hypotheses: List[Dict[str, Any]] = []

    def add(chain_id: str, sequence: List[str], operators: List[str], reason: str, required_adapters: List[str] | None = None, risks: List[str] | None = None) -> None:
        hypotheses.append({
            "chainId": chain_id,
            "sequence": sequence,
            "operatorsUsed": operators,
            "reason": reason,
            "requiredAdapters": required_adapters or [],
            "risks": risks or [],
        })

    add("H01", causal, ["anchor", "causal_order"], "baseline chain generated from hard viewer-state/proof dependencies")

    result_id = by_role.get("result_confirmation", {}).get("demandId")
    problem_id = by_role.get("problem_activation", {}).get("demandId")
    operation_id = by_role.get("low_barrier_operation", {}).get("demandId")
    trust_id = by_role.get("long_term_trust_close", {}).get("demandId")

    if result_id and any(k in text for k in ["result", "before", "after", "效果", "结果", "对比", "output", "payoff"]):
        seq = [result_id] + [d for d in causal if d != result_id]
        add(
            "H02",
            seq,
            ["fragment", "invert", "bridge"],
            "strong result/output asset can open the video, then the chain explains the source problem and action",
            ["causal_adapter", "object_adapter"],
            ["result hook must not feel unrelated to the later problem"],
        )

    if trust_id and any(k in text for k in ["trust", "review", "testimonial", "long", "proof", "背书", "长期", "评价", "记录"]):
        seq = [trust_id] + [d for d in causal if d != trust_id]
        add(
            "H03",
            seq,
            ["fragment", "anchor", "proof_ladder"],
            "durable trust proof can be used as opening evidence, then unpacked through problem/action/result",
            ["proof_adapter", "object_adapter"],
            ["trust proof must point to the same claim being sold"],
        )

    if duration_num and duration_num <= 15 and operation_id and result_id:
        add(
            "H04",
            [d for d in causal],
            ["merge", "delete_optional"],
            "short duration suggests merging operation and result into one continuous action-payoff unit rather than deleting proof",
            [],
            ["merged segment must still show both action and payoff"],
        )

    if any(k in text for k in ["compare", "vs", "old way", "new way", "误区", "错误", "对比", "以前", "现在"]):
        contrast_id = "D_CONTRAST"
        seq = []
        if problem_id:
            seq.append(problem_id)
        seq.append(contrast_id)
        seq.extend([d for d in causal if d not in seq])
        add(
            "H05",
            seq,
            ["insert", "contrast", "bridge"],
            "target brief suggests an old-way/new-way or mistake-correction contrast node",
            ["claim_adapter"],
            ["contrast node may be outside-library generated if no matching slot exists"],
        )

    return score_hypotheses(hypotheses, graph, brief)


def score_hypotheses(hypotheses: List[Dict[str, Any]], graph: Dict[str, Any], brief: Dict[str, Any]) -> List[Dict[str, Any]]:
    node_ids = {n["demandId"] for n in graph.get("nodes", [])}
    hard_edges = [e for e in graph.get("edges", []) if e.get("hardness") == "hard"]
    text = _text(brief)
    for h in hypotheses:
        score = 0.0
        seq = h.get("sequence", [])
        present = set(seq)
        score += 2.0 * len(present & node_ids)
        missing = sorted(node_ids - present)
        if missing:
            score -= 3.0 * len(missing)
            h.setdefault("risks", []).append(f"missing required demands: {', '.join(missing)}")
        for e in hard_edges:
            src, dst = e.get("from"), e.get("to")
            if src in present and dst in present:
                if seq.index(src) < seq.index(dst):
                    score += 1.5
                else:
                    score -= 0.5
                    h.setdefault("requiredAdapters", []).append(f"bridge {src}->{dst}: {e.get('edgeType')}")
        if "invert" in h.get("operatorsUsed", []) and any(k in text for k in ["result", "效果", "结果", "before", "after", "output"]):
            score += 1.0
        if "proof_ladder" in h.get("operatorsUsed", []) and any(k in text for k in ["trust", "proof", "背书", "长期", "review"]):
            score += 1.0
        if "merge" in h.get("operatorsUsed", []) and (brief.get("durationSec") or brief.get("duration")):
            score += 0.5
        h["score"] = round(score, 3)
    return sorted(hypotheses, key=lambda x: x.get("score", 0), reverse=True)


def select_chain(hypotheses: List[Dict[str, Any]]) -> Dict[str, Any]:
    return hypotheses[0] if hypotheses else {"chainId": "H00", "sequence": [], "operatorsUsed": [], "reason": "no hypothesis generated"}


def build_plan(index: Dict[str, Any], brief: Dict[str, Any], sequence_override: List[str] | None) -> Dict[str, Any]:
    demand_graph = build_demand_graph(index, brief, sequence_override)
    hypotheses = generate_chain_hypotheses(demand_graph, brief)
    selected_chain = select_chain(hypotheses)

    demand_by_id = {n["demandId"]: n for n in demand_graph.get("nodes", [])}
    demanded_slot_types = [demand_by_id[d]["slotRole"] for d in selected_chain.get("sequence", []) if d in demand_by_id]

    brief_for_retrieval = dict(brief)
    brief_for_retrieval["slotTypes"] = demanded_slot_types
    candidates = retrieve(index, brief_for_retrieval, limit=3)

    selected_slots = []
    warnings: List[str] = []
    for order, demand_id in enumerate(selected_chain.get("sequence", []), 1):
        if demand_id not in demand_by_id:
            selected_slots.append({
                "order": order,
                "demandId": demand_id,
                "slotType": "generated_or_inserted_bridge",
                "operation": "generated_gap_fill",
                "selectedVariant": None,
                "scriptRole": "generate a bridge script atom matching this inserted demand",
                "rhythmRole": "choose a rhythm adapter compatible with adjacent slots",
                "packagingRole": "preserve the proof or transition function of the bridge",
                "syncPoints": [],
            })
            warnings.append(f"inserted/generated demand has no direct library slot: {demand_id}")
            continue

        demand = demand_by_id[demand_id]
        slot_type = demand["slotRole"]
        group = candidates.get("candidateGroups", {}).get(slot_type) or []
        if not group:
            warnings.append(f"no library candidate found for demand {demand_id} / slot type: {slot_type}; create generated implementation")
            selected_slots.append({
                "order": order,
                "demandId": demand_id,
                "slotType": slot_type,
                "operation": "generated_gap_fill",
                "selectedVariant": None,
                "demand": demand,
                "scriptRole": "generate a script atom matching this demand's claim/proof function",
                "rhythmRole": "select a rhythm pattern compatible with information load",
                "packagingRole": "assign proof packaging required by the demand",
                "syncPoints": [],
            })
            continue
        candidate = group[0]
        selected_slots.append({
            "order": order,
            "demandId": demand_id,
            "slotType": slot_type,
            "operation": "retrieve_variant_then_adapt",
            "selectedVariant": {
                "variantId": candidate.get("variantId"),
                "sampleId": candidate.get("sampleId"),
                "sourceSlotId": candidate.get("sourceSlotId"),
                "slotName": candidate.get("slotName"),
                "score": candidate.get("score"),
                "scoreReasons": candidate.get("scoreReasons"),
            },
            "demand": demand,
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

    if selected_chain.get("requiredAdapters"):
        warnings.append("selected chain requires adapters: " + ", ".join(selected_chain.get("requiredAdapters", [])))

    return {
        "brief": brief,
        "briefConstraints": {
            "viewerStart": brief.get("viewerStart"),
            "viewerEnd": brief.get("viewerEnd"),
            "durationSec": brief.get("durationSec") or brief.get("duration"),
            "proofAssets": brief.get("proofAssets"),
            "objections": brief.get("objections"),
        },
        "slotDemandGraph": demand_graph,
        "chainHypotheses": hypotheses,
        "selectedChain": selected_chain,
        "selectedSlots": selected_slots,
        "warnings": warnings,
        "nextStep": "Use this skeleton to write script beats, rhythm curve, packaging instructions, adapters, and binding audit.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index_json", help="Index JSON from build_slot_index.py")
    parser.add_argument("--brief", help="Brief JSON file")
    parser.add_argument("--mode", help="Legacy field accepted only as a brief hint, not as a strategy selector")
    parser.add_argument("--sequence", help="Comma-separated explicit slot type sequence override")
    parser.add_argument("--out", help="Output JSON path")
    args = parser.parse_args()

    index = read_json(Path(args.index_json))
    brief = read_json(Path(args.brief)) if args.brief else {}
    if args.mode:
        brief["mode"] = args.mode
    sequence = [x.strip() for x in args.sequence.split(",") if x.strip()] if args.sequence else None
    plan = build_plan(index, brief, sequence)
    if args.out:
        write_json(Path(args.out), plan)
        print(f"wrote {args.out}")
    else:
        import json
        print(json.dumps(plan, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
