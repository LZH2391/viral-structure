# 治理输出格式

用于 agent 输出 FunctionSlotLibrary 语义治理结论。

正式治理结果保存到：

```text
Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json
```

`semantic-governance.v1.json` 是权威入口 manifest，不再承载所有治理数组。完整治理对象由该 manifest 和同目录分文件 materialize 得到：

```text
source-variants.v1.json
slot-governance.v1.json
atom-governance.v1.json
binding-rule-governance.v1.json
implementation-bundles.v1.json
review-and-unmapped.v1.json
```

运行时可生成派生查询索引：

```text
Runtime/Temp/FunctionSlotLibrary/governance_lookup_index.json
```

该索引不作为权威事实源，不入库；它带 `sourceFingerprint`，用于判断是否和当前治理内容一致。

不要在 `_governance` 目录中放 `manifest.json`，避免被样例库扫描逻辑误认为一个 sample library。

## Materialized JSON 顶层结构

下列结构是完整治理对象的 materialized 形态。Agent 可以按这个结构生成完整结果；后端和脚本会将正式产物拆分写回。

```json
{
  "schemaVersion": "function_slot_semantic_governance.v1",
  "governanceId": "governance_...",
  "governanceFormat": "split_manifest.v1",
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
  "observedChainPatterns": [],
  "unmappedAtomVariants": [],
  "unmappedBindingVariants": [],
  "unmappedRuleVariants": [],
  "reviewItems": [],
  "openQuestions": []
}
```

正式 manifest 只保留入口元信息和 `files` 映射：

```json
{
  "schemaVersion": "function_slot_semantic_governance.v1",
  "governanceId": "governance_...",
  "governanceFormat": "split_manifest.v1",
  "outputPath": "Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json",
  "sourceRoot": "Artifacts/FunctionSlotLibrary",
  "sourceIndex": "Runtime/Temp/FunctionSlotLibrary/slot_index.json",
  "createdAt": "ISO-8601",
  "sourceSnapshot": [],
  "coverage": {},
  "files": {
    "slots": {
      "path": "slot-governance.v1.json",
      "fields": ["slotFamilies", "slotArchetypes", "slotSubtypes"]
    }
  }
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

新治理产物不写 `status / reviewStatus / maturityStatus / needReviewMap`。证据不足、边界不清或需要人工讨论的问题放入 `reviewItems / openQuestions`；不要把审核状态或成熟度状态塞回治理节点。

## Slot Family

```json
{
  "id": "FAM_demand_activation",
  "name": "需求激活类",
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
  "id": "ARCH_object_problem_action_activation",
  "familyId": "FAM_demand_activation",
  "name": "对象问题直冲动作激活原型",
  "viewerStateBeforeClass": "...",
  "viewerStateAfterClass": "...",
  "primaryProofObligationClass": "visible_problem_object_plus_direct_solution_action",
  "chainDependencyClass": "...",
  "excludes": [
    "scene_problem_activation",
    "result_first_need_setup",
    "value_anchor_entry"
  ],
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
  "archetypeId": "ARCH_object_problem_action_activation",
  "name": "对象直冲型痛点激活",
  "sourceSlotTypes": [],
  "viewerTransition": "...",
  "proofObligation": [],
  "solutionVisibility": "...",
  "subtypeBoundary": {
    "implementationDifferenceScope": ["素材", "表达", "节奏", "包装"],
    "mustNotChange": ["primaryProofObligationClass", "chainDependencyClass", "slotArchetype task"]
  },
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

单样例但语义功能清晰的 atom 可以先写为 candidate pattern。不要增加 `status / reviewStatus / maturityStatus` 字段；用 `support.variantCount: 1`、`judgementReason`、`differenceNotes` 和 `riskIfMisclassified` 表达候选性、单例风险和后续可合并/拆分空间。只有字段不足、证明功能无法命名或边界冲突的 atom 才留在 `unmappedAtomVariants`。

For rhythm atoms, use `rhythmFunction`, `paceClass`, `densityClass` and `syncPointClasses`.

For packaging atoms, use `proofType`, `visualHierarchyClass`, `replaceableFormClasses` and `riskClass`.

## Binding Pattern

```json
{
  "id": "BIND_activation_to_result_carryover",
  "bindingType": "carryover",
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
  "policyScope": "composition_safety",
  "sourceRulePatternIds": [],
  "policy": "...",
  "riskIfBroken": "..."
}
```

`recompositionPolicies` 在 builder 中只表示组合安全政策，不表示由 builder 生成重组方案。

## Observed Chain Pattern

```json
{
  "id": "OBS_CHAIN_001",
  "name": "观察链路 001",
  "chainKey": "slot_a > slot_b",
  "sequence": [],
  "sourceVariantIds": [],
  "support": {},
  "useAs": "observed_order_and_carryover_evidence",
  "notUseAs": "archetype_merge_basis_or_fixed_template",
  "judgementReason": "...",
  "riskIfMisclassified": "..."
}
```

`observedChainPatterns` 只记录样例中观察到的槽位顺序、承接、铺垫和回扣。它不能作为 slot archetype 合并依据，也不能被当成固定模板。

## Implementation Bundle

```json
{
  "id": "BUNDLE_...",
  "name": "...",
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
