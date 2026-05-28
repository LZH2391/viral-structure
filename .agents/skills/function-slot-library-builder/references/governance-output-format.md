# 治理输出格式

用于 agent 输出 FunctionSlotLibrary 语义治理结论。

## JSON 顶层结构

```json
{
  "schemaVersion": "function_slot_governance.review.v1",
  "sourceIndex": "Runtime/Temp/FunctionSlotLibrary/slot_index.json",
  "createdAt": "ISO-8601",
  "slotFamilies": [],
  "slotArchetypes": [],
  "slotSubtypes": [],
  "atomPatterns": [],
  "bindingPatterns": [],
  "rulePatterns": [],
  "implementationBundles": [],
  "reviewItems": [],
  "openQuestions": []
}
```

## 通用字段

每个治理项必须包含：

```json
{
  "id": "...",
  "name": "...",
  "status": "candidate | reviewed | stable",
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

## Atom Pattern

```json
{
  "id": "SCRIPT_problem_object_to_direct_action",
  "atomLayer": "script",
  "forSlotSubtype": "SUB_object_problem_activation",
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
