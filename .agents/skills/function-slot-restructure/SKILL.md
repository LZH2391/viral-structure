---
name: short-video-slot-library
description: 构建、检索、校验和重组由多条样例视频 JSON 导出组成的短视频功能槽位库。适用于用户拥有 slots、script atoms、rhythm atoms、packaging atoms、bindings、rules、templates、manifests 或多份视频结构库，并希望从语料库中选槽、跨样例组合槽位、生成新的槽位链、校验重组后的短视频结构，或设计可复用的短视频脚本/节奏/包装系统。
---

# 短视频功能槽位库

## 核心定位

把上传或本地已有的数据视为**多样例槽位语料库**，而不是一条可反复套用的视频模板。

主对象是**槽位库**：

`多条样例视频 -> 多个候选功能槽位 -> 可选择的槽位链 -> 兼容的脚本/节奏/包装实现 -> 绑定校验 -> 新短视频方案`

除非用户明确要求做某条源视频的忠实变体，否则不要只改写单一源视频。

## 概念层级

1. **sample library / 样例库**：一条视频导出的 `manifest`、`slots`、`atoms.script`、`atoms.rhythm`、`atoms.packaging`、`bindings`、`rules` 和 `templates`。
2. **corpus library / 语料库**：多份样例库合并或共同检索后的大库。
3. **slot candidate / 槽位候选**：来自某条源视频的一个可复用功能槽位，带有兼容原子和约束。
4. **slot archetype / 槽位原型**：跨多个样例复用的标准槽位类型或高层功能角色，如 `problem_activation`、`result_confirmation`、`trust_close`。
5. **recomposition plan / 重组方案**：从候选槽位中选取并组装出的新槽位链，可以混合多个源视频。
6. **surface execution / 表层执行**：最终脚本、节奏曲线、包装方案、镜头方案和证明清单。

## 关键区分

- **templates** 是可选链路预设。
- **slots** 是重组单位。
- **atoms** 是槽位内的实现方式。
- **bindings 和 rules** 是兼容性约束。
- **source videos** 是证据和灵感来源，不是必须照搬的结构。

## 输入

可接受以下任一输入：

- 单条样例视频导出，包含 `manifest.json`、`slots.json`、`atoms.script.json`、`atoms.rhythm.json`、`atoms.packaging.json`、`bindings.json`、`rules.json`、`templates.json` 等文件。
- 多条样例视频导出组成的分目录语料库。
- 由 `scripts/build_slot_index.py` 生成的合并索引。
- 目标 brief：品类、受众、痛点、转化目标、平台、时长、语气、证明资产、生产约束。
- 待校验和修复的候选槽位链、脚本、分镜或镜头计划。
- 关于 skill、schema、工作流或库治理的设计请求。

如果存在多组上传文件，优先推断最新且完整的一组；只有歧义会阻塞任务时才提问。

## 本地项目接入

在 `C:\ByteDanceFullStack` 项目中，`Artifacts/FunctionSlotLibrary/` 是真实的本地样例库语料库。每个子目录都是从可追踪的 `functionSlotAtomizationAnalysis` artifact 导出的样例库：

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

脚本收到仓库根目录时，应解析到 `Artifacts/FunctionSlotLibrary/`，不要默认摄入 `.agents/skills/function-slot-restructure/references/sample-libraries/`。只有用户明确要求查看内置种子样例时，才读取该目录。

内置的 `references/sample-libraries/sample_001/` 只是用于解释 schema 和工作流的种子样例。不要把它默认合并进项目真实 corpus，也不要把它当成 corpus 支持度。

生成的索引、检索报告和方案骨架应写入被忽略的工作目录，例如 `Runtime/Temp/FunctionSlotLibrary/`。除非用户明确要求沉淀为精选产物，否则不要提交生成索引或本地运行输出。

项目 manifest 使用 `function_slot_library.v1`，必须保留 `artifactId`、`sampleVideoId`、`traceId`、`parentArtifactId`、source artifact ids、`contentHash`、`counts` 等追踪字段。语料库级输出可以包含仓库相对路径，但不应包含本地绝对路径、完整 prompt、DebugSnapshot、视频/帧内容或敏感材料。

## 工作流决策树

### 构建或更新槽位语料库

