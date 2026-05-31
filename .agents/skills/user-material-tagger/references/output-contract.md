# user-material-pack 输出契约

只返回 JSON object。必须包含以下顶层字段：

```json
{
  "type": "user-material-pack",
  "schemaVersion": "user-material-pack.stable",
  "sampleVideoId": "sample_xxx",
  "artifactId": "artifact_xxx_or_null",
  "parentArtifactId": "shot_boundary_artifact_xxx_or_null",
  "sourceArtifacts": {
    "shotBoundaryAnalysis": {
      "artifactId": "artifact_xxx_or_null",
      "traceId": "trace_xxx_or_null",
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
  },
  "traceMeta": {
    "runId": null,
    "traceId": null,
    "stageId": null,
    "stageName": "user_material_tagger.analyze",
    "createdAt": null
  }
}
```

## shotCards

每个输入 shot 必须对应一个 `shotCard`：

```json
{
  "shotRef": "shot_001",
  "shotNo": "1",
  "timeRange": { "start": 0, "end": 2.4 },
  "shotClass": "problem_scene",
  "shotFunctions": ["attention_entry", "problem_visibility"],
  "visualSummary": "安全摘要",
  "spokenOrSubtitleSummary": "安全摘要或空字符串",
  "detectedEntities": {
    "products": [],
    "people": [],
    "scenes": [],
    "objects": [],
    "textSignals": []
  },
  "materialTags": ["problem_visual", "opening_candidate"],
  "proofAffordances": [
    {
      "proofNeedClass": "problem_visibility",
      "strength": "strong",
      "reason": "问题对象清楚可见",
      "limits": []
    }
  ],
  "sequenceFit": {
    "opening": { "fit": "strong", "reason": "理由", "requiredSupport": [] },
    "middle": { "fit": "weak", "reason": "理由", "requiredSupport": [] },
    "ending": { "fit": "weak", "reason": "理由", "requiredSupport": [] }
  },
  "quality": {
    "visualClarity": "high",
    "stability": "medium",
    "subjectFocus": "high",
    "audioUsefulness": "none",
    "captionUsefulness": "medium"
  },
  "constraints": [],
  "confidence": 0.85,
  "needReview": false
}
```

## materialGroups

只在 shots 有明确连续性、共同对象或同一证明功能时建组：

```json
{
  "groupId": "group_usage_01",
  "groupType": "usage_process_group",
  "shotRefs": ["shot_003", "shot_004", "shot_005"],
  "groupSummary": "连续展示使用动作，主体稳定",
  "usableForProofNeedClasses": ["process_demonstration", "product_identity"],
  "notUsableForProofNeedClasses": ["result_evidence"],
  "continuity": "strong",
  "constraints": ["需要字幕解释步骤目的"]
}
```

## proofCoverage

必须覆盖全部证明能力类型，即使为 `missing`：

```json
{
  "proofNeedClass": "result_evidence",
  "coverage": "weak",
  "candidateShots": ["shot_009"],
  "candidateGroups": [],
  "reason": "有结果状态但没有前后对比或明确因果",
  "safeUsage": "只能作为状态展示，不能承担强效果承诺",
  "gapAdvice": "如重组需要结果证明，应降主张或补拍前后对比"
}
```

## sequenceRecommendations

每类候选最多 8 个，按适配强弱和时间顺序综合排列：

```json
{
  "shotRef": "shot_003",
  "fit": "strong",
  "recommendedPosition": "middle",
  "reason": "有连续使用动作，适合承载过程演示",
  "requiredSupport": ["需要字幕说明动作目的"],
  "doNotUseAs": ["result_evidence"]
}
```

## 输出完整性

- `shotCards` 按原时间顺序。
- `materialGroups.shotRefs` 只能引用输入里存在的 shot。
- `proofCoverage.candidateShots` 只能引用输入里存在的 shot。
- `sequenceRecommendations.*Candidates` 只能引用输入里存在的 shot。
- `confidence` 使用 0 到 1。
- 信息不足时使用 `unknown`、空数组、`needReview: true`，不要猜。
