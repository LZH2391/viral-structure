---
name: function-slot-restructure
description: 基于 FunctionSlotLibrary 证据索引和语义治理 JSON 进行短视频功能槽位重组。适用于已有 slot_index.json 和 semantic-governance.v1.json，或已先用 function-slot-library-builder 完成校验/索引/治理后，需要根据目标 brief 选 slot subtype/archetype、组槽位链、选择 script/rhythm/packaging pattern 与 variant、检查 binding principle/rule policy、判断跨样例 adapter 风险并输出新短视频结构方案时。不要用它执行库构建、入库校验或 slotType 命名治理。
---

# 功能槽位重组

## 职责

这个 skill 只负责**重组**：

- 解析目标 brief
- 从已有证据索引和已确认治理结论中选择槽位候选
- 组成功能槽位链
- 为每个槽位选择或改写 script / rhythm / packaging pattern 与 atoms
- 检查 binding patterns / principles 和 rule patterns / recomposition policies
- 判断跨样例组合是否需要 adapter
- 输出新短视频结构方案、风险和替代候选

不要在这里做构建库工作。以下任务交给 `function-slot-library-builder`：

- 校验 `Artifacts/FunctionSlotLibrary/`
- 构建 `slot_index.json`
- 统计 `slotTypeSupport`
- 生成和审查 `semantic-governance.v1.json`
- 判断 `slotType` 是否复用或新增

## 前置条件

优先使用 `function-slot-library-builder` 生成证据索引和正式治理 JSON：

```text
Runtime/Temp/FunctionSlotLibrary/slot_index.json
Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json
```

如果没有索引或治理文件，先切到构建库 skill；不要在重组过程中临时扫描原始目录。只有用户明确要求草拟方案且接受低置信度时，才允许只用 `slot_index.json` 降级重组，并必须披露“未使用治理层”。

读取治理文件后先检查：

- `schemaVersion` 是否为 `function_slot_semantic_governance.v1`
- `sourceSnapshot` 是否与当前 index/corpus 的 artifact `contentHash` 对齐
- `reviewStatus / maturityStatus`
- `needReviewMap / reviewItems / unmapped*Variants`

治理文件过期或大量 candidate 时，可以继续输出方案，但必须降级置信度并说明风险。

## 输入

可接受：

- `Runtime/Temp/FunctionSlotLibrary/slot_index.json`
- `Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json`
- 目标 brief：品类、受众、痛点、转化目标、平台、时长、语气、证明资产、生产约束
- 指定槽位链或指定 `slotType`
- 指定 `slotSubtypeId / slotArchetypeId / implementationBundleId`
- 候选脚本、分镜或镜头计划，用于校验和修复

## 重组流程

1. **标准化 brief**  
   明确目标产品/品类、受众、痛点、结果、证明资产、时长、平台和限制。

2. **规划槽位链**  
   根据观众状态路径决定需要哪些 `slotType`。不要默认套用某条样例的完整 template。

3. **读取治理层并校准证据层**  
   将 `semantic-governance.v1.json` 中的 `slotSubtypes / slotArchetypes / atomPatterns / bindingPatterns / recompositionPolicies / implementationBundles` 映射回 `slot_index.json` 的真实 variants。治理层是选择依据，证据层是来源事实。

4. **检索候选槽位**  
   优先按需求节点匹配 `slotSubtype / slotArchetype`，再落到 `slotType / variant`。候选不足时，标记为库覆盖不足，不要伪装成已有支持。

5. **选择实现组合**  
   为每个槽位选择 script / rhythm / packaging pattern 和具体 atoms。可以混合来源，但必须说明为什么兼容，并说明保留了哪些 proof obligation / chain dependency。

6. **检查 bindings 和 rules**  
   优先检查治理层 `bindingPatterns / bindingPrinciples / rulePatterns / recompositionPolicies`，再回看证据层 bindings/rules。检查同步、依赖、承接、替换、冲突和证明要求。

7. **判断 adapter 风险**  
   跨样例组合时检查对象、主张、证明、节奏、包装是否断裂。adapter 是本次重组的桥接建议，不写回 FunctionSlotLibrary。

8. **输出方案**  
   输出结构方案、脚本节拍、节奏曲线、包装证明方案、风险和可替换候选。

## 候选选择规则

不要只选第一个匹配的 `slotType`。比较：

- `persuasionTask` 是否匹配目标观众状态跃迁
- 治理层 `slotSubtype / slotArchetype` 是否匹配目标需求节点
- `reviewStatus / maturityStatus` 是否足以支持重组
- script atom 的 `claimType` 是否匹配目标主张
- script atom pattern 的 `claimPattern / proofNeedClass / mustKeepClasses` 是否能保留
- `proofNeed` 是否能被目标素材满足
- rhythm atom 是否适合信息密度和时长
- rhythm pattern 是否排斥当前 claim 或信息密度
- packaging atom 的 `packagingFunction` 是否服务证明
- packaging pattern 的 `proofType / visualHierarchyClass / riskClass` 是否适合目标素材
- bindings/rules 是否支持当前组合
- binding principle 和 recomposition policy 是否通过
- `confidence` 和 `needReview`
- 是否过度依赖单一源样例

`implementationBundles` 和 `observedChainPatterns` 只能作为检索先验和历史证据，不能当固定 template。Template 也只能证明“曾经这样成立”，不能直接生成新链路。

## Adapter 判断

adapter 只在重组时出现，用来提出桥接要求。

- **object adapter**：开头对象和结果对象是否承接
- **claim adapter**：主张是否漂移
- **proof adapter**：证明功能是否保留，证明载体能否替换
- **rhythm adapter**：相邻槽位节奏是否明显断裂
- **packaging adapter**：包装表层改变后，证明功能是否仍在

如果 adapter 无法保留证明或承接关系，不要使用该候选组合。

## 输出格式

重组输出：

1. 重组目标与假设
2. 候选检索逻辑
3. 治理层使用情况与过期/候选风险
4. 最终功能槽位链
5. 槽位实现表
6. 跨样例 adapter 风险与桥接建议
7. 脚本草案或节拍表
8. 节奏曲线
9. 包装与证明方案
10. binding principle / rule policy 校验
11. 风险与修复
12. 可替换候选

校验修复输出：

1. 方案到槽位的映射
2. 发现的问题
3. 违反的 binding principle / rule policy / evidence rule
4. 修复建议
5. 修复后的槽位链或结构方案

## 参考文档

按需读取：

- `references/recomposition-workflow.md`：重组工作流。
- `references/retrieval-and-selection.md`：候选选择和评分。
- `references/quality-checks.md`：重组质量检查。
- `references/output-formats.md`：输出模板。

构建库、校验库和 slotType 命名治理请使用 `function-slot-library-builder`。
