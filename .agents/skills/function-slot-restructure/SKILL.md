---
name: function-slot-restructure
description: 基于 FunctionSlotLibrary 证据索引和语义治理 JSON 进行短视频功能槽位重组。适用于已有 slot_index.json 和 semantic-governance.v1.json，或已先用 function-slot-library-builder 完成校验/索引/治理后，需要根据目标 brief 选 slot subtype/archetype、组槽位链、选择 script/rhythm/packaging pattern 与 variant、检查 binding principle/rule policy、判断跨样例 adapter 风险并输出新短视频结构方案时。不要用它执行库构建、入库校验或 slotType 命名治理。
---

# 功能槽位重组

## 职责

这个 skill 只负责**重组**：

- 解析目标 brief
- 从已有证据索引和已确认治理结论中定位可用 source variants
- 组成功能槽位链
- 为每个槽位选择或改写 script / rhythm / packaging pattern 与 atoms
- 检查 binding patterns / principles 和 rule patterns / recomposition policies
- 判断跨样例组合是否需要 adapter
- 输出新短视频结构方案、风险和必要的替代实现

不要在这里做构建库工作。以下任务交给 `function-slot-library-builder`：

- 校验 `Artifacts/FunctionSlotLibrary/`
- 构建 `slot_index.json`
- 统计 `slotTypeSupport`
- 生成和审查 `semantic-governance.v1.json`
- 判断 `slotType` 是否复用或新增

历史兼容路径中可能保留校验/索引脚本 wrapper，但正式脚本归属和文档入口都在 `function-slot-library-builder`。重组 skill 只消费其产出的 evidence index 和 governance JSON。

## 前置条件

优先使用 `function-slot-library-builder` 生成证据索引和正式治理 JSON：

```text
Runtime/Temp/FunctionSlotLibrary/slot_index.json
Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json
```

如果没有索引或治理文件，先切到构建库 skill；不要在重组过程中临时扫描原始目录。只有用户明确要求草拟方案且接受约束不足风险时，才允许只用 `slot_index.json` 重组，并必须披露“未使用治理层”。

读取治理文件后先检查：

- `schemaVersion` 是否为 `function_slot_semantic_governance.v1`
- `sourceSnapshot` 是否与当前 index/corpus 的 artifact `contentHash` 对齐
- `needReviewMap / reviewItems / unmapped*Variants`

治理文件过期时，可以继续输出方案，但必须说明哪些治理映射可能过期。

## 输入

可接受：

- `Runtime/Temp/FunctionSlotLibrary/slot_index.json`
- `Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json`
- 目标 brief：品类、受众、痛点、转化目标、平台、语气、证明资产、生产约束
- 指定槽位链或指定 `slotType`
- 指定 `slotSubtypeId / slotArchetypeId / implementationBundleId`
- 待校验的脚本、分镜或镜头计划，用于校验和修复

## 重组流程

1. **标准化 brief**  
   明确目标产品/品类、受众、痛点、结果、证明资产、平台和限制。

2. **规划槽位链**  
   根据观众状态路径和当前语料库证据决定需要哪些 `slotType` / `slotSubtype`。不要默认套用某条样例的完整 template，也不要把固定五槽链当默认链路。

3. **读取治理层并校准证据层**  
   将 `semantic-governance.v1.json` 中的 `slotSubtypes / slotArchetypes / atomPatterns / bindingPatterns / recompositionPolicies / implementationBundles` 映射回 `slot_index.json` 的真实 variants。治理层是选择依据，证据层是来源事实。

4. **定位 source variants**  
   优先按需求节点匹配 `slotSubtype / slotArchetype`，再落到 `slotType / variant`。可用 evidence 不足时，标记为库覆盖不足，不要伪装成已有支持。

5. **选择实现组合**  
   为每个槽位选择 script / rhythm / packaging pattern 和具体 atoms。可以混合来源，但必须说明为什么兼容，并说明保留了哪些 proof obligation / chain dependency。

6. **检查 bindings 和 rules**  
   优先检查治理层 `bindingPatterns / bindingPrinciples / rulePatterns / recompositionPolicies`，再回看证据层 bindings/rules。检查同步、依赖、承接、替换、冲突和证明要求。

