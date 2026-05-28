# 输出格式

使用以下格式保持重组响应一致。构建库审查、slotType 命名和槽位相似检索输出请使用 `function-slot-library-builder` 的 references。

粒度约定：

- 最终功能槽位链精确到 `slotSubtype`，不在链路层展示 source slot variant。
- `slotArchetype` 只作为父级解释和审计字段。
- 逐槽位实现中的 atom 精确到 concrete atom variant；`atomPatternId` 可保留但不能替代具体 atom。
- 必须按以下模板顺序输出。
- 第 2 节负责说明最终功能槽位链和选择理由；第 3 节只说明每个槽位实际使用了哪些 script/rhythm/packaging atoms。
- Adapter 方案只写实际采用的桥接，并说明触发理由、解决了什么、如何桥接。
- 剩余风险与修复只写经过 adapter 和校验后仍未解决或需要注意的风险。

## A. 重组输出

```markdown
# 重组方案

## 1. 重组目标与假设
[品类、受众、目标、假设]

## 2. 最终功能槽位链
| 顺序 | 需求 | slotSubtype | parent archetype | 链路功能 | 本方案用法 | 选择理由 |
|---:|---|---|---|---|---|---|

## 3. Atoms 落地表
来源短码：`A=sample_xxx`、`B=sample_yyy`（只在首次出现时说明；完整 variantId 放审计备注）

| 槽位 | 来源 | script atom（原标签 → 本方案落地） | rhythm atom（原标签 → 本方案落地） | packaging atom（原标签 → 本方案落地） | atom 处理 |
|---|---|---|---|---|---|
| [槽位名] | `A::F001` | `S001`：原标签 → 本方案脚本落地 | `R001`：原标签 → 本方案节奏落地 | `P001`：原标签 → 本方案证明/包装落地 | 同源复用 / 替换 script / 替换 rhythm / 替换 packaging / adapter_generated |

## 4. Adapter 方案
| adapter | 触发理由 | 解决了什么 | 桥接动作 | 保留的证明/承接 |
|---|---|---|---|---|

## 5. 脚本草案或节拍表
[可用的分段脚本]

## 6. 节奏曲线
[快/稳/停顿/峰值/收束曲线]

## 7. 包装与证明方案
[视觉证明和覆盖层说明]

## 8. binding principle / rule policy 校验
| 检查项 | 来源 | 状态 | 备注 | 必要修复 |
|---|---|---|---|
| binding principle | governance | | | |
| recomposition policy | governance | | | |
| evidence binding/rule | slot_index | | | |

## 9. 剩余风险与修复
| 风险 | 来源 | 严重度 | 修复 |
|---|---|---|---|

## 10. 必要替代实现
仅当当前实现存在未满足项时填写；没有则写“无”。
- 替代实现：
```

## B. 校验与修复输出

```markdown
# 校验与修复

## 映射
| 脚本/分镜部分 | 映射槽位 | subtype/archetype | 规则状态 | 未满足项 |
|---|---|---|---|---|

## 问题
| 严重度 | 问题 | 被破坏的治理/证据规则 | 修复 |
|---|---|---|---|

## 修复后的链路
...

## 修复后的脚本/方案
...
```
