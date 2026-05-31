# user-material-pack compact 输出契约

只返回 JSON object，不输出 Markdown，不输出 JSON 外解释。

必须使用 compact/grouped-shots 结构，顶层只包含以下字段：

```json
{
  "type": "user-material-pack-compact",
  "schemaVersion": "user-material-pack.grouped-shots.v1",
  "sampleVideoId": "sample_xxx",
  "sourceArtifacts": {
    "shotBoundaryAnalysis": {
      "shotCount": 0
    },
    "visualManifest": {
      "sheetCount": 0,
      "emptyShotCount": 0
    }
  },
  "capabilities": {},
  "groups": [],
  "ungroupedShots": [],
  "traceMeta": {
    "stageName": "user_material_tagger.analyze"
  }
}
```

## sourceArtifacts

- `shotBoundaryAnalysis.shotCount`：输入切镜数量。
- `visualManifest.sheetCount`：视觉 sheet 数量；没有上游信息时填 `0`。
- `visualManifest.emptyShotCount`：空镜头数量；没有上游信息时填 `0`。

不要在 compact 输出中添加旧版 `artifactId / parentArtifactId / traceId` 字段。

## capabilities

`capabilities` 是素材能力池，必须按 `cap_xxx` 建索引。每个 capability 的结构：

```json
{
  "cap_product_identity": {
    "proofNeedClass": "product_identity",
    "supportLevel": "strong",
    "shotIds": ["shot_3", "shot_4"],
    "groupIds": ["group_product_identity_01"],
    "safeUsage": "可安全用于商品身份、品牌露出和包装记忆。",
    "gapAdvice": "如需要更严谨规格信息，可补拍包装背面、配料表或完整外包装细节。"
  }
}
```

字段规则：

- `proofNeedClass` 使用 taxonomy 中的证明能力类型。
- `supportLevel` 只能是 `strong / partial / weak / unknown`。
- `shotIds` 只能引用输入里存在的 shot。
- `groupIds` 只在存在可支撑该能力的素材组时输出；没有素材组时省略该字段。
- `safeUsage` 写现有素材可以安全承担什么。
- `gapAdvice` 写如果要增强该能力，需要补什么、降级什么或避免什么误用。

## groups

`groups` 是素材组列表，shot 已下放到组内。只在 shots 有明确连续性、共同对象或同一证明功能时建组：

```json
{
  "groupId": "group_usage_01",
  "groupType": "usage_process_group",
  "groupSummary": "连续展示使用动作，主体稳定。",
  "usableCapabilityIds": ["cap_process_demonstration", "cap_product_identity"],
  "notUsableCapabilityIds": ["cap_result_evidence"],
  "continuity": "strong",
  "shots": []
}
```

字段规则：

- `groupId` 使用稳定 ID，例如 `group_product_identity_01`。
- `groupType` 使用 taxonomy 中的素材组类型。
- `groupSummary` 写这一组整体能表达什么。
- `usableCapabilityIds` 只能引用 `capabilities` 中存在的能力 ID。
- `notUsableCapabilityIds` 只能引用 `capabilities` 中存在的能力 ID；用于说明不能承担的能力。
- `continuity` 只能是 `strong / medium / weak / none`。
- `shots` 内放该组的 shot 条目。

## shot 条目

每个输入 shot 必须出现在 `groups[].shots` 或 `ungroupedShots` 中且只能出现一次。结构如下：

```json
{
  "shotId": "shot_3",
  "shotNo": "S003",
  "timeRange": [1.167, 2.033],
  "shotClass": "product_display",
  "visualSummary": "安全画面摘要。",
  "spokenOrSubtitleSummary": "安全口播/字幕摘要。",
  "shotFunctions": ["product_visibility", "context_setup"],
  "capabilityRefs": [
    ["cap_product_identity", "strong"],
    ["cap_comparison_evidence", "weak"]
  ],
  "recommendations": {
    "opening": {
      "fit": "strong",
      "reason": "适合开头的原因。",
      "requiredSupport": ["需要后续包装补充商品身份"],
      "doNotUseAsCapabilityIds": ["cap_trust_evidence"]
    }
  },
  "quality": {
    "visualClarity": "high",
    "stability": "medium",
    "subjectFocus": "high",
    "audioUsefulness": "none",
    "captionUsefulness": "medium"
  },
  "confidence": 0.85,
  "needReview": true
}
```

字段规则：

