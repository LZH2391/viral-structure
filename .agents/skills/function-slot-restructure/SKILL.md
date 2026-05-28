---
name: function-slot-restructure
description: 基于 FunctionSlotLibrary 索引进行短视频功能槽位重组。适用于已有 slot_index.json 或已先用 function-slot-library-builder 完成校验/索引后，需要根据目标 brief 选槽、组槽位链、选择 script/rhythm/packaging 实现、检查 bindings/rules、判断跨样例 adapter 风险并输出新短视频结构方案时。不要用它执行库构建、入库校验或 slotType 命名治理。
---

# 功能槽位重组

## 职责

这个 skill 只负责**重组**：

- 解析目标 brief
- 从已有索引中选择槽位候选
- 组成功能槽位链
- 为每个槽位选择或改写 script / rhythm / packaging atoms
- 检查 bindings 和 rules
- 判断跨样例组合是否需要 adapter
- 输出新短视频结构方案、风险和替代候选

不要在这里做构建库工作。以下任务交给 `function-slot-library-builder`：

- 校验 `Artifacts/FunctionSlotLibrary/`
- 构建 `slot_index.json`
- 统计 `slotTypeSupport`
- 查询相似槽位
- 判断 `slotType` 是否复用或新增

## 前置条件

优先使用 `function-slot-library-builder` 生成索引：

```text
Runtime/Temp/FunctionSlotLibrary/slot_index.json
```

如果没有索引，先切到构建库 skill；不要在重组过程中临时扫描原始目录。

## 输入

可接受：

- `Runtime/Temp/FunctionSlotLibrary/slot_index.json`
- 目标 brief：品类、受众、痛点、转化目标、平台、时长、语气、证明资产、生产约束
- 指定槽位链或指定 `slotType`
- 候选脚本、分镜或镜头计划，用于校验和修复

## 重组流程

1. **标准化 brief**  
   明确目标产品/品类、受众、痛点、结果、证明资产、时长、平台和限制。

2. **规划槽位链**  
   根据观众状态路径决定需要哪些 `slotType`。不要默认套用某条样例的完整 template。

3. **检索候选槽位**  
   从索引中为每个所需 `slotType` 找候选。候选不足时，标记为库覆盖不足，不要伪装成已有支持。

4. **选择实现组合**  
   为每个槽位选择 script / rhythm / packaging atoms。可以混合来源，但必须说明为什么兼容。

5. **检查 bindings 和 rules**  
   检查同步、依赖、承接、替换、冲突和证明要求。

6. **判断 adapter 风险**  
   跨样例组合时检查对象、主张、证明、节奏、包装是否断裂。adapter 是本次重组的桥接建议，不写回 FunctionSlotLibrary。

7. **输出方案**  
   输出结构方案、脚本节拍、节奏曲线、包装证明方案、风险和可替换候选。

## 候选选择规则

不要只选第一个匹配的 `slotType`。比较：

- `persuasionTask` 是否匹配目标观众状态跃迁
- script atom 的 `claimType` 是否匹配目标主张
- `proofNeed` 是否能被目标素材满足
- rhythm atom 是否适合信息密度和时长
- packaging atom 的 `packagingFunction` 是否服务证明
- bindings/rules 是否支持当前组合
- `confidence` 和 `needReview`
- 是否过度依赖单一源样例

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
3. 最终功能槽位链
4. 槽位实现表
5. 跨样例 adapter 风险与桥接建议
6. 脚本草案或节拍表
7. 节奏曲线
8. 包装与证明方案
9. binding / rule 校验
10. 风险与修复
11. 可替换候选

校验修复输出：

1. 方案到槽位的映射
2. 发现的问题
3. 违反的 binding / rule
4. 修复建议
5. 修复后的槽位链或结构方案

## 参考文档

按需读取：

- `references/recomposition-workflow.md`：重组工作流。
- `references/retrieval-and-selection.md`：候选选择和评分。
- `references/quality-checks.md`：重组质量检查。
- `references/output-formats.md`：输出模板。

构建库、校验库和 slotType 命名治理请使用 `function-slot-library-builder`。
