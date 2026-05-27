# 语料库摄入

当用户拥有多份视频派生 JSON 导出时，使用本参考。

## 预期目录形态

`C:\ByteDanceFullStack` 中的本地项目形态：

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

这是项目真实 corpus。脚本收到仓库根目录时，应解析到 `Artifacts/FunctionSlotLibrary/`。

推荐的通用 corpus 形态：

```text
corpus/
  sample_001/
    manifest.json
    slots.json
    atoms.script.json
    atoms.rhythm.json
    atoms.packaging.json
    bindings.json
    rules.json
    templates.json
  sample_002/
    ...
```

如果文件名中包含 sample id，也可以接受扁平上传形态。可行时，在索引前先规范化为样例目录。

不要默认把 `references/sample-libraries/sample_001/` 摄入项目 corpus。它只是用于解释 schema 和工作流的内置种子样例，不代表 corpus 支持度。

## 最小完整样例

一个样例可用于检索，至少需要：

- slots
- 至少一种 atom，最好三类 atom 都有
- bindings 或 rules
- manifest 或可检测的 sample id

如果缺少 templates，可根据 `slotOrder` 和 `slotType` 推导候选链路。

## 语料库索引字段

合并索引应包含：

```json
{
  "schemaVersion": "slot_corpus_index.v1",
  "samples": [],
  "slotVariants": [],
  "atomCandidates": [],
  "bindings": [],
  "rules": [],
  "templates": [],
  "coverage": {}
}
```

在本仓库内生成的索引和报告应写入被忽略的工作目录，例如 `Runtime/Temp/FunctionSlotLibrary/`。输出中使用仓库相对路径，并保留 manifest 血缘字段（`artifactId`、`sampleVideoId`、`traceId`、`parentArtifactId`、source artifact ids、`contentHash`），使 corpus 可审计且不暴露本地绝对路径。

每条 `slotVariants` 记录应包含：

- `variantId`：稳定 ID，例如 `sample_001::F001`
- `sampleId`
- `sourceSlotId`
- `slotType`
- `slotName`
- `viewerStateBefore`
- `viewerStateAfter`
- `persuasionTask`
- `scriptAtomIds`
- `rhythmAtomIds`
- `packagingAtomIds`
- `requiredSyncPoints`
- `substitutionRules`
- `confidence`
- `needReview`
- `searchText` 或等价的归一化检索文本

## 去重

不要立即删除近重复项，应先分组。

有用的重复键：

- 相同 `slotType` + 高度相似的 `persuasionTask`
- 相同 `claimType` + 相同 `proofNeed`
- 相同 `pace` + 相同 `beatShape`
- 相同 `packagingFunction`

保留来源多样性，因为两个近重复槽位可能提供不同证明载体或包装表层。

## 覆盖审查

索引后报告：

- 样例数量
- 按槽位类型统计的 slot variant 数
- 按类型统计的 atom 数
- 按 sequence 统计的 templates
- 缺失字段
- 低置信度或需要 review 的候选
- 覆盖不足的槽位原型
- 过度集中的源视频或内容格式

## 补充建议

当数据过薄时，可补充：

- 品类标签
- 平台标签
- 产品类型
- 时长范围
- 证明资产类型
- hook 类型
- CTA 风格
- 生产复杂度
- 情绪语气
- 可用时补充表现数据
