# 治理层边界

用于区分 FunctionSlotLibrary 的证据层和 agent 语义治理层。

## 两层结构

证据层来自样例库和脚本索引：

```text
slot variant
atom variant
binding variant
rule variant
template variant
```

治理层来自 agent 审查判断：

```text
slot family
slot archetype
slot subtype
atom pattern
binding pattern
binding principle
rule pattern
recomposition policy
implementation bundle
```

脚本只负责把证据层整理成可读索引。治理层不能由字段一致、文本相似、slotType 名称相似或脚本原子相似自动生成。

## 证据层

`slot variant` 是单条样例视频里的事实。它保留：

- 原始 `slotType`
- viewer state before/after
- persuasion task
- script/rhythm/packaging atom 引用
- binding/rule/template 引用
- sampleId、artifactId、traceId 等来源

证据层可以统计 support，但 support 只是“出现次数”，不是语义同类证明。

## 治理层

`slot family / archetype / subtype` 是 agent 对多个 variant 的语义归并判断。

- family：高层说服任务族。
- archetype：可复用的观众状态迁移和核心说服原型。
- subtype：同一 archetype 下不同证明机制或进入方式。

`atom pattern / binding pattern / rule pattern` 也是治理判断，不是字段聚类结果。

## 治理产物

治理结论是 derived review result，不覆盖 `Artifacts/FunctionSlotLibrary/<artifactId>/*` 的原始样例内容。

正式治理结果保存为：

```text
Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json
```

这个文件是语义治理索引。它记录 `sourceSnapshot` 和治理结果，不是新的样例库，也不替代原始 variant。

不要把治理状态写入单个样例的 `manifest.json`。语义治理是跨样例关系判断，不是某个 artifact 自身状态。

每条治理结论必须保留：

- `sourceVariantIds`
- `support`
- `judgementReason`
- `differenceNotes`
- `riskIfMisclassified`

文件级必须保留 `sourceSnapshot`，记录被治理 corpus 中每个 artifact 的 `artifactId / sampleVideoId / traceId / contentHash / counts`。后续判断治理结果是否过期时，对比当前 FunctionSlotLibrary 的 contentHash 和 `sourceSnapshot`。

如果证据不足，标记为 `candidate` 或放入 `reviewItems`，不要伪装成稳定原型。

## 状态

- `candidate`：agent 认为可能成立，但样例或边界不足。
- `reviewed`：agent 已完成明确判断，可供重组参考。
- `stable`：多个样例支持且边界清楚，或已有人工确认可作为长期规则。

不要因为字段相同自动升级状态。
