# 语料库摄入

用于校验和汇总 `Artifacts/FunctionSlotLibrary/` 下的样例库。这里产出的是证据层，不是治理层。

## 项目目录

```text
Artifacts/FunctionSlotLibrary/
  artifact_<id>/
    manifest.json
    slots.json
    atoms.script.json
    atoms.rhythm.json
    atoms.packaging.json
    bindings.json
    rules.json
    templates.json
```

脚本收到仓库根目录时，应解析到 `Artifacts/FunctionSlotLibrary/`。

不要默认摄入内置种子样例：

```text
.agents/skills/function-slot-restructure/references/sample-libraries/sample_001/
```

该样例只用于理解格式，不代表项目 corpus 支持度。

## 可用样例的最低要求

一个样例可用于索引，至少需要：

- `slots.json`
- 至少一种 atoms 文件，最好三类都有
- `bindings.json` 或 `rules.json`
- `manifest.json` 或可检测的 sample id

如果缺少 `templates.json`，可以根据 `slotOrder` 和 `slotType` 推导候选链路，但要在报告中标记。

## 索引字段

索引至少应包含：

```json
{
  "schemaVersion": "short_video_slot_index.v1",
  "sourceRoot": "Artifacts/FunctionSlotLibrary",
  "summary": {},
  "samples": [],
  "canonicalSlots": [],
  "slotVariants": [],
  "atomVariants": [],
  "bindings": [],
  "rules": [],
  "templates": []
}
```

`slot_index.json` 只是证据索引。它可以统计 `slotTypeSupport`、收集 variant 和保留血缘，但不能作为 family/archetype/subtype 或 pattern 的自动治理结果。

输出中保留 manifest 血缘字段：

- `artifactId`
- `sampleVideoId`
- `traceId`
- `parentArtifactId`
- source artifact ids
- `contentHash`
- `counts`

不要输出本地绝对路径、完整 prompt、DebugSnapshot、视频或帧内容。

## 覆盖审查

构建索引后报告：

- 样例数量
- slot variant 数量
- atom variant 数量
- binding / rule / template 数量
- `slotTypeSupport`
- `chainPatternSupport`
- 缺失字段
- 低置信度或 `needReview`
- 覆盖不足的 slotType
- 可能重复或相近的 slotType

## 治理前置条件

进行语义治理前，先确认：

- `validation.json` 没有阻断性 errors。
- `slot_index.json` 能追溯每个 slot、atom、binding、rule 的 `variantId`。
- 低置信度和 `needReview` 项在治理输出中被标记。
- 所有治理结论只引用证据层，不覆盖原始样例库。
