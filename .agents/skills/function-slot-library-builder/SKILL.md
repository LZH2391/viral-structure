---
name: function-slot-library-builder
description: 构建、校验、索引和审查 FunctionSlotLibrary 语料库。适用于需要检查 Artifacts/FunctionSlotLibrary 下的样例库、生成 Runtime/Temp/FunctionSlotLibrary/slot_index.json、统计 slotType 支持度、查相似槽位、判断新 slotType 是否复用或新增、发现 rules/bindings/templates 覆盖缺口时。不要用它生成新视频重组方案。
---

# FunctionSlotLibrary 构建库

## 职责

这个 skill 只负责**构建库**：

- 校验 `Artifacts/FunctionSlotLibrary/`
- 构建槽位索引
- 统计 `slotType`、atom、binding、rule、template 覆盖
- 查询相似槽位
- 辅助判断 `slotType` 复用或新增
- 输出缺字段、弱规则、重复/近重复结构和下一步补样建议

不要在这里生成新短视频结构方案。重组交给 `function-slot-restructure`。

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

索引用于后续检索和重组。生成物在 `Runtime/Temp/FunctionSlotLibrary/`，默认不入库。

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

### 4. 判断 slotType 复用或新增

规则：

- 功能相近、前后状态相近、说服任务相近：优先复用已有 `slotType`。
- 功能不同或状态跃迁明显不同：可以新增更明确的 `slotType`。
- 只同名不等于同类；只不同名也不等于不同类，需要相似查询和人工 review。

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

`function-slot-restructure` 消费这些结果，用于后续选槽、组链、检查 binding/rule 和输出重组方案。

## 参考文档

按需读取：

- `references/corpus-ingestion.md`：FunctionSlotLibrary 摄入、索引字段和覆盖审查。
- `references/slot-type-review.md`：判断 `slotType` 复用或新增。
- `references/output-formats.md`：库级审查和槽位相似检索输出格式。
