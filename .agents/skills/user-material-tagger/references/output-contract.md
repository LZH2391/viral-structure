# user-material-pack stable 输出契约

只返回 JSON object，不输出 Markdown，不输出 JSON 外解释。

运行时会提供 `output-skeleton.json`。它是答题纸，不是最终判断结果：

- 保留骨架的顶层结构。
- 保留每个 `shotCard` 的 `shotRef / shotNo / timeRange / visualSummary`。
- `visualSummary` 来自切镜 summary，只描述画面内容，不代表素材能力。
- 你必须补全 `shotClass / shotFunctions / materialTags / proofAffordances / sequenceFit / quality / confidence / needReview`。
- 你必须基于素材判断补全 `materialGroups / proofCoverage / sequenceRecommendations / restructureInputSummary`，不要原样返回空骨架。

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
  "shotCards": [],
  "materialGroups": [],
  "proofCoverage": [],
  "sequenceRecommendations": {
    "openingCandidates": [],
    "middleCandidates": [],
    "endingCandidates": []
  },
  "globalConstraints": [],
  "restructureInputSummary": {
    "strongMaterialAreas": [],
    "weakMaterialAreas": [],
    "missingMaterialAreas": [],
    "recommendedUse": [],
    "doNotUseFor": [],
    "needsRestructureAttention": []
  }
}
```

## shotCards

每个输入 shot 必须有且只有一个 `shotCard`，顺序必须和输入 shots 一致。

```json
{
  "shotRef": "shot_1",
  "shotNo": "S001",
  "timeRange": { "start": 0, "end": 1.2 },
  "visualSummary": "商品包装近景",
  "spokenOrSubtitleSummary": "",
  "detectedEntities": {
    "products": [],
    "people": [],
    "scenes": [],
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
      "limits": []
    }
  ],
  "sequenceFit": {
    "opening": { "fit": "medium", "reason": "", "requiredSupport": [] },
    "middle": { "fit": "weak", "reason": "", "requiredSupport": [] },
    "ending": { "fit": "medium", "reason": "", "requiredSupport": [] }
  },
  "quality": {
    "visualClarity": "high",
    "stability": "medium",
    "subjectFocus": "high",
    "audioUsefulness": "unknown",
    "captionUsefulness": "none"
  },
  "constraints": [],
  "confidence": 0.8,
  "needReview": false
}
```

规则：

- `shotRef` 只能引用骨架中已有 shot。
- `visualSummary` 是切镜画面摘要，可以沿用，不要把证明能力写进这里。
- `shotClass`、`shotFunctions`、`materialTags`、`proofAffordances` 必须基于画面、字幕和上下文判断。
- 信息不足时使用 `unknown`、空数组或 `needReview: true`，不要猜。

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
  "constraints": []
}
```

## proofCoverage

必须覆盖全部 proofNeedClass，每类一个对象。允许判断为 `missing`，但不能缺字段。

```json
{
  "proofNeedClass": "product_identity",
  "coverage": "strong",
  "candidateShots": ["shot_1"],
  "candidateGroups": ["group_product_identity_01"],
  "reason": "包装和商品形态清楚。",
  "safeUsage": "可用于商品身份和包装记忆。",
  "gapAdvice": ""
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

```json
{
  "openingCandidates": [
    {
      "shotRef": "shot_1",
      "fit": "medium",
      "recommendedPosition": "opening",
      "reason": "能快速建立商品对象。",
      "requiredSupport": [],
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
- `proofCoverage` 不能原样空返回；必须写判断、依据、安全用法和缺口。
- 不生成新脚本、新分镜、新视频方案。
