---
name: function-slot-restructure
description: 构建、搜索、校验和重组由多条样例视频 JSON 导出组成的大型短视频功能槽位库。当用户拥有 slots、script atoms、rhythm atoms、packaging atoms、bindings、rules、templates、manifests，或多个视频派生库，并希望从 corpus 中选择槽位、跨样例组合槽位、生成新的槽位链、校验重组后的短视频结构，或设计可复用的短视频脚本/节奏/包装系统时使用。
---

# 短视频槽位库

## 核心定位

把上传的数据视为**多样例槽位 corpus**，而不是一条可复用视频模板。

主对象是**槽位库**：

`多条样例视频 -> 多个候选功能槽位 -> 可选择的槽位链 -> 兼容的脚本/节奏/包装实现 -> 绑定校验 -> 新短视频方案`

除非用户明确要求忠实变体，否则不要简单改编单一源视频。

## 概念层级

1. **sample library / 样例库**：一条视频导出的 `manifest`、`slots`、`atoms.script`、`atoms.rhythm`、`atoms.packaging`、`bindings`、`rules` 和 `templates`。
2. **corpus library / 语料库**：多个样例库合并或一起检索。
3. **slot candidate / 槽位候选**：来自某条源视频的一个可复用功能槽位，带有兼容原子和约束。
4. **slot archetype / 槽位原型**：跨多个样例共享的标准化槽位类型或更高层角色，例如 `problem_activation`、`result_confirmation` 或 `trust_close`。
5. **recomposition plan / 重组方案**：从选中的槽位候选组装出的新槽位链，可能来自不同样例视频。
6. **surface execution / 表层执行**：最终脚本文案、节奏曲线、包装方案、镜头方案和证明清单。

## 关键区分

- 使用 **templates** 作为可选链路预设。
- 使用 **slots** 作为重组单位。
- 使用 **atoms** 作为槽位内的实现。
- 使用 **bindings 和 rules** 作为兼容性约束。
- 使用 **source videos** 作为证据和灵感，而不是强制结构。

## 输入

可接受以下任意输入：

- 单个样例视频导出，包含 `manifest.json`、`slots.json`、`atoms.script.json`、`atoms.rhythm.json`、`atoms.packaging.json`、`bindings.json`、`rules.json`、`templates.json` 等文件。
- 分目录保存的多条样例视频导出 corpus。
- 由 `scripts/build_slot_index.py` 创建的合并索引。
- 目标 brief：品类、受众、痛点、转化目标、平台、时长、语气、证明资产、生产约束。
- 需要校验和修复的候选槽位链、脚本、分镜或镜头计划。
- 关于 skill、schema、workflow 或库治理的设计请求。

如果存在多组上传文件，推断最新且完整的一组；只有歧义会阻塞进展时才提问。

## 本地项目接入

对于 `C:\ByteDanceFullStack` 项目，把 `Artifacts/FunctionSlotLibrary/` 视为真实的本地样例库 corpus。每个子目录都是从可追踪的 `functionSlotAtomizationAnalysis` artifact 导出的一个样例库：

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

当脚本收到仓库根目录时，应解析到 `Artifacts/FunctionSlotLibrary/`，不应摄入 `.agents/skills/function-slot-restructure/references/sample-libraries/`，除非用户明确要求检查内置种子样例。

内置的 `references/sample-libraries/sample_001/` 只是用于解释 schema 和 workflow 的种子样例。不要默认把它合并进项目真实 corpus，也不要把它视为 corpus 支持度。

生成的索引、检索报告和方案骨架写入被忽略的工作目录，例如 `Runtime/Temp/FunctionSlotLibrary/`。除非用户明确要求生成精选 artifact，否则不要提交生成索引或本地运行输出。

项目 manifest 使用 `function_slot_library.v1`，必须保留 `artifactId`、`sampleVideoId`、`traceId`、`parentArtifactId`、source artifact ids、`contentHash` 和 `counts` 等追踪字段。Corpus 级输出可以包含仓库相对路径，但不应包含本地绝对路径、完整 prompt、DebugSnapshots、视频/帧内容或敏感材料。

## 工作流决策树

### 构建或更新槽位 corpus

1. 校验每个样例视频导出。
2. 标准化 source ids 和文件名。
3. 构建包含槽位候选、原子、绑定、模板和规则的 corpus 索引。
4. 按 `slotType`、claim type、proof need、rhythm pace、packaging function、confidence 和 source sample 对候选分组。
5. 报告覆盖缺口和 schema 问题。

