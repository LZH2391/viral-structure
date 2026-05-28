# 治理输出格式

用于 agent 输出 FunctionSlotLibrary 语义治理结论。

正式治理结果保存到：

```text
Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json
```

不要在 `_governance` 目录中放 `manifest.json`，避免被样例库扫描逻辑误认为一个 sample library。

## JSON 顶层结构

```json
{
  "schemaVersion": "function_slot_semantic_governance.v1",
  "governanceId": "governance_...",
  "status": "candidate | reviewed | stable",
  "outputPath": "Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json",
  "sourceRoot": "Artifacts/FunctionSlotLibrary",
  "sourceIndex": "Runtime/Temp/FunctionSlotLibrary/slot_index.json",
  "createdAt": "ISO-8601",
  "sourceSnapshot": [],
  "coverage": {},
  "slotFamilies": [],
  "slotArchetypes": [],
  "slotSubtypes": [],
  "atomArchetypes": [],
  "atomPatterns": [],
  "bindingPatterns": [],
  "bindingPrinciples": [],
  "rulePatterns": [],
  "recompositionPolicies": [],
  "implementationBundles": [],
  "chainPatterns": [],
  "needReviewMap": [],
  "unmappedAtomVariants": [],
  "unmappedBindingVariants": [],
  "unmappedRuleVariants": [],
  "reviewItems": [],
  "openQuestions": []
}
```

## Source Snapshot

`sourceSnapshot` 记录治理时使用的 FunctionSlotLibrary 样例快照。

```json
[
  {
    "artifactId": "artifact_...",
    "sampleVideoId": "sample_...",
    "traceId": "trace_...",
    "contentHash": "...",
    "counts": {
      "slotCount": 0,
      "atomCount": 0,
      "bindingCount": 0,
      "ruleCount": 0,
      "templateCount": 0
    }
  }
]
```

以后判断治理结果是否过期时，比较当前 `manifest.json` 的 `contentHash` 和 `sourceSnapshot` 中的 `contentHash`。

## 通用字段

每个治理项必须包含：

```json
{
  "id": "...",
  "name": "...",
  "status": "candidate | reviewed | stable",
  "reviewStatus": "candidate | reviewed",
  "maturityStatus": "candidate | stable",
  "sourceVariantIds": [],
  "support": {
    "variantCount": 0,
    "sampleCount": 0,
    "sampleIds": []
  },
  "judgementReason": "...",
  "differenceNotes": [],
  "riskIfMisclassified": "..."
}
```

`sourceVariantIds` 必须指向 `slot_index.json` 中的真实 variant。不能只写 slotType 名称。

`status` 暂时保留兼容；语义上以后以 `reviewStatus` 和 `maturityStatus` 为准。当前样例量少时，已审查项也应保持 `maturityStatus: "candidate"`，不要把人审通过误写成稳定原型。

## Slot Family

```json
{
  "id": "FAM_demand_activation",
  "name": "需求激活类",
  "status": "reviewed",
  "coreViewerTransition": "no_need_or_context -> problem_or_need_accepted",
  "sourceVariantIds": [],
  "support": {},
  "judgementReason": "...",
  "differenceNotes": [],
  "riskIfMisclassified": "..."
}
```

## Slot Archetype

```json
{
  "id": "ARCH_problem_or_need_activation",
  "familyId": "FAM_demand_activation",
  "name": "痛点/需求激活原型",
  "status": "reviewed",
  "viewerStateBeforeClass": "...",
  "viewerStateAfterClass": "...",
  "commonProofObligation": [],
  "sourceVariantIds": [],
  "support": {},
  "judgementReason": "...",
  "differenceNotes": [],
  "riskIfMisclassified": "..."
}
```

## Slot Subtype

```json
{
  "id": "SUB_object_problem_activation",
  "archetypeId": "ARCH_problem_or_need_activation",
  "name": "对象直冲型痛点激活",
  "status": "candidate",
  "sourceSlotTypes": [],
  "viewerTransition": "...",
  "proofObligation": [],
  "solutionVisibility": "...",
  "sourceVariantIds": [],
  "support": {},
  "judgementReason": "...",
  "differenceNotes": [],
  "riskIfMisclassified": "..."
}
```

## Atom Archetype

```json
{
  "id": "ATOM_ARCH_script_demand_establishment",
  "name": "需求与观看理由建立脚本原型",
  "atomLayer": "script | rhythm | packaging",
  "status": "candidate | reviewed | stable",
  "sourcePatternIds": [],
  "sourceVariantIds": [],
  "support": {},
  "judgementReason": "...",
  "differenceNotes": [],
  "riskIfMisclassified": "..."
}
```

