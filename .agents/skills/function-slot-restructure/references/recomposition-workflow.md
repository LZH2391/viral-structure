# 重组工作流

使用多视频槽位库创建新短视频方案时，遵循本工作流。

## 步骤 1：定义目标观看路径

选择样例之前，先写清楚预期观众状态推进。

示例：

```text
unaware -> sees exact work pain -> sees quick action -> understands why it works -> sees output -> trusts it for repeated use -> knows what to choose
```

再把它翻译成候选 slot types。

## 步骤 2：选择槽位链策略

检索候选前先选择一种策略。

### 忠实演示链

```text
problem_activation -> mechanism_credibility -> low_barrier_operation -> result_confirmation -> trust_close
```

适用于可演示产品，且原结构与目标高度匹配。

### 结果前置 hook

```text
result_confirmation -> problem_activation -> operation -> mechanism_or_proof -> trust_close
```

当最强留存资产是结果而不是痛点时使用。

### 信任前置 review

```text
trust_proof -> problem_activation -> mechanism -> result -> choice_close
```

当创作者可信度或长期证明是最强资产时使用。

### 压缩转化链

```text
problem_activation -> operation_result_combo -> choice_close
```

适用于 8-15 秒视频。

### 教育前置结构

```text
misconception_or_mistake -> mechanism -> demonstration -> result -> action
```

适用于知识带货或创作者权威型内容。

## 步骤 3：按槽位检索候选

对每个 slot type，在 corpus 允许时至少检索 2 个候选。比较：

- 观众状态匹配
- 证明要求
- 节奏可行性
- 包装可行性
- 来源可靠性
- 与目标品类/风格的距离

如果某个 slot type 没有候选，可以生成新槽位实现，但必须标记为 outside-library generated。

## 步骤 4：选择实现混合方式

对每个槽位，判断采用哪种方式：

- 使用某个样例的完整 slot variant
- 保留 slot variant，但替换 script atom
- 保留 script，但替换 rhythm
- 保留 script 和 rhythm，但替换 packaging
- 使用 canonical slot definition 生成新的实现

好的重组通常会混合至少两个源样例，但不能以破坏 bindings 为代价。

## 步骤 5：检查跨槽位依赖

常见依赖：

- problem slot 必须被 result slot 回收
- operation slot 必须离 result slot 足够近，保证归因
- mechanism slot 不应打断强紧迫 hook，除非有视觉锚点
- trust slot 必须使用与主张相关的证明，不能只是泛化可信度
- close slot 必须指向具体选择、行动或记忆对象

## 步骤 6：设计节奏曲线

槽位链选定后，再创建视频级节奏曲线。

示例：

```text
fast problem hit -> steady explanation -> pause/action -> result peak -> proof close
```

```text
result peak -> rewind explanation -> stable proof -> decisive close
```

节奏可以跨越槽位边界，应显式表达：

```text
low_barrier_operation + result_confirmation = pause -> action -> payoff
```

## 步骤 7：按证明功能设计包装

为每个主张分配证明包装。

```text
problem claim -> object/concern visibility
mechanism claim -> explanation proof
operation claim -> step/completion proof
result claim -> before/after or output proof
trust claim -> time, repetition, social proof, usage trace
choice close -> product/service/action memory point
```

## 步骤 8：产出可执行方案

输出应是可用计划，而不是抽象理论：

- 分段文案
- 镜头或屏幕录制动作
- 包装覆盖层
- 节奏时间
- 所需证明材料
- 绑定检查
- 替代版本

## 步骤 9：标记置信度

置信度应反映 corpus 支持度和目标匹配度。

高置信度：

- 链路由多个样例支持或具有逻辑必要性
- 证明资产存在
- 原子兼容
- 绑定通过

中置信度：

- 链路有支持但品类不同
- 证明资产不完整
- 需要一两个生成式实现

低置信度：

- 主要由稀疏库数据生成
- 缺少证明资产
- 仍存在主要绑定风险
