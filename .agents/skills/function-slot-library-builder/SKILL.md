---
name: function-slot-library-builder
description: 构建、校验、索引、审查和语义治理 FunctionSlotLibrary 语料库。适用于检查 Artifacts/FunctionSlotLibrary 样例库、生成 validation/slot_index 证据层、统计 slot/atom/binding/rule/template 覆盖、进行 slot family/archetype/subtype 语义治理、审查 atom/binding/rule pattern 边界、输出治理结论和 reviewItems 时。不要用它生成新视频重组方案，也不要用脚本或字段相似度自动归并 pattern。
---

# FunctionSlotLibrary 构建与语义治理

## 职责

这个 skill 只负责**建库、审查和治理库**：

- 校验 `Artifacts/FunctionSlotLibrary/`
- 构建证据层索引
- 统计 `slotType`、atom、binding、rule、template 覆盖
- 查询相似槽位
- 辅助判断 `slotType` 是否复用、新增、挂到同一 family/archetype/subtype
- 由 agent 审查 slot / atom / binding / rule 的语义治理边界
- 输出缺字段、弱规则、治理结论、reviewItems 和下一步补样建议

不要在这里生成新短视频结构方案。重组交给 `function-slot-restructure`。

## 硬边界

- 脚本只产出证据层：`validation.json` 和 `slot_index.json`。
- agent 负责治理层：slot family/archetype/subtype、atom pattern、binding pattern、rule pattern。
- 禁止用字段完全一致、文本相似度、`slotType` 名称相似或 script atom 归并结果自动合并 pattern。
- 原始 variant 永远是事实来源，治理结论必须保留来源 variant、判断理由、差异点和误分风险。

## 项目语料库

真实 corpus 是：

```text
Artifacts/FunctionSlotLibrary/
```

每个子目录是一条样例库：

```text
Artifacts/FunctionSlotLibrary/<artifactId>/
  manifest.json
  slots.json
  atoms.script.json
  atoms.rhythm.json
  atoms.packaging.json
  bindings.json
  rules.json
  templates.json
```

内置 `references/sample-libraries/sample_001/` 只用于理解格式，不默认并入项目 corpus。

## 工作流

### 1. 校验语料库

```bash
python .agents/skills/function-slot-restructure/scripts/validate_corpus.py . --out Runtime/Temp/FunctionSlotLibrary/validation.json
```

检查：

- 是否发现样例库
- 必需文件是否存在
- slot 引用的 atom 是否存在
- binding 引用的 slot / atom 是否存在
- template 引用的 `slotType` 是否存在
- `needReview` 和低置信度项

### 2. 构建索引

```bash
python .agents/skills/function-slot-restructure/scripts/build_slot_index.py . --out Runtime/Temp/FunctionSlotLibrary/slot_index.json
```

索引用于后续审查和重组，是证据层，不是治理结果。生成物在 `Runtime/Temp/FunctionSlotLibrary/`，默认不入库。

### 3. 查询相似槽位

```bash
python .agents/skills/function-slot-restructure/scripts/retrieve_candidates.py Runtime/Temp/FunctionSlotLibrary/slot_index.json --query "<查询目标>" --slot-types "<slotType>"
```

判断相似时不要只看同名 `slotType`，还要看：

- `viewerStateBefore`
- `viewerStateAfter`
- `persuasionTask`
- script atom 的 `claimType` / `proofNeed`
- packaging atom 的 `packagingFunction`
- `confidence` / `needReview`

相似查询只用于找阅读入口，不能作为自动归并依据。

### 4. 语义治理审查

读取 `references/governance-layer.md` 和 `references/semantic-governance-protocol.md`，基于 `slot_index.json` 中的真实 variant 做 agent 判断。

审查时必须比较：

- viewer state transition
- persuasion task
- proof obligation
- solution visibility
- rhythm function
- packaging proof function
- chain dependency

输出治理结论时，每个 family/archetype/subtype/pattern/policy 都必须带来源、理由、差异和误分风险。

### 5. atom / binding / rule 治理

读取 `references/atom-binding-rule-governance.md`。

- script / rhythm / packaging 三类 atom 独立治理，不允许全部按 script pattern 并入。
- binding pattern 看关系约束，不看文本相似。
- rule pattern 看重组政策，不看 `reason` / `fix` 文案接近。
- 三类 atom 可以形成 implementation bundle，但 bundle 不能替代 atom pattern。

## 输出格式

库级审查输出：

1. 样例数量
2. 校验结果
3. slot / atom / binding / rule / template 数量
4. `slotTypeSupport`
5. `chainPatternSupport`
6. 弱字段和缺字段
7. 可能重复或相近的 `slotType`
8. 建议复用/新增的命名
9. 下一批样例补充建议

治理审查输出：

1. `slotFamilies`
2. `slotArchetypes`
3. `slotSubtypes`
4. `atomPatterns`
5. `bindingPatterns`
6. `rulePatterns`
7. `reviewItems`
8. `openQuestions`

槽位相似检索输出：

1. 查询目标
2. 候选槽位
3. 来源 `artifactId` / `sampleVideoId`
4. 相似原因
5. 差异点
6. 是否建议复用同一 `slotType`
7. 是否需要人工 review

## 和重组 skill 的关系

本 skill 产出：

```text
Runtime/Temp/FunctionSlotLibrary/validation.json
Runtime/Temp/FunctionSlotLibrary/slot_index.json
Runtime/Temp/FunctionSlotLibrary/retrieval.json
```

治理审查可输出到 `Runtime/Temp/FunctionSlotLibrary/`，默认不入库。`function-slot-restructure` 消费证据层和已确认的治理结论，用于后续选槽、组链、检查 binding/rule 和输出重组方案。

## 参考文档

按需读取：

- `references/corpus-ingestion.md`：FunctionSlotLibrary 摄入、索引字段和覆盖审查。
- `references/governance-layer.md`：证据层与治理层的边界。
- `references/semantic-governance-protocol.md`：slot family/archetype/subtype 的 agent 审查协议。
- `references/atom-binding-rule-governance.md`：atom、binding、rule pattern 的治理规则。
- `references/governance-output-format.md`：治理结论 JSON 输出格式。
- `references/slot-type-review.md`：判断 `slotType` 是否复用、新增或挂父级。
- `references/output-formats.md`：库级审查、相似检索和治理审查输出格式。