Atom archetype 是 atom pattern 的父层，用来表达同一 atom layer 内更高层的实现语义，例如脚本层的需求建立、证据解释、关切闭合，节奏层的信息负载控制，包装层的视觉证明载体。它不能替代 script / rhythm / packaging 三类 atom pattern，也不能把三类 atom 混成一个 pattern。

## Atom Pattern

```json
{
  "id": "SCRIPT_problem_object_to_direct_action",
  "atomLayer": "script",
  "parentAtomArchetype": "ATOM_ARCH_script_demand_establishment",
  "forSlotSubtypeIds": ["SUB_object_problem_activation"],
  "status": "candidate",
  "claimPattern": "...",
  "proofNeedClass": "...",
  "mustKeepClasses": [],
  "sourceVariantIds": [],
  "support": {},
  "judgementReason": "...",
  "differenceNotes": [],
  "riskIfMisclassified": "..."
}
```

For rhythm atoms, use `rhythmFunction`, `paceClass`, `densityClass` and `syncPointClasses`.

For packaging atoms, use `proofType`, `visualHierarchyClass`, `replaceableFormClasses` and `riskClass`.

## Binding Pattern

```json
{
  "id": "BIND_activation_to_result_carryover",
  "bindingType": "carryover",
  "status": "candidate",
  "condition": "...",
  "requirement": "...",
  "riskIfBroken": "...",
  "sourceVariantIds": [],
  "support": {},
  "judgementReason": "...",
  "differenceNotes": [],
  "riskIfMisclassified": "..."
}
```

## Binding Principle

```json
{
  "id": "PRINCIPLE_activated_concern_closure",
  "name": "激活关切必须闭合原则",
  "status": "candidate",
  "sourcePatternIds": [],
  "judgementReason": "...",
  "riskIfMisclassified": "..."
}
```

## Rule Pattern

```json
{
  "id": "RULE_activated_concern_must_be_resolved",
  "ruleType": "carryover_policy",
  "status": "candidate",
  "condition": "...",
  "requirement": "...",
  "violation": "...",
  "fix": "...",
  "sourceVariantIds": [],
  "support": {},
  "judgementReason": "...",
  "differenceNotes": [],
  "riskIfMisclassified": "..."
}
```

## Recomposition Policy

```json
{
  "id": "POLICY_concern_thread_closure",
  "name": "关切线闭合政策",
  "status": "candidate",
  "policyScope": "composition_safety",
  "sourceRulePatternIds": [],
  "policy": "...",
  "riskIfBroken": "..."
}
```

`recompositionPolicies` 在 builder 中只表示组合安全政策，不表示由 builder 生成重组方案。

## Implementation Bundle

```json
{
  "id": "BUNDLE_...",
  "name": "...",
  "status": "candidate",
  "bundleType": "observed_chain_bundle",
  "useAs": "retrieval_prior_only",
  "notUseAs": "fixed_template",
  "slotSubtypeIds": [],
  "scriptPatternIds": [],
  "rhythmPatternIds": [],
  "packagingPatternIds": [],
  "sourceVariantIds": [],
  "support": {},
  "judgementReason": "...",
  "riskIfMisclassified": "..."
}
```

## Need Review Map

```json
{
  "variantId": "sample_...::...",
  "variantKind": "slot | atom | binding | rule",
  "affectedNodes": [],
  "reviewReason": "source_variant_marked_needReview"
}
```

`needReviewMap` 必须覆盖 `slot_index.json` 中所有 `needReview=true` 的 variant。

## Unmapped Variants

```json
{
  "variantId": "sample_...::...",
  "reason": "single_sample_no_reusable_pattern_yet",
  "suggestedAction": "keep_as_variant_until_more_support"
}
```

未进入 atom / binding / rule pattern 的原始 variant 必须进入对应的 `unmappedAtomVariants / unmappedBindingVariants / unmappedRuleVariants`，避免静默丢失证据。

## Review Items

```json
{
  "id": "REVIEW_001",
  "severity": "low | medium | high",
  "topic": "...",
  "sourceVariantIds": [],
  "evidenceFor": [],
  "evidenceAgainst": [],
  "question": "...",
  "recommendedAction": "..."
}
```

Use `reviewItems` when evidence is insufficient, boundaries conflict, or a merge would affect downstream recomposition decisions.
