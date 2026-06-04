# user-material-pack stable compact 输出契约

只返回 JSON object，不输出 Markdown，不输出 JSON 外解释。

运行时会提供 `output-skeleton.json`。它是 compact 答题纸，不是最终判断结果：

- 保留骨架的顶层结构。
- 保留每个 `shotCard` 的 `shotRef / shotNo / timeRange / visualSummary`。
- `visualSummary` 来自切镜 summary，只描述画面内容，不代表素材能力。
- 你必须补全 `semanticDictionaries / shotClass / shotFunctions / materialTags / proofAffordances / sequenceFit / quality / confidence / needReview`。
- 你必须基于素材判断补全 `materialGroups / proofCoverage / sequenceRecommendations / globalConstraintRefs / restructureInputSummary`，不要原样返回空骨架。

## 顶层结构

```json
{
  "type": "user-material-pack",
  "schemaVersion": "user-material-pack.stable",
  "sampleVideoId": "sample_xxx",
  "sourceArtifacts": {
    "shotBoundaryAnalysis": {
      "artifactId": "artifact_xxx",
      "shotCount": 0
    }
  },
  "semanticDictionaries": {
    "entityDict": {},
    "supportDict": {},
    "guardrailDict": {}
  },
  "shotCards": [],
  "materialGroups": [],
  "proofCoverage": [],
  "sequenceRecommendations": {
    "openingCandidates": [],
    "middleCandidates": [],
    "endingCandidates": []
  },
  "globalConstraintRefs": [],
  "restructureInputSummary": {
    "strongMaterialAreas": [],
    "weakMaterialAreas": [],
    "missingMaterialAreas": [],
    "recommendedUse": [],
    "doNotUseForRefs": [],
    "needsRestructureAttentionRefs": []
  }
}
```

## 去重复结构

`semanticDictionaries` 是必填字典，正文用 `*Refs` 引用它。不要先输出展开字段再二次压缩。

- `entityDict`：实体或文本信号，ID 建议 `E_` 前缀。
- `supportDict`：所需补充支持，ID 建议 `SUP_` 前缀。
- `guardrailDict`：限制、缺口、安全用法、不可误用边界，ID 建议 `G_` 前缀。

允许引用字段：

- `shotCards[].detectedEntityRefs.*`
- `shotCards[].proofAffordances[].limitRefs`
- `shotCards[].sequenceFit.*.requiredSupportRefs`
- `shotCards[].constraintRefs`
- `materialGroups[].constraintRefs`
- `proofCoverage[].safeUsageRefs`
- `proofCoverage[].gapAdviceRefs`
- `sequenceRecommendations.*[].requiredSupportRefs`
- `globalConstraintRefs`
- `restructureInputSummary.doNotUseForRefs`
- `restructureInputSummary.needsRestructureAttentionRefs`

禁止输出这些旧展开字段：

- `detectedEntities`
- `limits`
- `requiredSupport`
- `constraints`
- `safeUsage`
- `gapAdvice`
- `globalConstraints`
- `doNotUseFor`
- `needsRestructureAttention`
- `semanticReuse`

标准枚举不要编码：`proofNeedClass / shotClass / shotFunctions / groupType / fit / coverage / strength / quality` 必须保持原枚举字符串。枚举只表达粗粒度能力，细分语义必须写入 `reason` 和 ref 文本。

## shotCards

每个输入 shot 必须有且只有一个 `shotCard`，顺序必须和输入 shots 一致。

