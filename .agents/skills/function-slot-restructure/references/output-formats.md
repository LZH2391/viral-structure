# 输出格式

使用以下格式保持重组响应一致。构建库审查、slotType 命名和槽位相似检索输出请使用 `function-slot-library-builder` 的 references。

粒度约定：

- 最终功能槽位链精确到 `slotSubtype`，不在链路层展示 source slot variant。
- `slotArchetype` 只作为父级解释和审计字段。
- 逐槽位实现中的 atom 精确到 concrete atom variant；`atomPatternId` 可保留但不能替代具体 atom。
- 必须按模板顺序输出。
- 候选检索逻辑并入逐槽位方案，不单独成节。
- Adapter 方案只写实际采用的桥接，并说明触发理由、解决了什么、如何桥接。
- 剩余风险与修复只写经过 adapter 和校验后仍未解决或需要注意的风险。

## A. 重组输出

```markdown
# 重组方案

## 1. 目标理解
[品类、受众、目标、假设]

## 2. 治理层状态
| 项 | 结果 |
|---|---|
| governance path | |
| schemaVersion | |
| reviewStatus / maturityStatus | |
| sourceSnapshot 是否匹配 | |
| needReview / reviewItems 风险 | |
| 降级说明 | |

## 3. 槽位需求图
| 需求 | 观众状态跃迁 | 主张/证明义务 | 硬边 | 可选性 |
|---|---|---|---|---|

## 4. 生成的链路假设
| 假设 | 顺序 | 使用的操作符 | 治理先验 | 为什么可行 | 风险 |
|---|---|---|---|---|---|

## 5. 选中的槽位链
| 顺序 | 需求 | slotSubtype | parent archetype | slot role | 操作 | 支持/风险 | 角色 |
|---:|---|---|---|---|---|---|---|

## 6. 逐槽位方案
### Slot 1：[slot type]
- 候选来源：
- 选择理由：
- 未选替代：
- 治理节点：slotSubtype / slotArchetype / reviewStatus / maturityStatus
- 脚本角色：
- script pattern：
- script concrete atom variant：
- 节奏角色：
- rhythm pattern：
- rhythm concrete atom variant：
- 包装/证明角色：
- packaging pattern：
- packaging concrete atom variant：
- 同步点：
- source slot variant（仅追踪用，不作为链路粒度）：
- 可替换变量：
- 治理风险：
- fallback：无 / generated_gap_fill / adapter_generated

## 7. Adapter 方案
| adapter | 触发理由 | 解决了什么 | 桥接动作 | 保留的证明/承接 |
|---|---|---|---|---|

## 8. 脚本草案 / 节拍表
[可用的分段脚本]

## 9. 节奏曲线
[快/稳/停顿/峰值/收束曲线]

## 10. 包装方案
[视觉证明和覆盖层说明]

## 11. 治理与绑定审计
| 检查项 | 来源 | 状态 | 备注 | 必要修复 |
|---|---|---|---|
| binding principle | governance | | | |
| recomposition policy | governance | | | |
| evidence binding/rule | slot_index | | | |

## 12. 剩余风险与修复
| 风险 | 来源 | 严重度 | 修复 |
|---|---|---|---|

## 13. 变体
- A：
- B：
- C：
```

## B. 校验与修复输出

```markdown
# 校验与修复

## 映射
| 脚本/分镜部分 | 映射槽位 | subtype/archetype | 治理状态 | 置信度 |
|---|---|---|---|---:|

## 问题
| 严重度 | 问题 | 被破坏的治理/证据规则 | 修复 |
|---|---|---|---|

## 修复后的链路
...

## 修复后的脚本/方案
...
```
