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
   输出结构方案、脚本段落方案、节奏曲线、包装证明方案、风险和必要替代实现，并保存为 markdown 文件。具体 Shot 设计后置到 `function-slot-shot-design`，在用户认可结构方案后另存独立文件。

## Shot 设计后置原则

本 skill 不展开具体 Shot 表、逐 shot 台词、分镜画面或包装说明。第一轮重组只把槽位链、atoms、adapter、脚本段落、节奏曲线、包装证明方案和结构级校验写清楚。

- 第 7 节“包装与证明方案”必须足够支撑后续 Shot 设计：写明每个包装块的证明功能、覆盖层载体、字幕层规格、避让要求和风险。
- 不在第 5 节写逐字台词，不把结构说明伪装成口播。
- 不输出 shot 表、shot group、分镜画面、包装说明、台词/字幕或预计时长。
- 用户认可结构方案后，使用 `function-slot-shot-design` 在第二轮生成独立 `shot-design.final.md`。

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
8. binding principle / rule policy 校验
9. 剩余风险与修复
10. 必要替代实现

必须按以上顺序输出。第 5、6、7 节是并行落地视图，不表示先写脚本再派生节奏和包装。Evidence 检索过程不单独成节；第 2 节写链路选择理由，第 3 节只写 atoms 落地；第 4 节只写实际采用的 adapter；第 5 节不要使用“脚本节拍”作为结构单位，也不要写逐字台词；第 7 节必须写清包装证明和字幕层规格。第 8 节进行 binding / rule policy 校验，但不做 shot 级同步校验。brief 不接收预计时长目标。最终方案必须落盘到 `Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/restructure.final.md`。Shot 设计不写入该文件，后续由 `function-slot-shot-design` 读取本文件并另存到同一目录 `Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/shot-design.final.md`。

## 方案完成后的聊天回复

完成重组方案后，聊天回复只给可点击文件路径、一句关键摘要和一句 Shot 后续确认话术；不带验证结果、不带建议 git 提交、不列本轮相关文件、不补充其他说明。

路径必须用 Markdown 文件链接，目标使用绝对路径，保证 UI 可点击打开：

```markdown
已生成并落盘：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/restructure.final.md)

摘要：一句话说明槽位链路或核心方案。

若认可此方案，我接下来完善具体 Shot 设计。
```

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