7. **判断 adapter 风险**  
   跨样例组合时检查对象、主张、证明、节奏、包装是否断裂。adapter 是本次重组的桥接建议，不写回 FunctionSlotLibrary。

8. **输出方案**  
   输出结构方案、脚本段落方案、节奏曲线、包装证明方案、Shot 设计、风险和必要替代实现，并保存为 markdown 文件。

## 台词与字幕原则

重组方案里的台词/字幕是面向拍摄和剪辑的可执行文案，不是结构说明的复述。写台词前先明确本 shot 的观众动作：看见问题、理解依据、感到安心、确认质感、记住选择对象。台词只服务这个动作，不解释 slot、atom、proof obligation 或 adapter。

- 台词必须像真人短视频口播，优先短句、口语、可一口读完；默认每个 shot 只放 1 个意思。
- 不把第 5 节“本方案表达”直接改写成口播。第 5 节是语义任务，第 8 节台词要重新压成自然说法。
- 不在台词里写结构词或审计词，例如“机制主张”“证明载体”“适用范围说明”“替换入口”“长期可信”“购买记忆”。这些只属于方案说明、包装说明或校验备注。
- 写完 Shot 设计后必须通读台词：凡是读起来像表格说明、品牌 brief、审计报告或“正确但没人会这么说”的句子，都要重写。

## 包装与字幕默认层

重组方案默认短视频成片会有字幕层。字幕不是“有一行字”即可，也不是台词字段的重复；字幕是包装证明的一部分，必须说明它服务什么功能、长什么样、放在哪里、什么时候出现。

- 第 7 节“包装与证明方案”必须为每个包装块写明字幕层规格；如果某个包装块明确不使用字幕，必须写“无字幕”并说明原因。
- 第 8 节每个 shot 的 `包装说明` 必须写可执行覆盖层规格，至少包含：字幕/标签/标题条/图卡/圈选/箭头的层级、位置、样式、强调规则、出现时机和服务功能。
- 字幕样式要写到可交给剪辑执行的粒度，例如：底部主字幕、白字黑描边、半透明深色底条、关键词黄色高亮、证据标签右上角小胶囊、对象旁小箭头标签。不要只写“短字幕”“轻量字幕”“极简 CTA”。
- 特殊字或重点词如果需要强调，必须写强调范围和样式，例如“核心问题词用黄色描边强调”，“关键证据词用绿色胶囊标签”，“关键数据或状态词用框选高亮”。如果不需要特殊强调，写“无特殊字强调”。
- 字幕层必须说明目的：动作命名、视线引导、证据标注、主张钉子、风险提示、场景归类或 CTA。不能只为了好看添加。
- 字幕不得遮挡证明主体。涉及关键动作、结果状态、证据画面、主体表情、产品或界面细节时，必须写避让位置或安全区。
- 治理库中的 packaging pattern 提供证明功能、视觉层级和可替换形式；最终视觉规格由重组方案根据 brief、平台和画面内容落地。不要期待治理库自动给出每条字幕的字号、描边和强调字。

## 输出粒度

- 最终功能槽位链精确到 `slotSubtype`，不用在链路层继续下钻到 source slot variant。
- `slotArchetype` 只作为父级解释和审计字段，不作为最终链路粒度。
- 槽位实现表中的 script / rhythm / packaging atom 必须能追溯到 concrete atom variant，例如 `sampleId::script::S001`、`sampleId::rhythm::R001`、`sampleId::packaging::P001`。
- Atoms 落地表允许且鼓励使用短码映射降低阅读负担，例如先声明 `A=sampleId`，再在表内写 `A::script::S001`；短码映射必须在第 3 节首次出现时声明，并能还原到完整 `sampleId::kind::id`。
- `atomPatternId` 可以同时保留，用于说明复用依据，但不能替代 concrete atom variant。
- 如果没有 concrete atom variant，必须标记为 `generated_gap_fill` 或 `adapter_generated`，并说明基于哪个 pattern 或需求生成。

## Evidence 使用规则