1. 校验每份样例视频导出。
2. 规范化源 ID 和文件名。
3. 构建包含槽位候选、原子、绑定、模板和规则的语料库索引。
4. 按 `slotType`、主张类型、证明需求、节奏速度、包装功能、置信度和来源样例分组。
5. 报告覆盖缺口和 schema 问题。

有本地 JSON 文件时，优先使用 `scripts/validate_library_corpus.py` 和 `scripts/build_slot_index.py`。

本仓库默认的确定性流程：

```bash
python .agents/skills/function-slot-restructure/scripts/validate_corpus.py . --out Runtime/Temp/FunctionSlotLibrary/validation.json
python .agents/skills/function-slot-restructure/scripts/build_slot_index.py . --out Runtime/Temp/FunctionSlotLibrary/slot_index.json
python .agents/skills/function-slot-restructure/scripts/retrieve_candidates.py Runtime/Temp/FunctionSlotLibrary/slot_index.json --query "<target brief>" --slot-types problem_activation,result_confirmation --out Runtime/Temp/FunctionSlotLibrary/retrieval.json
python .agents/skills/function-slot-restructure/scripts/assemble_plan.py Runtime/Temp/FunctionSlotLibrary/slot_index.json --brief Runtime/Temp/FunctionSlotLibrary/brief.json --out Runtime/Temp/FunctionSlotLibrary/plan.json
```

### 从语料库重组

1. 规范化目标 brief。
2. 判断所需观众状态路径和槽位原型。
3. 按每个原型从 corpus 检索候选槽位。
4. 选择兼顾来源多样性和绑定兼容性的槽位链。
5. 为每个槽位填入脚本、节奏和包装实现。
6. 当不同源视频的槽位需要对象、主张、证明或节奏桥接时，创建 adapter。
7. 校验绑定、证明功能、前后承接和节奏冲突。
8. 输出新的脚本/节奏/包装/镜头方案。

### 校验或修复重组方案

1. 将方案映射到槽位原型。
2. 识别它可能使用了哪些候选槽位和原子。
3. 检查缺失证明、断裂承接、节奏冲突和包装功能丢失。
4. 通过替换槽位、调整原子实现、增加桥接或改变顺序修复。

### 设计或改进 skill / library

1. 区分样例级抽取和语料库级检索。
2. 定义槽位候选 schema、语料库索引 schema、检索评分、组装规则、校验规则和输出格式。
3. 把单个上传样例只当作种子库。
4. 增加去重、多样性、治理和质量审查流程。

## 语料库级重组顺序

多样例工作始终按以下顺序进行：

1. **Brief 规范化**：目标产品/品类、观众、痛点、结果、证明资产、时长、平台、语气、约束。
2. **槽位原型规划**：推导需要的抽象槽位类型和观众状态路径。
3. **候选检索**：从 corpus 中为每个原型检索多个槽位候选。
4. **候选评分**：按功能匹配、证明匹配、节奏匹配、包装匹配、来源多样性、置信度和绑定支持评分。
5. **链路组装**：选择最终槽位链，允许 `keep`、`delete`、`move`、`split`、`merge`、`duplicate`、`replace`、`insert`。
6. **实现选择**：为每个槽位选择或改写脚本、节奏、包装原子。
7. **Adapter 创建**：桥接不同源视频之间的问题对象、证明对象或节奏预期差异。
8. **绑定校验**：检查 `sync`、`require`、`carryover`、`substitute`、`conflict`、证明和节奏连续性。
9. **输出组装**：生成脚本节拍、节奏方案、包装方案、镜头方案、证明清单和风险。

槽位链和绑定稳定之前，不要先写精修文案。

## 候选选择规则

从库中选择时，不要自动取第一个匹配的 `slotType`，必须比较候选。

按以下维度评分：

- **功能匹配**：`persuasionTask` 是否匹配目标观众状态跃迁。
- **主张匹配**：脚本原子的 `claimType` 是否匹配目标主张。
- **证明匹配**：现有素材能否满足 `proofNeed` 和包装功能。
- **节奏匹配**：速度是否适合时长、平台和信息复杂度。
- **包装匹配**：包装功能是否服务所需证明，而不只是样式好看。
- **绑定支持**：必要的同步、承接、依赖规则是否存在并可用。
- **置信度**：优先高置信度和非 `needReview` 项；低置信度要标记。
- **来源多样性**：除非刻意做忠实变体，否则优先使用多个源视频。
- **新颖性**：避免只是复制某条原始样例的完整顺序。

