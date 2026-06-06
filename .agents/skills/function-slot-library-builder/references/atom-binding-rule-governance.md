# Atom / Binding / Rule 治理

用于 agent 审查 atom pattern、binding pattern 和 rule pattern。

## Atom 治理

atom 是 slot 的实现变体，不是独立于 slot 任意混用的素材。

三类 atom 必须独立治理：

- script atom：回答“这个状态变化靠什么主张和证明成立”。
- rhythm atom：回答“注意力和信息负载怎么推进”。
- packaging atom：回答“证明功能如何被视觉和包装层承载”。

不要把 rhythm 或 packaging pattern 并入 script pattern。三类 atom 可以形成 implementation bundle，但 bundle 只是常见组合，不替代三类 pattern。

atom 的治理层级是：

```text
atom variant
↓
atom pattern
↓
atom archetype
```

`atomArchetype` 是同一 atom layer 内的高层实现语义，例如脚本层的需求建立、机制/品质证据解释、前置关切闭合，节奏层的信息负载控制，包装层的视觉证明载体。它必须通过 `sourcePatternIds` 连接到 atom pattern，并继续保留 `sourceVariantIds` 作为证据来源。

语义功能清晰、claim/proof/rhythm/packaging function 可命名的孤例 atom 可以进入 `atomPatterns`，但必须作为 candidate pattern 处理：`support.variantCount` 可以是 1，`judgementReason` 要说明为什么当前可命名，`differenceNotes` 要写清单例证据和后续可合并/拆分空间，`riskIfMisclassified` 要写明误用风险。

单例 atom 进入 candidate pattern 不是默认动作。新增 atomPattern 前必须按以下顺序判断：

1. 先判断能否归入已有 atomPattern。如果 proofNeed、rhythmFunction 或 proofType 的语义功能相同，只是品类、素材、镜头载体、包装样式、slotType 或来源样例不同，应归入已有 pattern，并把该 atom variant 追加到 `sourceVariantIds`。
2. 再判断 parent atomArchetype 是否准确。如果多个 variant 都只能挂在很宽的父类下，说明 archetype 粒度不足，应优先新增或拆分更准确的 atomArchetype，再把 pattern 挂到新父类。
3. 最后才判断是否新增 candidate pattern。只有当该 atom 功能清晰、不能归入已有 pattern、且 parent atomArchetype 已经准确时，才新增 candidate pattern。

atomPattern 的 id/name 不应以 slotType、来源样例或单个实现载体作为主要语义。slotType 可以出现在 `forSlotSubtypeIds`、`sourceVariantIds`、`differenceNotes` 中，但 pattern 名称必须表达可迁移的 claim/proof/rhythm/packaging function。

`unmappedAtomVariants` 只用于字段不足、证明功能无法命名、边界冲突、或暂不适合进入检索治理层的 atom。不要把清晰单例长期堆进 unmapped；否则图谱和重组只会看到“未治理盒子”，无法使用当前样例的结构化经验。

### script pattern

比较：

- claim pattern
- proof need
- mustKeep
- replaceable variables
- 所属 slot subtype / archetype

不要只看文案名称。不同品类素材可以同 pattern；不同证明机制不能合并。

### rhythm pattern

比较：

- attention function
- pace
- density
- beat shape
- sync points
- avoidFor

快慢只是表层。要判断节奏服务的是打断、蓄势、解释、峰值、等待、兑现还是回落。

rhythm pattern 不能只按 pace、density 或 beat 形态命名。必须优先表达注意力功能，例如快入抓取、追问加压、解释降速、转向桥接、细节峰值、结果释放、收束冷却。快慢、镜头密度、停顿、长镜头或剪辑频率只能作为实现参数，不能单独构成 pattern。

### packaging pattern

比较：

- proof type
- visual proof type
- visual hierarchy
- replaceable forms
- risk if broken

不要按具体包装样式合并，例如圆圈、箭头、字幕、贴纸。要按包装证明功能判断。

packaging pattern 不能只按具体视觉载体或当前槽位证明句命名。必须优先表达视觉证明功能，例如对象/入口识别、问题定位、机制/因果证明、客观可信证明、感官体验证明、场景适配证明、价值/信任证明、转化收束证明。字幕、贴纸、箭头、特写、对比框、多实例展示只能作为 `replaceableFormClasses` 或差异说明。

## Binding 治理

binding 是组合约束，回答“哪些层必须同步、承接、要求、替换或冲突”。

按关系治理：

- `sync`：同一注意力拍点或同一证明时刻必须同步。
- `require`：某类主张必须有某类证明。
- `carryover`：跨槽必须回扣同一关切、对象、场景或承诺。
- `substitute`：允许替换什么，必须保留什么功能。
- `conflict`：哪些组合会破坏理解或证明。

不要按 `rule` 文本相似归并。文本只是阅读线索，真正判断看约束关系和风险。

未能归并为 binding pattern 的原始 binding 必须进入 `unmappedBindingVariants`。`support` 型 binding 不要并入 `require`，若有同类辅助证据关系，可以单独形成 support pattern proposal。

## Rule 治理

rule 是重组政策，不是单条视频经验句。

一个 rule pattern 必须能写成：

```text
condition -> requirement -> violation -> fix
```

比较：

- condition 是否同类。
- requirement 是否同类。
- violation 是否同类。
- fix 是否同类。
- 适用的 slot family / archetype / subtype 是否一致。

不要按 `reason` 或 `fix` 文案接近归并。相近文案可能处理不同政策；不同文案也可能是同一政策的不同表达。

未能归并为 rule pattern 的局部规则必须进入 `unmappedRuleVariants`，不要把单样例局部经验直接升格为全局重组政策。

## Review 输出

遇到不确定项，放入 `reviewItems`，并写明：

- 候选项。
- 支持证据。
- 冲突证据。
- 需要人工确认的问题。
- 暂不归并的原因。