- `shotId` 使用输入 shot ID。
- `shotNo` 使用展示编号；如果输入没有，按时间顺序生成 `S001`、`S002`。
- `timeRange` 使用 `[start, end]` 数组，单位秒。
- `spokenOrSubtitleSummary` 只有在存在可用口播/字幕信息时输出。
- `shotFunctions` 使用 taxonomy 中的功能标签。
- `capabilityRefs` 引用顶层 `capabilities` 中存在的能力 ID，强度只能是 `strong / medium / weak / none / unknown`。
- `recommendations` 只输出适合的位置键，可包含 `opening / middle / ending`。
- `recommendations.*.fit` 只能是 `strong / medium / weak`。
- `recommendations.*.requiredSupport` 没有时可省略或填空数组。
- `recommendations.*.doNotUseAsCapabilityIds` 没有时可省略或填空数组，只能引用 `capabilities` 中存在的能力 ID。
- `quality` 字段取值见 taxonomy。
- `confidence` 使用 0 到 1。
- `needReview` 需要人工复核时才出现；不需要复核时省略。

## ungroupedShots

`ungroupedShots` 放未进入任何 `group` 的镜头，结构同 `group.shots`。如果所有 shot 都已入组，输出空数组。

## traceMeta

当前只输出：

```json
{
  "stageName": "user_material_tagger.analyze"
}
```

## 输出完整性

- `type` 固定为 `user-material-pack-compact`。
- `schemaVersion` 固定为 `user-material-pack.grouped-shots.v1`。
- `capabilities` 是对象，不是数组。
- 每个输入 shot 必须输出一次，且只能输出一次。
- `groups[].shots` 和 `ungroupedShots` 内的 shot 按原时间顺序。
- `capabilities.*.shotIds`、`groups[].shots[].capabilityRefs`、`usableCapabilityIds`、`notUsableCapabilityIds` 只能引用当前输出中存在的 ID。
- 不输出旧版顶层字段：`artifactId`、`parentArtifactId`、`shotCards`、`materialGroups`、`proofCoverage`、`sequenceRecommendations`、`globalConstraints`、`restructureInputSummary`。
- 信息不足时使用 `unknown`、空数组或 `needReview: true`，不要猜。

## 结构树

```text
root
├─ type
│  输出类型，标记这是 compact 版素材包。
├─ schemaVersion
│  当前格式版本。
├─ sampleVideoId
│  样例视频 ID。
├─ sourceArtifacts
│  上游来源摘要。
│  ├─ shotBoundaryAnalysis.shotCount
│  │  切镜数量。
│  └─ visualManifest
│     ├─ sheetCount
│     │  视觉 sheet 数量。
│     └─ emptyShotCount
│        空镜头数量。
├─ capabilities
│  素材能力池，按 cap_xxx 建索引。
│  └─ cap_xxx
│     ├─ proofNeedClass
│     │  能力类别，如商品识别、过程展示、信任证明。
│     ├─ supportLevel
│     │  支撑强度，如 strong / partial / weak。
│     ├─ shotIds
│     │  能支撑该能力的镜头 ID。
│     ├─ groupIds
│     │  能支撑该能力的素材组 ID，部分能力没有。
│     ├─ safeUsage
│     │  这个能力可安全怎么用。
│     └─ gapAdvice
│        如果要增强该能力，需要补什么。
├─ groups
│  素材组列表，shot 已下放到组内。
│  └─ group
│     ├─ groupId
│     │  素材组 ID。
│     ├─ groupType
│     │  素材组类型。
│     ├─ groupSummary
│     │  这一组整体能表达什么。
│     ├─ usableCapabilityIds
│     │  这组可承担的能力 ID。
│     ├─ notUsableCapabilityIds
│     │  这组不能承担的能力 ID。
│     ├─ continuity
│     │  组内镜头连续性强弱。
│     └─ shots
│        组内镜头。
│        └─ shot
│           ├─ shotId
│           │  镜头 ID。
│           ├─ shotNo
│           │  展示编号。
│           ├─ timeRange
│           │  起止时间。
│           ├─ shotClass
│           │  镜头类别。
│           ├─ visualSummary
│           │  画面摘要。
│           ├─ spokenOrSubtitleSummary
│           │  口播/字幕摘要，部分镜头有。
│           ├─ shotFunctions
│           │  镜头功能标签。
│           ├─ capabilityRefs
│           │  该镜头关联能力和强度，如 [cap_product_identity, strong]。
│           ├─ recommendations
│           │  该镜头适合放在 opening / middle / ending 的建议。
│           ├─ quality
│           │  清晰度、稳定性、主体聚焦、音频/字幕可用性。
│           ├─ confidence
│           │  判断置信度。
│           └─ needReview
│              需要人工复核时才出现。
├─ ungroupedShots
│  未进入任何 group 的镜头，结构同 group.shots。
└─ traceMeta
   运行追踪摘要，目前只有 stageName。
```
