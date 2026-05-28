#!/usr/bin/env python3
"""根据槽位索引和目标 brief 组装重组方案骨架。

本脚本刻意避免从固定策略菜单中选择。它会先从 brief 构建槽位需求图，
再用操作符生成链路假设，为需求槽位角色检索候选，并返回一个供人工
或 LLM 继续重组的起始方案。
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Dict, List, Set

from common import as_list, normalize_text, read_json, text_blob, tokenize, write_json
from governance import (
    build_governance_maps,
    concrete_atom_variant_ids,
    default_governance_path,
    governance_audit,
    governance_prior_hypotheses,
    governance_status,
    load_governance,
)
from retrieve_candidates import retrieve

ROLE_FUNCTION_HINTS = [
    {
        "functionClass": "problem_or_need",
        "keywords": ["problem", "pain", "concern", "friction", "error", "旧状态", "痛点", "问题", "困扰", "卡点", "需求"],
        "claimType": "problem_or_need_claim",
        "proofFunction": "让目标问题、旧状态、成本或需求变得可见",
        "rhythmNeed": "attention_activation",
        "packagingNeed": "object_or_concern_visibility",
        "informationLoad": "low",
    },
    {
        "functionClass": "solution_or_action",
        "keywords": ["solution", "entry", "action", "operation", "step", "demo", "use", "解决", "入口", "动作", "操作", "步骤", "演示"],
        "claimType": "solution_or_action_claim",
        "proofFunction": "展示解决对象、动作路径或可执行步骤",
        "rhythmNeed": "action_continuity",
        "packagingNeed": "step_or_action_proof",
        "informationLoad": "medium",
    },
    {
        "functionClass": "mechanism_or_explanation",
        "keywords": ["mechanism", "why", "explain", "credibility", "proof", "compare", "原因", "机制", "原理", "解释", "可信", "对比"],
        "claimType": "mechanism_or_evidence_claim",
        "proofFunction": "用机制、对比、结构、过程或解释证明主张成立",
        "rhythmNeed": "steady_explanation",
        "packagingNeed": "evidence_visualization",
        "informationLoad": "high",
    },
    {
        "functionClass": "result_or_payoff",
        "keywords": ["result", "payoff", "benefit", "output", "close", "效果", "结果", "产出", "变化", "收益", "收束"],
        "claimType": "result_or_benefit_claim",
        "proofFunction": "用结果、变化、收益或场景反馈闭合前文关切",
        "rhythmNeed": "payoff_or_closure",
        "packagingNeed": "result_or_benefit_proof",
        "informationLoad": "medium",
    },
    {
        "functionClass": "trust_or_choice",
        "keywords": ["trust", "review", "testimonial", "long", "repeat", "choice", "信任", "背书", "长期", "记录", "评价", "选择"],
        "claimType": "trust_or_choice_claim",
        "proofFunction": "提供长期、重复、社会证明或最终选择记忆点",
        "rhythmNeed": "trust_close",
        "packagingNeed": "trust_trace_or_choice_memory",
        "informationLoad": "medium",
    },
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
    return not available or slot_type in available


def slot_evidence_blob(index: Dict[str, Any], slot_type: str) -> str:
    parts: List[Any] = []
    for item in index.get("canonicalSlots", []) or []:
        if item.get("slotType") == slot_type:
            parts.append(item)
    for item in index.get("slotVariants", []) or []:
        if item.get("slotType") == slot_type:
            parts.append({
                "slotName": item.get("slotName"),
                "viewerStateBefore": item.get("viewerStateBefore"),
                "viewerStateAfter": item.get("viewerStateAfter"),
                "persuasionTask": item.get("persuasionTask"),
                "scriptAtoms": item.get("scriptAtoms"),
                "rhythmAtoms": item.get("rhythmAtoms"),
                "packagingAtoms": item.get("packagingAtoms"),
            })
    return text_blob(parts)


def slot_support_count(index: Dict[str, Any], slot_type: str) -> int:
    for item in index.get("canonicalSlots", []) or []:
        if item.get("slotType") == slot_type:
            return int((item.get("support") or {}).get("variantCount") or 0)
    return sum(1 for item in index.get("slotVariants", []) or [] if item.get("slotType") == slot_type)


def role_profile(index: Dict[str, Any], slot_type: str) -> Dict[str, str]:
    slot_type_text = normalize_text(slot_type)
    blob = normalize_text(f"{slot_type} {slot_evidence_blob(index, slot_type)}")
    profile = {
        "functionClass": "target_specific",
        "claimType": "target_specific_claim",
        "proofFunction": "需要目标特定的证明功能",
        "rhythmNeed": "target_specific_rhythm",
        "packagingNeed": "target_specific_packaging",
        "informationLoad": "medium",
    }
    best_hint = None
    best_hits = 0
    for hint in ROLE_FUNCTION_HINTS:
        slot_name_hits = sum(1 for keyword in hint["keywords"] if keyword in slot_type_text)
        evidence_hits = sum(1 for keyword in hint["keywords"] if keyword in blob)
        hits = slot_name_hits * 3 + evidence_hits
        if hits > best_hits:
            best_hint = hint
            best_hits = hits
    if best_hint:
        profile.update({key: str(value) for key, value in best_hint.items() if key != "keywords"})

    proof_notes: List[str] = []
    for variant in index.get("slotVariants", []) or []:
        if variant.get("slotType") != slot_type:
            continue
        for atom in as_list(variant.get("scriptAtoms")):
            if isinstance(atom, dict) and atom.get("proofNeed"):
                proof_notes.append(str(atom.get("proofNeed")))
        for atom in as_list(variant.get("packagingAtoms")):
            if isinstance(atom, dict) and (atom.get("packagingFunction") or atom.get("function")):
                proof_notes.append(str(atom.get("packagingFunction") or atom.get("function")))
    if proof_notes:
        profile["proofFunction"] = proof_notes[0]
    return profile


def make_demand(index: Dict[str, Any], slot_type: str, order: int, brief: Dict[str, Any], optionality: str = "required") -> Dict[str, Any]:
    role = role_profile(index, slot_type)
    return {
        "demandId": f"D{order:02d}",
        "slotRole": slot_type,
        "targetViewerStateBefore": brief.get("viewerStart") or "观众尚未接受这段说服路径中的当前部分",
        "targetViewerStateAfter": "观众接受该需求对应的主张/证明功能",
        "functionClass": role.get("functionClass", "target_specific"),
        "claimType": role.get("claimType", "target_specific_claim"),
        "proofFunction": role.get("proofFunction", "需要目标特定的证明功能"),
        "informationLoad": role.get("informationLoad", "medium"),
        "rhythmNeed": role.get("rhythmNeed", "target_specific_rhythm"),
        "packagingNeed": role.get("packagingNeed", "target_specific_packaging"),
        "requiredCarryovers": [],
        "optionality": optionality,
        "priority": order,
    }


def score_slot_role(index: Dict[str, Any], brief_tokens: Set[str], slot_type: str) -> float:
    blob = normalize_text(f"{slot_type} {slot_evidence_blob(index, slot_type)}")
    slot_tokens = set(tokenize(blob))
    score = float(len(brief_tokens & slot_tokens))
    for hint in ROLE_FUNCTION_HINTS:
        brief_hits = sum(1 for keyword in hint["keywords"] if keyword in brief_tokens or keyword in _text_tokens_as_text(brief_tokens))
        slot_hits = sum(1 for keyword in hint["keywords"] if keyword in blob)
        if brief_hits and slot_hits:
            score += min(3.0, 0.75 * min(brief_hits, slot_hits))
    score += min(2.0, 0.25 * slot_support_count(index, slot_type))
    return score


def _text_tokens_as_text(tokens: Set[str]) -> str:
    return " ".join(sorted(tokens))


def desired_function_classes(brief: Dict[str, Any]) -> List[str]:
    text = _text(brief)
    classes: List[str] = []

    def add(function_class: str) -> None:
        if function_class not in classes:
            classes.append(function_class)

    if brief.get("pain") or brief.get("problem") or any(k in text for k in ["pain", "problem", "痛", "问题", "卡点", "困扰", "friction", "mess", "error", "旧状态", "耗时", "异常", "手工"]):
        add("problem_or_need")
    if any(k in text for k in ["action", "demo", "how", "step", "one click", "一键", "操作", "步骤", "演示", "使用", "屏幕录制"]):
        add("solution_or_action")
    if brief.get("result") or any(k in text for k in ["result", "output", "payoff", "before", "after", "结果", "效果", "产出", "变化", "前后"]):
        add("result_or_payoff")
    if any(k in text for k in ["why", "mechanism", "explain", "technical", "原理", "机制", "为什么", "逻辑"]):
        add("mechanism_or_explanation")
    if any(k in text for k in ["trust", "review", "testimonial", "long", "repeat", "信任", "背书", "长期", "复购", "记录", "评价"]):
        add("trust_or_choice")
    return classes


def evidence_order(index: Dict[str, Any], roles: List[str]) -> List[str]:
    position_sum: Dict[str, float] = {role: 0.0 for role in roles}
    position_count: Dict[str, int] = {role: 0 for role in roles}
    for variant in index.get("slotVariants", []) or []:
        role = str(variant.get("slotType") or "")
        if role not in position_sum:
            continue
        order = variant.get("slotOrder")
        if isinstance(order, (int, float)):
            position_sum[role] += float(order)
            position_count[role] += 1

    input_order = {role: i for i, role in enumerate(roles)}

    def sort_key(role: str) -> tuple[float, int]:
        if position_count[role]:
            return (position_sum[role] / position_count[role], input_order[role])
        return (999.0, input_order[role])

    return sorted(roles, key=sort_key)


def infer_slot_roles(index: Dict[str, Any], brief: Dict[str, Any], explicit_sequence: List[str] | None) -> List[str]:
    if explicit_sequence:
        return explicit_sequence
    if brief.get("slotTypes"):
        return [str(x) for x in as_list(brief.get("slotTypes"))]

    available = _available_slot_types(index)
    duration = brief.get("durationSec") or brief.get("duration") or 0
    try:
        duration_num = float(duration)
    except (TypeError, ValueError):
        duration_num = 0

    brief_tokens = set(tokenize(_text(brief)))
    scored = [
        (slot_type, score_slot_role(index, brief_tokens, slot_type))
        for slot_type in available
    ]
    scored = sorted(scored, key=lambda item: (item[1], slot_support_count(index, item[0])), reverse=True)
    roles: List[str] = []
    for function_class in desired_function_classes(brief):
        class_candidates = [
            (slot_type, score)
            for slot_type, score in scored
            if role_profile(index, slot_type).get("functionClass") == function_class
        ]
        if class_candidates:
            roles.append(class_candidates[0][0])

    positive_roles = [slot_type for slot_type, score in scored if score > 0 and slot_type not in roles]
    if positive_roles:
        target_count = 3 if duration_num and duration_num <= 15 else 5
        roles.extend(positive_roles[: max(0, target_count - len(roles))])
        return evidence_order(index, roles[:target_count])

    fallback_roles = [
        str(item.get("slotType"))
        for item in sorted(
            index.get("canonicalSlots", []) or [],
            key=lambda item: (item.get("support") or {}).get("variantCount") or 0,
            reverse=True,
        )
        if item.get("slotType")
    ]
    target_count = 3 if duration_num and duration_num <= 15 else 5
    return evidence_order(index, fallback_roles[:target_count])


def build_demand_graph(index: Dict[str, Any], brief: Dict[str, Any], explicit_sequence: List[str] | None) -> Dict[str, Any]:
    roles = infer_slot_roles(index, brief, explicit_sequence)
    nodes = [make_demand(index, role, i, brief) for i, role in enumerate(roles, 1)]
    edges: List[Dict[str, Any]] = []

    for left, right in zip(nodes, nodes[1:]):
        edges.append({
            "from": left["demandId"],
            "to": right["demandId"],
            "edgeType": "sequence_continuity",
            "constraint": "后一个需求必须承接前一个需求的对象、主张或证明线索",
            "hardness": "hard",
        })
        if right.get("functionClass") == "result_or_payoff":
            edges.append({
                "from": left["demandId"],
                "to": right["demandId"],
                "edgeType": "proof_payoff",
                "constraint": "结果或收益槽必须回收上游关切、动作或证明",
                "hardness": "hard",
            })
        if left.get("functionClass") == "solution_or_action" and right.get("functionClass") == "result_or_payoff":
            edges.append({
                "from": left["demandId"],
                "to": right["demandId"],
                "edgeType": "mergeable",
                "constraint": "动作和结果可合并，但必须保留动作到兑现的可见连续性",
                "hardness": "soft",
            })

    for node in nodes:
        if node.get("functionClass") in {"result_or_payoff", "trust_or_choice"} and nodes:
            edges.append({
                "from": node["demandId"],
                "to": nodes[0]["demandId"],
                "edgeType": "hookable",
                "constraint": "强证明片段可以前置为 hook，但必须桥接回原始关切",
                "hardness": "soft",
            })

    return {
        "nodes": nodes,
        "edges": edges,
        "mustSatisfy": [
            "每个选中节点都必须有观众状态跃迁",
            "每个主要主张都必须有证明功能",
            "相邻需求之间必须保留对象、主张或证明承接",
            "结果、收益或信任证明必须闭合上游关切，或显式桥接",
        ],
        "softPreferences": [
            "来源多样性",
            "证明可行性",
            "节奏连贯性",
            "降低不必要的生产复杂度",
        ],
    }


def generate_chain_hypotheses(graph: Dict[str, Any], brief: Dict[str, Any], governance_maps: Dict[str, Any] | None = None) -> List[Dict[str, Any]]:
    nodes = graph.get("nodes", [])
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

    add("H01", causal, ["anchor", "causal_order"], "根据硬性的观众状态/证明依赖生成的基准链路")

    result_id = first_demand_id(nodes, "result_or_payoff")
    problem_id = first_demand_id(nodes, "problem_or_need")
    operation_id = first_demand_id(nodes, "solution_or_action")
    trust_id = first_demand_id(nodes, "trust_or_choice")

    if result_id and any(k in text for k in ["result", "before", "after", "效果", "结果", "对比", "output", "payoff"]):
        seq = [result_id] + [d for d in causal if d != result_id]
        add(
            "H02",
            seq,
            ["fragment", "invert", "bridge"],
            "强结果/输出资产可以作为开场，然后链路解释来源问题和动作",
            ["causal_adapter", "object_adapter"],
            ["结果 hook 不能让人感觉和后续问题无关"],
        )

    if trust_id and any(k in text for k in ["trust", "review", "testimonial", "long", "proof", "背书", "长期", "评价", "记录"]):
        seq = [trust_id] + [d for d in causal if d != trust_id]
        add(
            "H03",
            seq,
            ["fragment", "anchor", "proof_ladder"],
            "耐久信任证明可以作为开场证据，然后通过问题/动作/结果展开",
            ["proof_adapter", "object_adapter"],
            ["信任证明必须指向正在销售的同一主张"],
        )

    if duration_num and duration_num <= 15 and operation_id and result_id:
        add(
            "H04",
            [d for d in causal],
            ["merge", "delete_optional"],
            "时长较短时，应把操作和结果合并为连续的动作-兑现单元，而不是删除证明",
            [],
            ["合并片段仍必须同时展示动作和兑现"],
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
            "目标 brief 暗示需要旧方式/新方式或误区纠正的对比节点",
            ["claim_adapter"],
            ["如果没有匹配槽位，对比节点可能需要在库外生成"],
        )

    if governance_maps:
        hypotheses.extend(governance_prior_hypotheses(graph, governance_maps))
    return score_hypotheses(hypotheses, graph, brief)


def first_demand_id(nodes: List[Dict[str, Any]], function_class: str) -> str | None:
    for node in nodes:
        if node.get("functionClass") == function_class:
            return str(node.get("demandId"))
    return None


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
            h.setdefault("risks", []).append(f"缺少必需需求: {', '.join(missing)}")
        for e in hard_edges:
            src, dst = e.get("from"), e.get("to")
            if src in present and dst in present:
                if seq.index(src) < seq.index(dst):
                    score += 1.5
                else:
                    score -= 0.5
                    h.setdefault("requiredAdapters", []).append(f"桥接 {src}->{dst}: {e.get('edgeType')}")
        if "invert" in h.get("operatorsUsed", []) and any(k in text for k in ["result", "效果", "结果", "before", "after", "output"]):
            score += 1.0
        if "proof_ladder" in h.get("operatorsUsed", []) and any(k in text for k in ["trust", "proof", "背书", "长期", "review"]):
            score += 1.0
        if "merge" in h.get("operatorsUsed", []) and (brief.get("durationSec") or brief.get("duration")):
            score += 0.5
        h["score"] = round(score, 3)
    return sorted(hypotheses, key=lambda x: x.get("score", 0), reverse=True)


def select_chain(hypotheses: List[Dict[str, Any]]) -> Dict[str, Any]:
    return hypotheses[0] if hypotheses else {"chainId": "H00", "sequence": [], "operatorsUsed": [], "reason": "未生成链路假设"}


def build_plan(index: Dict[str, Any], brief: Dict[str, Any], sequence_override: List[str] | None, governance: Dict[str, Any] | None = None) -> Dict[str, Any]:
    governance_maps = build_governance_maps(governance)
    g_status = governance_status(index, governance)
    demand_graph = build_demand_graph(index, brief, sequence_override)
    hypotheses = generate_chain_hypotheses(demand_graph, brief, governance_maps)
    selected_chain = select_chain(hypotheses)

    demand_by_id = {n["demandId"]: n for n in demand_graph.get("nodes", [])}
    demanded_slot_types = [demand_by_id[d]["slotRole"] for d in selected_chain.get("sequence", []) if d in demand_by_id]

    brief_for_retrieval = dict(brief)
    brief_for_retrieval["slotTypes"] = demanded_slot_types
    candidates = retrieve(index, brief_for_retrieval, limit=3, governance=governance)

    selected_slots = []
    warnings: List[str] = list(g_status.get("warnings") or [])
    for order, demand_id in enumerate(selected_chain.get("sequence", []), 1):
        if demand_id not in demand_by_id:
            selected_slots.append({
                "order": order,
                "demandId": demand_id,
                "slotType": "generated_or_inserted_bridge",
                "operation": "generated_gap_fill",
                "selectedVariant": None,
                "slotChainGranularity": "slotSubtype",
                "selectedSlotSubtypeIds": [],
                "parentSlotArchetypeIds": [],
                "scriptRole": "生成匹配该插入需求的桥接脚本原子",
                "rhythmRole": "选择与相邻槽位兼容的节奏适配器",
                "packagingRole": "保留桥接的证明或转场功能",
                "scriptConcreteAtomVariants": [],
                "rhythmConcreteAtomVariants": [],
                "packagingConcreteAtomVariants": [],
                "fallback": "generated_gap_fill",
                "syncPoints": [],
            })
            warnings.append(f"插入/生成的需求没有直接对应的库槽位: {demand_id}")
            continue

        demand = demand_by_id[demand_id]
        slot_type = demand["slotRole"]
        group = candidates.get("candidateGroups", {}).get(slot_type) or []
        if not group:
            warnings.append(f"没有为需求 {demand_id} / slot type {slot_type} 找到库候选；需要创建生成式实现")
            selected_slots.append({
                "order": order,
                "demandId": demand_id,
                "slotType": slot_type,
                "operation": "generated_gap_fill",
                "selectedVariant": None,
                "slotChainGranularity": "slotSubtype",
                "selectedSlotSubtypeIds": [],
                "parentSlotArchetypeIds": [],
                "demand": demand,
                "scriptRole": "生成匹配该需求主张/证明功能的脚本原子",
                "rhythmRole": "选择与信息负载兼容的节奏模式",
                "packagingRole": "分配该需求所需的证明包装",
                "scriptConcreteAtomVariants": [],
                "rhythmConcreteAtomVariants": [],
                "packagingConcreteAtomVariants": [],
                "fallback": "generated_gap_fill",
                "syncPoints": [],
            })
            continue
        candidate = group[0]
        candidate_governance = candidate.get("governance") or {}
        selected_slots.append({
            "order": order,
            "demandId": demand_id,
            "slotType": slot_type,
            "operation": "retrieve_variant_then_adapt",
            "slotChainGranularity": "slotSubtype",
            "selectedSlotSubtypeIds": [x.get("id") for x in candidate_governance.get("slotSubtypes", []) if x.get("id")],
            "parentSlotArchetypeIds": [x.get("id") for x in candidate_governance.get("slotArchetypes", []) if x.get("id")],
            "selectedVariant": {
                "variantId": candidate.get("variantId"),
                "sampleId": candidate.get("sampleId"),
                "sourceSlotId": candidate.get("sourceSlotId"),
                "slotName": candidate.get("slotName"),
                "score": candidate.get("score"),
                "scoreReasons": candidate.get("scoreReasons"),
            },
            "governance": candidate_governance,
            "demand": demand,
            "viewerStateBefore": candidate.get("viewerStateBefore"),
            "viewerStateAfter": candidate.get("viewerStateAfter"),
            "persuasionTask": candidate.get("persuasionTask"),
            "scriptAtoms": [a.get("id") for a in candidate.get("scriptAtoms", [])],
            "rhythmAtoms": [a.get("id") for a in candidate.get("rhythmAtoms", [])],
            "packagingAtoms": [a.get("id") for a in candidate.get("packagingAtoms", [])],
            "scriptConcreteAtomVariants": concrete_atom_variant_ids(candidate, "scriptAtoms", "script"),
            "rhythmConcreteAtomVariants": concrete_atom_variant_ids(candidate, "rhythmAtoms", "rhythm"),
            "packagingConcreteAtomVariants": concrete_atom_variant_ids(candidate, "packagingAtoms", "packaging"),
            "fallback": None,
            "syncPoints": candidate.get("requiredSyncPoints", []),
            "proofNotes": [a.get("proofNeed") for a in candidate.get("scriptAtoms", []) if a.get("proofNeed")],
            "packagingNotes": [a.get("packagingFunction") or a.get("function") for a in candidate.get("packagingAtoms", []) if a.get("packagingFunction") or a.get("function")],
        })

    if selected_chain.get("requiredAdapters"):
        warnings.append("选中链路需要 adapters: " + ", ".join(selected_chain.get("requiredAdapters", [])))

    return {
        "brief": brief,
        "governanceStatus": g_status,
        "governanceAudit": governance_audit(governance, governance_maps),
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
        "nextStep": "使用该骨架继续撰写脚本节拍、节奏曲线、包装说明、adapters，并按 governanceAudit 中的 binding principles / recomposition policies 做校验。",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index_json", help="来自 build_slot_index.py 的索引 JSON")
    parser.add_argument("--governance", help="semantic-governance.v1.json 路径")
    parser.add_argument("--no-governance", action="store_true", help="禁用治理层读取，仅按证据层生成骨架")
    parser.add_argument("--brief", help="Brief JSON 文件")
    parser.add_argument("--mode", help="兼容旧字段；仅作为 brief 提示，不作为策略选择器")
    parser.add_argument("--sequence", help="逗号分隔的显式 slot type 顺序覆盖")
    parser.add_argument("--slot-subtypes", help="逗号分隔的目标 slot subtype id，用于检索过滤/加权")
    parser.add_argument("--slot-archetypes", help="逗号分隔的目标 slot archetype id，用于检索过滤/加权")
    parser.add_argument("--bundles", help="逗号分隔的 implementation bundle id，仅作为检索先验")
    parser.add_argument("--out", help="输出 JSON 路径")
    args = parser.parse_args()

    index = read_json(Path(args.index_json))
    governance_path = None if args.no_governance else (Path(args.governance) if args.governance else default_governance_path(Path(args.index_json)))
    governance = None if args.no_governance else load_governance(governance_path)
    brief = read_json(Path(args.brief)) if args.brief else {}
    if args.mode:
        brief["mode"] = args.mode
    if args.slot_subtypes:
        brief["slotSubtypeIds"] = [x.strip() for x in args.slot_subtypes.split(",") if x.strip()]
    if args.slot_archetypes:
        brief["slotArchetypeIds"] = [x.strip() for x in args.slot_archetypes.split(",") if x.strip()]
    if args.bundles:
        brief["implementationBundleIds"] = [x.strip() for x in args.bundles.split(",") if x.strip()]
    sequence = [x.strip() for x in args.sequence.split(",") if x.strip()] if args.sequence else None
    plan = build_plan(index, brief, sequence, governance)
    if args.out:
        write_json(Path(args.out), plan)
        print(f"已写入 {args.out}")
    else:
        import json
        print(json.dumps(plan, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
