# 重组工作流

使用多视频槽位库创建新短视频方案时，采用本工作流。核心思想是：**不要先选择预设策略**。重组是一个受约束的组装问题。

Template 可以证明某条链路曾在一个样例中成立，但它不是新链路的生成器。

正式重组默认同时读取：

```text
Runtime/Temp/FunctionSlotLibrary/slot_index.json
Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json
```

`slot_index.json` 是证据层，保存真实 variant。`semantic-governance.v1.json` 是治理层，保存经审查的 family / archetype / subtype / pattern / policy。重组时优先用治理层做选择和约束，再回到证据层拿具体来源和可替换实现。

## 步骤 1：把目标 brief 标准化为约束

检索槽位前，先抽取目标约束。

需要推断的字段；只有缺失会阻塞时才向用户追问：

- **viewer start state / 观众起始状态**：视频开始前，观众相信什么或感受如何
- **viewer end state / 观众结束状态**：视频结束后，观众应该相信、感受或执行什么
- **problem object / 问题对象**：需要激活的具体对象、场景、症状或摩擦
- **solution action / 解决动作**：产品、方法或人物可见地做了什么
- **desired result / 目标结果**：证明动作有效的回报
- **choice object / 选择对象**：观众最后应该记住或选择什么
- **available proof assets / 可用证明资产**：演示、屏幕录制、前后对比、数字、日志、证言、长期记录、物体痕迹、评论、收据等
- **objections / 异议**：观众为什么可能怀疑、拖延或误解
- **duration and platform constraints / 时长和平台约束**：时间预算、信息密度、创作者风格、CTA 强度要求
- **production constraints / 生产约束**：什么能拍、能展示、能叠加、能主张

把这些输出为 `brief_constraints` 对象。此时还不要选择链路。

## 步骤 2：构建槽位需求图，而不是选择策略

这是最重要的一步。

步骤 2 的输出是 **slot demand graph / 槽位需求图**：一组所需观众状态跃迁，以及它们之间的约束。它不是在 `result-first`、`trust-first`、`compressed` 或任何其他预设之间做选择。

### 2.1 创建主张和证明清单

列出新视频必须提出的每个主张。为每个主张判断可支持它的证明功能。

```text
problem claim      -> problem visibility / concern evidence
action claim       -> visible action path / interface action / behavior proof
mechanism claim    -> reason, process, comparison, cutaway, or explanatory proof
operation claim    -> step cue + completion proof
result claim       -> output, before/after, close-up, number change, or status change
benefit claim      -> life/work scenario translation
trust claim        -> time evidence, usage trace, review, repeated feedback, log, receipt, testimonial
choice claim       -> concrete product/service/action memory point
```

只有当某个主张是目标观众状态路径所必需时，它才变成潜在槽位需求。不要因为源样例里有某个槽位，就把它放进新方案。

### 2.2 把主张转成需求节点

每个需求节点应包含：

```json
{
  "demandId": "D01",
  "targetViewerStateBefore": "viewer state before this transition",
  "targetViewerStateAfter": "viewer state after this transition",
  "slotRole": "abstract role, e.g. problem_activation or result_confirmation",
  "claimType": "problem_to_action | mechanism_explain | operation_simplification | result_to_benefit | trust_to_choice | ...",
  "proofFunction": "what kind of proof must appear",
  "informationLoad": "low | medium | high",
  "rhythmNeed": "hook | steady_explain | pause_action | payoff_peak | proof_close | ...",
  "packagingNeed": "object_visibility | mechanism_visualization | step_prompt | result_proof | trust_trace | choice_memory | ...",
  "requiredCarryovers": ["object", "claim", "proof", "choice"],
  "optionality": "required | optional | conditional",
  "priority": 1
}
```

示例：

- 如果目标有可见使用动作和结果，创建 operation/result 需求对，并标记它们在因果上需要靠近。
- 如果目标有新颖或不明显的机制，创建 mechanism 需求，并要求理解时间或强视觉锚点。
- 如果目标有强证明但可见动作弱，创建 trust/proof 需求，并根据观众状态把它用作 hook fragment 或 close。
- 如果时长很短，保留同样的需求节点，但把相邻节点标记为可合并；不要简单切换到套装式压缩链路。

### 2.3 添加图边

在需求节点之间添加约束边：

```json
{
  "from": "D01",
  "to": "D04",
  "edgeType": "carryover | causal_precede | proof_payoff | rhythm_continuity | requires_bridge | conflict | alternative | mergeable | hookable",
  "constraint": "result proof must return to the problem object activated in D01",
  "hardness": "hard | soft"
}
```

需要考虑的核心边：

- `carryover`：开头对象/关切必须被结果或证明兑现。
- `causal_precede`：除非结果被有意用作 hook 并在后面解释，否则操作必须出现在结果之前。
- `proof_payoff`：一个主张必须有证明槽位或证明包装。
- `rhythm_continuity`：如果结果归因很重要，停顿/动作节点应流向兑现节点。
- `requires_bridge`：把槽位移离常见邻居时需要 adapter。
- `conflict`：高信息量机制不能放进快速 hook，除非有视觉锚点。
- `alternative`：两个需求节点解决同一个说服问题；选择一个或合并。
- `mergeable`：如果证明功能仍保留，相邻节点可合并。
- `hookable`：证明/结果/信任片段可以移到开头。