有本地 JSON 文件时，使用 `scripts/validate_library_corpus.py` 和 `scripts/build_slot_index.py`。

在本仓库中，默认确定性流程是：

```bash
python .agents/skills/function-slot-restructure/scripts/validate_corpus.py . --out Runtime/Temp/FunctionSlotLibrary/validation.json
python .agents/skills/function-slot-restructure/scripts/build_slot_index.py . --out Runtime/Temp/FunctionSlotLibrary/slot_index.json
python .agents/skills/function-slot-restructure/scripts/retrieve_candidates.py Runtime/Temp/FunctionSlotLibrary/slot_index.json --query "<target brief>" --slot-types problem_activation,result_confirmation --out Runtime/Temp/FunctionSlotLibrary/retrieval.json
python .agents/skills/function-slot-restructure/scripts/assemble_plan.py Runtime/Temp/FunctionSlotLibrary/slot_index.json --brief Runtime/Temp/FunctionSlotLibrary/brief.json --out Runtime/Temp/FunctionSlotLibrary/plan.json
```

### 从 corpus 重组

1. 标准化目标 brief。
2. 决定所需观众状态路径和槽位原型。
3. 为每个原型从 corpus 检索候选槽位。
4. 选择具有来源多样性和绑定兼容性的槽位链。
5. 为每个选中槽位填入脚本、节奏和包装实现。
6. 当不同源视频的槽位需要对象、主张、证明或节奏桥接时，添加 adapters。
7. 校验 bindings、proof functions、carryovers 和 rhythm conflicts。
8. 产出新的脚本/节奏/包装/镜头方案。

### 校验或修复重组方案

1. 将方案映射到槽位原型。
2. 识别它看起来使用了哪些选中槽位和原子。
3. 检查缺失的证明功能、断裂的 carryovers、节奏冲突和包装功能丢失。
4. 通过替换槽位、改变原子实现、增加桥接或调整槽位顺序来修复。

### 设计或改进 skill/library

1. 区分样例级抽取和 corpus 级检索。
2. 定义槽位候选 schema、corpus 索引 schema、检索评分、组装规则、校验规则和输出。
3. 把一个上传样例只当成种子库。
4. 增加去重、多样性、治理和质量 review 流程。

## Corpus 级重组顺序

多样例工作始终按此顺序进行：

1. **Brief 标准化**：目标产品/品类、观众、痛点、结果、证明资产、时长、平台、语气、约束。
2. **槽位原型规划**：推断需要的抽象槽位类型和观众状态路径。
3. **候选检索**：从 corpus 中为每个原型检索多个槽位候选。
4. **候选评分**：按功能匹配、证明匹配、节奏匹配、包装匹配、来源多样性、置信度和绑定支持评分。
5. **链路组装**：选择最终槽位链，允许 keep、delete、move、split、merge、duplicate、replace 或 insert 操作。
6. **实现选择**：为每个槽位选择或适配脚本、节奏和包装原子。
7. **Adapter 创建**：桥接源视频之间的问题对象、证明对象或节奏预期差异。
8. **绑定校验**：检查 sync、require、carryover、substitute、conflict、proof 和 rhythm continuity。
9. **输出组装**：生成脚本节拍、节奏方案、包装方案、镜头方案、证明清单和风险。

槽位链和绑定稳定之前，不要写精修文案。

## 候选选择规则

从库中选择时，不要自动选择第一个匹配的槽位类型。要比较候选。

对每个候选按以下维度评分：

- **functional fit / 功能匹配**：`persuasionTask` 是否匹配目标观众状态跃迁。
- **claim fit / 主张匹配**：脚本原子的 `claimType` 是否匹配目标主张。
- **proof fit / 证明匹配**：可用资产能否满足 `proofNeed` 和包装功能。
- **rhythm fit / 节奏匹配**：节奏是否适合时长、平台和信息复杂度。
- **packaging fit / 包装匹配**：包装功能是否匹配所需证明，而不只是匹配想要的样式。
- **binding support / 绑定支持**：所需 sync/carryover/require 规则是否存在并可用。
- **confidence / 置信度**：优先高置信度和非 review 项；标记低置信度选择。
- **source diversity / 来源多样性**：除非刻意做忠实变体，否则优先多源视频。
- **novelty / 新颖性**：避免只是复制某个原始样例的完整序列。