## 跨视频混合槽位

可以组合来自不同视频的槽位。

混合来源时必须显式创建 adapter：

- **object adapter / 对象适配器**：连接开头问题对象和后续结果对象。
- **claim adapter / 主张适配器**：把源样例的主张类型转译成目标品类主张。
- **proof adapter / 证明适配器**：用等价证明功能替换不可用证明载体。
- **rhythm adapter / 节奏适配器**：平滑相邻槽位之间的速度差异。
- **packaging adapter / 包装适配器**：保留证明功能，同时替换视觉表层。

如果 adapter 无法保留证明或承接关系，不要使用该候选。

## 槽位操作

构建新结构时使用这些操作：

- `keep`：直接使用候选槽位功能。
- `replace`：用同等或更强功能的槽位替换候选。
- `move`：调整槽位顺序。
- `insert`：加入源模板中没有的槽位。
- `delete`：仅在其证明或桥接不被下游需要时删除。
- `split`：把高负载槽位拆成更小槽位。
- `merge`：合并相邻的低负载槽位。
- `duplicate`：用不同证明角度或受众角度重复一个槽位。
- `fragment`：只使用槽位的一部分，例如把信任证明片段作为开场 hook。

## 校验规则

硬性检查：

1. 每个选中槽位都必须有清楚的观众状态跃迁。
2. 每个主要主张都必须有证明功能。
3. 开头关切和结果证明必须承接，或有显式桥接。
4. 机制主张需要理解时间或强视觉锚点。
5. 步骤和结果应形成因果连续，除非形式上刻意分离且增加桥接。
6. 长期信任主张需要耐久证据：时间、使用痕迹、重复反馈、历史、数据或等价证明。
7. 包装表层可以换，但包装功能不能消失。
8. 节奏原子不能在没有修复的情况下违反 `avoidFor`。
9. 混合源视频时，必须为对象、主张、证明、节奏或包装错配提供 adapter。
10. 如果一条源视频贡献了完整链路，输出应标记为忠实变体，而不是库级重组。

## 输出要求

语料库重组输出：

1. **重组目标与假设**
2. **候选检索逻辑**：需要哪些槽位原型，以及候选如何选择
3. **最终功能槽位链**：槽位类型、操作、来源样例和理由
4. **槽位实现表**：脚本/节奏/包装原子、改写方式、同步点、证明需求
5. **跨样例适配器**：对象/主张/证明/节奏/包装桥接
6. **脚本草案**
7. **节奏曲线**
8. **包装与证明方案**
9. **绑定校验**
10. **风险与修复**
11. **可替换候选**：来自库中的替代槽位或原子

构建库任务输出：

1. corpus 结构
2. 校验摘要
3. 索引摘要
4. 槽位原型覆盖
5. 重复/近重复发现
6. 缺失字段和补充建议
7. 下一步抽取优先级

## 参考文档

仅在需要时加载这些 references：

- `references/concepts.md`：术语和层级模型。
- `references/corpus-ingestion.md`：如何校验和合并多份样例视频导出。
- `references/retrieval-and-selection.md`：候选检索、评分和来源多样化选择。
- `references/recomposition-workflow.md`：语料库级重组模式。
- `references/output-formats.md`：响应模板和 JSON 输出形状。
- `references/quality-checks.md`：校验规则和失败模式。
- `references/sample-libraries/sample_001/`：单条视频的种子样例库；永远不要把它当成完整 corpus。

## 脚本

- `scripts/validate_library_corpus.py`：轻量校验单个样例库或样例库 corpus。
- `scripts/validate_corpus.py`：使用共享发现逻辑的 corpus 校验器，可写出校验报告。
- `scripts/build_slot_index.py`：构建合并检索索引，包含 `canonicalSlots`、`slotVariants`、atom variants、bindings、rules 和 templates。
- `scripts/retrieve_candidates.py`：根据 brief、mode、category 和所需槽位类型，从合并索引中检索并评分 slot variants。
- `scripts/assemble_plan.py`：根据索引和 brief 生成机器可读的重组骨架。
- `scripts/retrieve_slot_candidates.py`：兼容辅助脚本，可对 `slotCandidates` 或 `slotVariants` 排序。

使用脚本处理确定性的文件级校验和索引生成；最终创意重组仍由推理完成。