不要只选第一个匹配的 `slotType`。比较：

- `persuasionTask` 是否匹配目标观众状态跃迁
- 治理层 `slotSubtype / slotArchetype` 是否匹配目标需求节点
- script atom 的 `claimType` 是否匹配目标主张
- script atom pattern 的 `claimPattern / proofNeedClass / mustKeepClasses` 是否能保留
- `proofNeed` 是否能被目标素材满足
- rhythm atom 是否适合信息密度和主张复杂度
- rhythm pattern 是否排斥当前 claim 或信息密度
- packaging atom 的 `packagingFunction` 是否服务证明
- packaging pattern 的 `proofType / visualHierarchyClass / riskClass` 是否适合目标素材
- bindings/rules 是否支持当前组合
- binding principle 和 recomposition policy 是否通过

`confidence`、`needReview`、治理项的 `reviewStatus / maturityStatus` 可以作为审阅信息保留，但不参与重组决策。重组只判断 evidence 是否满足目标需求、证明义务和组合约束。

`implementationBundles` 和 `observedChainPatterns` 只能作为检索先验和历史证据，不能当固定 template。Template 也只能证明“曾经这样成立”，不能直接生成新链路。

如果使用 `scripts/assemble_plan.py`，把它的输出视为 evidence 骨架和检索起点；最终组合仍由 agent 按本 skill 的质量检查、binding/rule 校验和 adapter 判断完成。

## Adapter 判断

adapter 只在重组时出现，用来提出桥接要求。

- **object adapter**：开头对象和结果对象是否承接
- **claim adapter**：主张是否漂移
- **proof adapter**：证明功能是否保留，证明载体能否替换
- **rhythm adapter**：相邻槽位节奏是否明显断裂
- **packaging adapter**：包装表层改变后，证明功能是否仍在

如果 adapter 无法保留证明或承接关系，不要使用该组合。

## 输出格式

重组输出：

1. 重组目标与假设
2. 最终功能槽位链（精确到 `slotSubtype`）
3. Atoms 落地表（只写每个槽位实际使用的 concrete script / rhythm / packaging atoms，允许且鼓励使用已声明短码；每个 atom 必须写“原标签 → 本方案落地”，选择理由放在第 2 节）
4. Adapter 方案（说明触发理由、解决了什么、如何桥接）
5. 脚本段落方案
6. 节奏曲线
7. 包装与证明方案
8. Shot 设计
9. binding principle / rule policy 校验
10. 剩余风险与修复
11. 必要替代实现

必须按以上顺序输出。第 5、6、7 节是并行落地视图，不表示先写脚本再派生节奏和包装；第 8 节 Shot 设计必须依赖第 5、6、7 节，并按 `references/output-formats.md` 的字段和规则输出。Evidence 检索过程不单独成节；第 2 节写链路选择理由，第 3 节只写 atoms 落地；第 4 节只写实际采用的 adapter；第 5 节不要使用“脚本节拍”作为结构单位，也不要写逐字台词；第 7、8 节必须按“包装与字幕默认层”写清字幕/标签/覆盖层规格；第 8 节台词必须按“台词与字幕原则”重新转写为可口播短句。第 9 节再进行 binding / rule policy 校验，并同时完成台词质量、字幕包装质量自检。详细字段、Shot 预计时长占位、GPT-image-2 生图提示、台词/字幕写法和包装覆盖层写法，以 `references/output-formats.md` 为准；brief 不接收预计时长目标。最终方案必须落盘到 `Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/restructure.final.md`，聊天回复只给路径和摘要。

校验修复输出：

1. 方案到槽位的映射
2. 发现的问题
3. 违反的 binding principle / rule policy / evidence rule
4. 修复建议
5. 修复后的槽位链或结构方案

## 参考文档

按需读取：

- `references/recomposition-workflow.md`：重组工作流。
- `references/retrieval-and-selection.md`：evidence 检索和适配检查。
- `references/quality-checks.md`：重组质量检查。
- `references/output-formats.md`：输出模板。

构建库、校验库和 slotType 命名治理请使用 `function-slot-library-builder`。