```json
{
  "shotRef": "shot_1",
  "shotNo": "S001",
  "timeRange": { "start": 0, "end": 1.2 },
  "visualSummary": "商品包装近景",
  "spokenOrSubtitleSummary": "",
  "detectedEntityRefs": {
    "products": ["E_PRODUCT"],
    "people": [],
    "scenes": ["E_SCENE"],
    "objects": [],
    "textSignals": []
  },
  "shotClass": "product_display",
  "shotFunctions": ["product_visibility"],
  "materialTags": [],
  "proofAffordances": [
    {
      "proofNeedClass": "product_identity",
      "strength": "strong",
      "reason": "包装正面清晰可见",
      "limitRefs": []
    }
  ],
  "sequenceFit": {
    "opening": { "fit": "medium", "reason": "", "requiredSupportRefs": [] },
    "middle": { "fit": "weak", "reason": "", "requiredSupportRefs": [] },
    "ending": { "fit": "medium", "reason": "", "requiredSupportRefs": [] }
  },
  "quality": {
    "visualClarity": "high",
    "stability": "medium",
    "subjectFocus": "high",
    "audioUsefulness": "unknown",
    "captionUsefulness": "none"
  },
  "constraintRefs": [],
  "confidence": 0.8,
  "needReview": false
}
```

## materialGroups

只在 shots 有明确连续性、共同对象或同一证明功能时建组。不要为了凑字段硬建组。

```json
{
  "groupId": "group_product_identity_01",
  "groupType": "product_display_group",
  "shotRefs": ["shot_1", "shot_2"],
  "groupSummary": "连续展示商品包装和小包形态",
  "usableForProofNeedClasses": ["product_identity"],
  "notUsableForProofNeedClasses": ["trust_evidence"],
  "continuity": "medium",
  "constraintRefs": ["G_NO_TRUST_PROOF"]
}
```

## proofCoverage

必须覆盖全部 proofNeedClass，每类一个对象。允许判断为 `missing`，但不能缺字段。

`conversion_support` 需要特别写清支撑的是哪一种转化语义：价格悬念、点击查看、进店引导、备货提醒、数量感、购买对象记忆，还是价格/优惠/库存/入口事实证明。缺少价格页、活动规则或购买入口时，不得证明低价、涨价、优惠真实性、库存或入口事实；但如果字幕/画面能触发下一步行动，可以保留 CTA / 悬念型 `conversion_support`，并在 `safeUsageRefs` 与 `gapAdviceRefs` 中写清边界。

```json
{
  "proofNeedClass": "product_identity",
  "coverage": "strong",
  "candidateShots": ["shot_1"],
  "candidateGroups": ["group_product_identity_01"],
  "reason": "包装和商品形态清楚。",
  "safeUsageRefs": ["G_PRODUCT_IDENTITY_SAFE_USE"],
  "gapAdviceRefs": []
}
```

`coverage` 只能是：

- `strong`
- `partial`
- `weak`
- `missing`
- `unknown`

必须覆盖这些 `proofNeedClass`：

- `problem_visibility`
- `product_identity`
- `process_demonstration`
- `mechanism_support`
- `result_evidence`
- `comparison_evidence`
- `trust_evidence`
- `conversion_support`

## sequenceRecommendations

只推荐结构位置候选，不输出高光片段。

顶层 `openingCandidates / middleCandidates / endingCandidates` 只收录 `fit` 为 `strong` 或 `medium` 的镜头。`weak` 只能保留在单个 `shotCards[].sequenceFit` 中，不进入顶层候选池。

```json
{
  "openingCandidates": [
    {
      "shotRef": "shot_1",
      "fit": "medium",
      "recommendedPosition": "opening",
      "reason": "能快速建立商品对象。",
      "requiredSupportRefs": [],
      "doNotUseAs": ["trust_evidence"]
    }
  ],
  "middleCandidates": [],
  "endingCandidates": []
}
```

## 完整性要求

- `type` 固定为 `user-material-pack`。
- `schemaVersion` 固定为 `user-material-pack.stable`。
- `shotCards` 必须逐镜头覆盖所有输入 shots。
- `materialGroups[].shotRefs`、`proofCoverage[].candidateShots`、`sequenceRecommendations.*[].shotRef` 只能引用骨架中已有 `shotRef`。
- `proofCoverage` 不能原样空返回；必须写判断、依据、安全用法和缺口引用。
- 不生成新脚本、新分镜、新视频方案。
