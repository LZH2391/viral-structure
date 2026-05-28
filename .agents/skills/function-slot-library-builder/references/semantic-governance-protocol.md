# 语义治理协议

用于 agent 审查 slot family、archetype 和 subtype。

## 审查顺序

1. 从 `slot_index.json` 读取 `slotVariants`、相关 atom、binding、rule 和 template。
2. 先确认每个 variant 的观众状态迁移和说服任务。
3. 再比较证明义务、方案出现时机、节奏功能、包装证明功能和链路依赖。
4. 判断是同 subtype、同 archetype 不同 subtype、同 family 不同 archetype，还是不同 family。
5. 输出结论、来源、差异点和误分风险。

## 必比维度

每次归并都必须比较：

- viewer state transition：观众 before/after 是否本质一致。
- persuasion task：解决的是不是同一个说服问题。
- proof obligation：必须保留哪些证明对象、动作、证据或场景。
- solution visibility：解决方案是立即出现、延迟出现、结果前置还是隐性承接。
- rhythm function：节奏是在打断、蓄势、解释、峰值、回落还是收束。
- packaging proof function：包装是在定位对象、增强真实感、解释机制、验证结果还是建立信任。
- chain dependency：前后槽位必须回扣什么关切或证据。

## 判定标准

### Slot family

`slotFamily` 只表示同一大阶段或高层说服任务族。family 不作为 archetype 合并依据；同 family 的相邻槽仍必须重新判断 viewer state transition、persuasion task 和 proof obligation。

### Slot archetype

`slotArchetype` 只表示同一槽位任务原型，必须由 `viewerStateBefore/After`、`persuasionTask` 和 `primaryProofObligationClass` 锁定。

`chainDependencyClass` 只描述前后依赖，不参与父类判断。`excludes` 必须明确哪些相邻槽、桥接槽、对比槽、操作槽或子类型不能归入该 archetype。

### Slot subtype

`slotSubtype` 只能表达同一 archetype 下的实现层差异，例如素材、表达、节奏和包装。subtype 不能改变主证明义务，不能改变链路角色，也不能把不同任务重新装回同一个 archetype。

### 同 subtype

满足：

- viewer state transition 基本一致。
- persuasion task 基本一致。
- proof obligation 基本一致。
- solution visibility 基本一致。
- 前后链路依赖基本一致。

素材、品类、口播、包装样式不同，不影响同 subtype。

### 同 archetype，不同 subtype

满足：

- viewer state transition 大方向相近。
- persuasion task 大方向相近。
- proof obligation、solution visibility、rhythm function 或 packaging proof function 明显不同。

例：`problem_activation` 和 `scene_problem_activation` 都在建立需求/问题成立，但前者靠具体问题对象和直接动作，后者靠生活场景、干扰源和共鸣解释。

### 同 family，不同 archetype

满足：

- 同属高层说服任务族。
- 具体观众状态变化、证明机制或链路角色不同。

例：结果前置型开场、痛点回补、价值锚定都可能属于需求/观看理由建立 family，但不应硬合并为同一 archetype。

### 不同 family

满足任一：

- 核心说服任务不同。
- viewer state after 不同。
- proof obligation 无法互换。
- 前后链路依赖明显不同。

## 禁止项

- 不要按 `slotType` 名称相似合并。
- 不要按字段完全一致合并。
- 不要按文本相似度合并。
- 不要让 script atom 归并结果决定 rhythm 或 packaging 归并。
- 不要把 template 当最高规则；template 只是历史链路样本。
- 不要因为某槽 require / support 后续机制证明，就把该槽归入机制证明 archetype。
- 不要让 binding、rule 或 observed chain 反向决定 slot archetype。

## 输出要求

每个治理项都要写：

- 归并结论。
- 支持来源。
- 为什么能合并或为什么只能挂父级。
- 差异点。
- 如果误分，会导致什么重组风险。