### 2.4 步骤 2 的输出

步骤 2 必须在候选检索前输出类似内容：

```json
{
  "brief_constraints": {...},
  "slot_demand_graph": {
    "nodes": [...],
    "edges": [...],
    "mustSatisfy": ["problem result carryover", "proof for every major claim"],
    "softPreferences": ["source diversity", "low production complexity"]
  }
}
```

这个图才是真正的重组目标。这里不应出现预设链路名称。

## 步骤 3：读取治理层并校准证据层

在生成链路假设前，读取 `semantic-governance.v1.json`：

- 检查 `schemaVersion / reviewStatus / maturityStatus`。
- 对比 `sourceSnapshot` 与当前 index 中 artifact 的 `contentHash`。
- 将 `slotSubtypes.sourceVariantIds` 映射回 `slotVariants`。
- 将 `atomPatterns / bindingPatterns / rulePatterns` 映射回 atom、binding、rule variants。
- 读取 `bindingPrinciples / recompositionPolicies` 作为组合安全约束。
- 读取 `implementationBundles / observedChainPatterns` 作为检索先验，不作为固定模板。
- 读取 `needReviewMap / reviewItems / unmapped*Variants` 作为风险降级依据。

如果治理层缺失、过期或只有 candidate 结论，可以继续草拟方案，但必须降低置信度并明确说明哪些判断只是证据层推断。

## 步骤 4：用图操作符生成链路假设

通过对需求图应用操作符生成多个链路假设。这一步才是重组发生的地方。

不要问：“我该选择哪个策略？”

要问：

1. 在最强可用 hook 资产下，哪个需求节点应该打开视频？
2. 哪些节点为了因果或证明归因必须保持相邻？
3. 哪些节点可以合并而不丢失证明功能？
4. 哪些节点可以被切片并作为 hook 或 close 复用？
5. 哪些节点移离源上下文后需要 adapter？

### 链路生成操作符

使用这些操作符，可单独或组合使用：

- `anchor`：根据最强 hook 资产选择开场需求节点，而不是选择预设。
- `move`：在用 adapter 保留硬边的前提下重排节点。
- `insert`：添加目标需要但源 template 缺失的需求。
- `delete`：只有当该主张不必要或已在其他地方被证明时才删除需求。
- `split`：把过载节点拆成两个更轻的节点。
- `merge`：在证明功能仍可见时合并相邻节点。
- `duplicate`：用不同证明角度重复一个槽位角色，例如快速结果 hook 和后续详细结果证明。
- `fragment`：把槽位的一部分用作 hook、bridge 或 closing memory point。
- `invert`：先展示 payoff，再解释来源/原因。
- `contrast`：添加旧方式/新方式或前后对比节点。
- `ladder`：从弱到强堆叠证明，例如 demo -> result -> long-term trace。
- `bridge`：在错配的来源候选之间创建 adapter 节点。

治理层补充操作：

- `governance_prior`：参考 `implementationBundles` 或 `observedChainPatterns`，但只作为候选排序线索。
- `subtype_expand`：从目标需求节点展开到可用 `slotSubtype`。
- `policy_filter`：用 `recompositionPolicies` 去掉明显破坏证明或承接的链路。

### 链路假设格式

```json
{
  "chainId": "H01",
  "sequence": ["D04", "D01", "D03", "D04_detail", "D05"],
  "operatorsUsed": ["fragment", "invert", "duplicate"],
  "reason": "strong result proof is the best hook, but detailed result proof must still return after operation",
  "hardEdgesSatisfied": ["D01 -> D04 carryover", "D03 -> D04 causal payoff"],
  "requiredAdapters": ["object adapter from result hook back to problem object"],
  "risks": ["if result hook is too disconnected, add rewind bridge"]
}
```

当目标是开放式任务时，生成 2-5 个链路假设。如果 corpus/证明资产支持，至少保留一条保守链路和一条非显而易见链路。

## 步骤 5：针对需求节点检索候选，而不只是按槽位名检索

对每个需求节点，按以下维度检索候选：

- slot subtype / archetype 是否匹配观众状态跃迁和证明义务
- slot role 或兼容 slot type
- 观众状态跃迁匹配
- claim type 和 proof need
- atom pattern 的 claim/proof/rhythm/packaging 功能
- rhythm need 和 information load
- packaging proof function
- binding principle / recomposition policy
- 必要 sync/carryover 约束
- 来源可靠性和置信度

标签正确但证明功能错误的候选，应输给标签较弱但功能更匹配的候选。

如果没有库候选能满足必需需求，创建 generated gap-fill implementation 并降低置信度。

## 步骤 6：全局选择，而不是逐槽位选择

不要独立选择每个槽位的 top candidate。要选择作为链路整体成立的组合。