## 跨视频混合槽位

可以组合来自不同视频的槽位。

混合来源时，显式创建 adapters：

- **object adapter / 对象适配器**：连接开头问题对象和后续结果对象。
- **claim adapter / 主张适配器**：把某个样例的主张类型转译为目标品类主张。
- **proof adapter / 证明适配器**：用等价证明功能替换不可用证明。
- **rhythm adapter / 节奏适配器**：平滑相邻不同来源槽位之间的速度变化。
- **packaging adapter / 包装适配器**：在改变视觉表层时保留证明功能。

如果没有 adapter 能保留证明或 carryover，不要使用该候选。

## 槽位操作

用这些操作构建新结构：

- `keep`：按原样使用候选槽位功能。
- `replace`：换成另一个相同或更强功能的候选。
- `move`：改变槽位顺序。
- `insert`：加入源模板中不存在的槽位。
- `delete`：仅在下游不需要其证明或桥接时删除。
- `split`：把高负载槽位拆成较小槽位。
- `merge`：合并相邻的低负载槽位。
- `duplicate`：用不同证明角度或受众角度重复一个槽位。
- `fragment`：只使用槽位的一部分，例如把信任证明片段作为开场 hook。

## 校验规则

硬检查：

1. 每个选中槽位都必须有清楚的观众状态跃迁。
2. 每个主要主张都必须有证明功能。
3. 开头关切和结果证明必须 carry over，或被显式桥接。
4. 机制主张需要理解时间或强视觉锚点。
5. 步骤和结果应有因果连续感，除非形式上刻意分离并增加桥接。
6. 长期信任主张需要耐久证据：时间、使用痕迹、重复反馈、历史、数据或等价物。
7. 包装表层可以改变，但包装功能不能消失。
8. 节奏原子不能在没有修复的情况下违反 `avoidFor` 约束。
9. 混合源视频需要 adapters 处理对象、主张、证明、节奏或包装错配。
10. 如果一个源视频贡献了整条链路，把输出标记为忠实变体，而不是库级重组。

## 输出要求

对于 corpus 重组，输出：

1. **重组目标与假设**
2. **候选检索逻辑**：需要哪些槽位原型，以及候选如何选择
3. **最终功能槽位链**：槽位类型、操作、来源样例和理由
4. **槽位实现表**：脚本/节奏/包装原子、适配、同步点、证明需求
5. **跨样例适配器**：object/claim/proof/rhythm/packaging bridges
6. **脚本草案**
7. **节奏曲线**
8. **包装与证明方案**
9. **绑定校验**
10. **风险与修复**
11. **可替换候选**：来自库中的替代槽位或原子

对于构建库任务，输出：

1. corpus structure
2. validation summary
3. index summary
4. slot archetype coverage
5. duplicate/near-duplicate findings
6. missing fields and enrichment suggestions
7. next extraction priorities

## 参考文档

仅在需要时加载这些 references：

- `references/concepts.md`：术语和层级模型。
- `references/corpus-ingestion.md`：如何校验和合并多份样例视频导出。
- `references/retrieval-and-selection.md`：候选检索、评分和来源多样化选择。
- `references/recomposition-workflow.md`：corpus 级重组模式。
- `references/output-formats.md`：响应模板和 JSON 输出形状。
- `references/quality-checks.md`：校验和失败模式。
- `references/sample-libraries/sample_001/`：来自单条视频的种子样例库；不要把它当成完整 corpus。

## 脚本

- `scripts/validate_library_corpus.py`：单个样例库或 corpus 的轻量校验器。
- `scripts/validate_corpus.py`：使用共享发现 helper 的 corpus 校验器，可写入校验报告。
- `scripts/build_slot_index.py`：构建合并检索索引，包含 `canonicalSlots`、`slotVariants`、atom variants、bindings、rules 和 templates。
- `scripts/retrieve_candidates.py`：按 brief、mode、category 和请求的 slot types 从合并索引中检索和评分 slot variants。
- `scripts/assemble_plan.py`：根据索引和 brief 生成机器可读的重组骨架。
- `scripts/retrieve_slot_candidates.py`：兼容 helper，可对 `slotCandidates` 或 `slotVariants` 排序。

使用脚本做确定性的文件级检查和索引生成。最终创意重组使用推理完成。
