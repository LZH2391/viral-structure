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
- 读取 `slot_index.json` 作为语义治理证据入口
- 审查 `slotType` 与 family/archetype/subtype 的关系
- 由 agent 审查 slot / atom / binding / rule 的语义治理边界
- 输出缺字段、弱规则、治理结论、reviewItems 和下一步补样建议

不要在这里生成新短视频结构方案。重组交给 `function-slot-restructure`。

## 硬边界

- 脚本只产出证据层：`validation.json` 和 `slot_index.json`。
- agent 负责治理层：slot family/archetype/subtype、atom archetype/pattern、binding pattern/principle、rule pattern/recomposition policy。
- 禁止用字段完全一致、文本相似度、`slotType` 名称相似或 script atom 归并结果自动合并 pattern。
- 原始 variant 永远是事实来源，治理结论必须保留来源 variant、判断理由、差异点和误分风险。
- 治理完成后将结果保存到 `Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json`。

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

### 3. 读取 slot_index 证据入口

语义治理直接读取 `Runtime/Temp/FunctionSlotLibrary/slot_index.json`。不要用 `retrieve_candidates.py` 或任何字段相似脚本生成治理候选。

审查时从 `slot_index.json` 读取：

- `slotVariants`
- `atomVariants`
- `bindings`
- `rules`
- `templates`
- `viewerStateBefore`
- `viewerStateAfter`
- `persuasionTask`
- script / rhythm / packaging atom 详情
- binding / rule / template 的承接关系

如果需要按 brief 检索重组候选，那是 `function-slot-restructure` 的职责，不是本 skill 的治理流程。

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

治理结果写入：

```text
Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json
```

该文件必须记录 `sourceSnapshot` 和治理结果。`sourceSnapshot` 用每个 library artifact 的 `contentHash` 判断治理结果是否过期。

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
7. 需要 agent 语义治理的 `slotType` / atom / binding / rule
8. 建议优先审查的 family/archetype/subtype 关系
9. 下一批样例补充建议

治理审查输出：

1. `slotFamilies`
2. `slotArchetypes`
3. `slotSubtypes`
4. `atomArchetypes`
5. `atomPatterns`
6. `bindingPatterns`
7. `bindingPrinciples`
8. `rulePatterns`
9. `recompositionPolicies`
10. `implementationBundles`
11. `reviewItems`
12. `openQuestions`

## 和重组 skill 的关系

本 skill 产出：

```text
Runtime/Temp/FunctionSlotLibrary/validation.json
Runtime/Temp/FunctionSlotLibrary/slot_index.json
Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json
```

`semantic-governance.v1.json` 是可入库的治理层索引。`function-slot-restructure` 消费证据层和已确认的治理结论，用于后续选槽、组链、检查 binding/rule 和输出重组方案。

## 参考文档

按需读取：

- `references/corpus-ingestion.md`：FunctionSlotLibrary 摄入、索引字段和覆盖审查。
- `references/governance-layer.md`：证据层与治理层的边界。
- `references/semantic-governance-protocol.md`：slot family/archetype/subtype 的 agent 审查协议。
- `references/atom-binding-rule-governance.md`：atom、binding、rule pattern 的治理规则。
- `references/governance-output-format.md`：治理结论 JSON 输出格式。
- `references/slot-type-review.md`：判断 `slotType` 是否复用、新增或挂父级。
- `references/output-formats.md`：库级审查和治理审查输出格式。