按以下维度给完整方案评分：

- **state coverage / 状态覆盖**：每个重要观众状态跃迁都被覆盖
- **proof satisfaction / 证明满足**：每个主要主张都有可行证明功能
- **carryover integrity / 承接完整性**：开头对象/关切连接到结果、信任或选择
- **causal clarity / 因果清晰度**：动作、机制和结果不会显得断裂
- **rhythm coherence / 节奏一致性**：视频有明确注意力曲线
- **packaging feasibility / 包装可行性**：视觉证明确实能生产
- **binding compatibility / 绑定兼容性**：sync、require、carryover、substitute 和 conflict rules 通过
- **governance compatibility / 治理兼容性**：subtype、atom pattern、binding principle、policy 没有冲突
- **source diversity / 来源多样性**：方案不是单一源样例，除非刻意做忠实变体
- **novelty with control / 可控新颖性**：方案有足够差异，但仍可解释

候选很多时，用 beam-search 思路：

1. 保留前几个链路假设。
2. 对每个需求节点保留前几个候选。
3. 只组合满足硬边的候选。
4. 选择全局评分最好，而不是局部候选分最高的方案。

## 步骤 7：组合槽位实现

对每个选中的需求节点，判断实现来源：

- 使用完整 slot candidate
- 保留槽位功能但替换 script atom
- 保留 script 但替换 rhythm
- 保留 script/rhythm 但替换 packaging
- 使用另一个槽位的 proof fragment
- 根据 demand definition 生成缺失实现

始终解释保留了什么：

```text
preserved function: result proof returns to activated problem object
changed surface: skincare close-up -> dashboard before/after screen
```

实现组合要同时记录：

- 最终链路使用的 `slotSubtypeId`，链路层不用继续下钻到 source slot variant
- 父级解释和审计用的 `slotArchetypeId`
- 使用的 script / rhythm / packaging `atomPatternId`
- 具体落地的 script / rhythm / packaging concrete atom variant
- source slot variant 只作为追踪来源，不作为最终功能槽位链粒度
- 治理状态：`reviewStatus / maturityStatus`
- 未命中治理层时的 fallback 原因

## 步骤 8：为跨来源或跨品类缺口创建 adapters

Adapters 不是装饰，而是让混合来源重组保持连贯的桥。

以下情况使用 adapters：

- 问题对象和结果对象不同
- 主张借自一个品类，但证明资产来自另一个品类
- 来源候选之间节奏突变
- 包装样式变化，但证明功能必须保留
- 槽位被移到通常解释它的节点之前

Adapter 类型：

- `object_adapter`
- `claim_adapter`
- `proof_adapter`
- `rhythm_adapter`
- `packaging_adapter`
- `time_adapter`
- `causal_adapter`

## 步骤 9：设计视频级节奏曲线

只有在需求图和链路假设稳定后，才设计节奏曲线。

跨槽位表达节奏：

```text
hook spike -> quick clarification -> steady proof -> pause/action -> payoff peak -> trust decay/close
```

节奏可以跨越槽位边界。明确表示：

```text
low_barrier_operation + result_confirmation = pause -> action -> payoff
```

检查信息负载：高密度机制、多步骤操作和信任证明通常需要比问题可见性或结果闪现更多时间。

## 步骤 10：按证明功能设计包装

为每个主张按功能而不是样式分配证明包装。

```text
problem claim -> object/concern visibility
action claim -> direct action path
mechanism claim -> explanation proof
operation claim -> step/completion proof
result claim -> before/after, output, or close-up proof
benefit claim -> scenario translation
trust claim -> time, repetition, social proof, usage trace
choice close -> concrete memory point
```

表层样式可以改变。证明功能不能消失。

## 步骤 11：产出实用方案和审计

输出可用方案，而不是抽象理论：

- brief 约束
- 槽位需求图
- 生成的链路假设和选中链路
- 选中的槽位候选和来源样例
- 选中的 subtype / archetype / atom pattern / bundle prior
- 逐槽位 script/rhythm/packaging 实现
- adapters
- 分段文案
- 镜头或屏幕录制动作
- 覆盖层和证明包装
- 节奏时间
- 所需证明材料
- binding checks
- governance checks：principle / policy / needReview / reviewItems
- 替代版本

## 步骤 12：标记置信度

置信度应反映 corpus 支持度和目标匹配度。

高置信度：

- 需求图清楚
- 选中链路满足硬边
- 证明资产存在
- 选中候选具有兼容 atoms 和 bindings
- 关键模式由 reviewed 治理项、多个样例或强逻辑支持

中置信度：

- 链路连贯但品类不同
- 证明资产不完整
- 需要一两个生成式实现或 adapters
- 关键治理项仍是 candidate，但边界和风险已说明

低置信度：

- 主要由稀疏库数据生成
- 缺少证明资产
- 仍存在主要 binding 或 carryover 风险
- 最终链路依赖未验证的操作符组合
- 治理层缺失、过期，或命中大量 `needReview / unmapped` 项
