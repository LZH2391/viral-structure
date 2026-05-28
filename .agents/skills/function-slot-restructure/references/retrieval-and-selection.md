# 检索与选择

当需要从多视频库中选择槽位和原子时，使用本参考。

## 选择顺序

按以下顺序选择：

1. **brief constraints / brief 约束**：观众状态、主张、证明资产、异议、时长和生产限制
2. **slot demand graph / 槽位需求图**：所需观众状态跃迁，以及它们之间的硬边/软边
3. **chain hypotheses / 链路假设**：用操作符生成，而不是从策略菜单中选择
4. **semantic governance / 语义治理层**：哪些 subtype/archetype/pattern/policy 已被审查
5. **slot subtypes and archetypes / 槽位子型和原型**：哪个治理节点最能满足需求节点
6. **slot variants / 槽位变体**：哪些来源样例能落地该治理节点
7. **script atom patterns and atoms / 脚本模式和原子**：哪种主张实现适合目标
8. **rhythm atom patterns and atoms / 节奏模式和原子**：哪种注意力模式适合主张和时长
9. **packaging atom patterns and atoms / 包装模式和原子**：哪种证明/视觉实现适合可用资产
10. **binding principles, policies, bindings and rules / 绑定原则、政策、绑定和规则**：什么必须同步、承接或避免

不要先检索包装样式，再围绕它强行拼槽位。

## Evidence 适配检查

重组阶段不使用 `confidence`、`needReview`、来源多样性或候选分数做决策。它们可以保留在证据输出中供审阅，但不能决定是否采用。

采用一个 source variant 只看它是否满足目标需求、证明义务、节奏/包装功能和 binding/rule 约束。

按以下层级做适配检查：

### 1. 功能匹配

候选 subtype/archetype 和槽位 variant 是否产生目标观众状态跃迁？

高匹配通常满足：

- `slotSubtype.viewerTransition / proofObligation` 匹配需求节点
- `slotArchetype.primaryProofObligationClass / chainDependencyClass` 不冲突
- `viewerStateBefore` 和 `viewerStateAfter` 匹配链路中的目标位置
- `persuasionTask` 匹配目标任务
- 该槽位所需同步点可实现

### 2. 主张与证明匹配

候选的证明需求是否能被目标满足？

示例：

- 机制主张需要机制解释或视觉证明
- 操作主张需要步骤提示和完成动作
- 结果主张需要与前置关切绑定的结果证据
- 长期信任主张需要时间证据、使用痕迹、评价、日志或重复反馈

治理层优先检查：

- script pattern 的 `claimPattern / proofNeedClass / mustKeepClasses`
- rhythm pattern 的 `rhythmFunction / paceClass / densityClass / syncPointClasses`
- packaging pattern 的 `proofType / visualHierarchyClass / replaceableFormClasses / riskClass`
- pattern 的 `forSlotSubtypeIds` 是否覆盖当前槽位 subtype

### 3. 节奏匹配

节奏是否支撑信息量？

示例：

- 快速连击适合痛点激活，不适合复杂机制
- 稳定高密度适合解释
- 停顿后动作适合步骤到结果的转场
- 慢速证言适合信任收束

### 4. 包装匹配

包装功能是否匹配主张和目标生产资源？

先选择证明功能，再选择视觉样式。

示例：

- 问题定位 -> 近景、高亮、光标圈选、裁切、对比框
- 机制 -> 图解、覆盖层、屏幕标注、演示剖面
- 步骤 -> 图标、倒计时、清单、手势、界面指针
- 结果 -> 前后对比、输出屏、近景、数字变化
- 信任 -> 记录、重复证明、使用痕迹、证言、评价、收据、使用日志

### 5. 证据审阅字段

`confidence`、`needReview`、`reviewStatus`、`maturityStatus` 只作为审阅字段保留。重组时不因这些字段加分、扣分或阻断；若 evidence 的证明、承接或规则约束不成立，即使这些字段看起来更好也不能采用。

## 检索模式

### 精确槽位检索

当用户要求特定 slot type、slot subtype 或 slot archetype 时使用。

输出：

- 匹配到的治理节点
- top candidate slot variants
- 它们的来源样例
- script/rhythm/packaging 选项
- 证明要求
- 风险

### 需求图链路生成

当用户要求制作新视频时使用。

输出：

- brief 约束
- 槽位需求图
- 生成的链路假设和使用的操作符
- 选中链路，以及它为什么在全局上胜出
- 从库中借用的槽位
- 治理层支持：subtype/archetype/pattern/policy
- 因库中缺少直接覆盖而生成、插入、切片或适配的槽位

### 缺口感知检索

当 corpus 缺少样例时使用。

输出：

- 可用的库候选
- 缺失的槽位或原子类型
- 缺失的治理覆盖：subtype / atom pattern / binding pattern / policy
- 生成式 fallback 实现
- 未满足项与需要补齐的证明/素材

## 槽位混合规则

可以混合不同视频的 script、rhythm 和 packaging atoms，前提是：

- 它们共享相同或兼容的 slot subtype/archetype；只有无治理覆盖时才退回 slot type
- script 的 proof need 能被 packaging atom 满足
- rhythm 没有在 `avoidFor` 中排斥该 script claim type
- atom pattern 的 `forSlotSubtypeIds` 覆盖当前 subtype，或明确解释为什么可迁移
- binding principle / recomposition policy 没有禁止这种组合
- 必要同步点可以对齐
- 跨槽位 carryover 保持完整

不要仅因为标签听起来相似就混合原子。

## 选择解释示例

```text
选择 sample_014 的 problem_activation，因为它的观众状态跃迁匹配目标开场，并且有很强的对象-动作同步。节奏使用 sample_006，因为目标是 12 秒视频，需要更快进入。包装替换为 sample_021 的屏幕录制高亮，因为目标是 SaaS，不是护肤。绑定检查通过，因为问题对象、光标高亮和点击动作可以落在同一拍点。
```

治理层版本：

```text
选择 SUB_object_action_problem_activation 下的 sample_014 variant，因为它的主证明义务是“可见问题对象 + 直接动作入口”，匹配目标开场。script 使用 SCRIPT_pattern_problem_to_need，packaging 使用 PACK_pattern_visual_identity_and_entry；rhythm 从同 subtype 的快节奏 pattern 借用。implementationBundle 只作为候选排序先验，不固定整条链路。
```
