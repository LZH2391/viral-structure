# 多版本生成策略

本文件只在 brief 明确要求多版本、多方案，或点名高点击版、高转化版、高节奏版、高质感版等版本目标时使用。默认单版本重组不要启用本流程。

多版本生成是同一 brief、同一产品事实和同一证据约束下的正式结构分化，不等同于第 10 节“必要替代实现”。它必须产生多个可独立成立的结构方案，而不是把同一链路换文案、换标题或换形容词。

## 触发条件

满足任一条件时启用多版本模式：

- 用户明确说“多版本”“多方案”“同时生成几个版本”。
- 用户指定版本目标，例如高点击版、高转化版、高节奏版、高质感版。
- 前端 brief 或配置中存在 `versionProfiles`、`versionGoals`、`multiVersion` 等等价字段。

不满足以上条件时，不要主动扩展成多版本。

## 共同不变量

所有版本必须共享以下不变量：

- 产品事实、受众、转化目标、平台限制和安全边界一致。
- 证明义务不能被删除；只能调整证明前置、后置、压缩、强化或分层方式。
- 若使用 `user-material-pack.stable`，素材供给类型判断对所有版本共用。
- 素材充足时，各版本可以选择不同推荐素材路径，但必须说明为什么适合该版本目标。
- binding principle、rule policy、adapter 判断和 concrete atom 追溯要求对每个版本都生效。
- 高点击、高节奏等激进版本不得提前承诺缺少证明支撑的主张，不得为了强 hook 破坏因果、承接或证明归因。

## Version Profile 字段

启用多版本时，先生成 `versionProfiles`，再为每个版本分别规划槽位链和落地方案。

每个 `versionProfile` 必须包含：

- `versionId`：稳定短 id，例如 `V1_click`。
- `versionName`：用户可读名称，例如“高点击版”。
- `optimizationGoal`：该版本优先优化什么观众行为或状态变化。
- `sharedInvariants`：与其他版本共同保持的事实、证明义务和素材边界。
- `chainDelta`：相对基础链路的槽位顺序、增删、拆分、合并、前置或重复差异；不能只写“语气更强”。
- `hookStrategy`：开场节点选择、hook 类型、是否结果前置/反差前置/问题直冲，以及必须回接的对象或关切。
- `proofStrategy`：证明链强弱、证明出现顺序、主张和证据的依赖关系。
- `rhythmStrategy`：结构级节奏预算倾向，例如信息密度、峰值位置、停顿/回落方式；仍不得写逐 shot 时间轴。
- `packagingStrategy`：字幕、图卡、商品/品牌露出层级、证明包装的差异策略。
- `riskTradeoff`：该版本为优化目标付出的风险、适用场景和不适用场景。

## 常见版本目标

- **高点击版**：优先 hook 强度、反差、结果前置、悬念缺口或强痛点直冲；必须用 adapter 回到原始关切，避免开头和后续证明断裂。
- **高转化版**：优先证明链完整、风险消除、使用场景、信任背书和 CTA 承接；允许节奏更稳，但不能弱化关键利益点。
- **高节奏版**：优先短链路、高信息密度、动作推进和少解释；只能压缩表达，不能删掉必要证明义务。
- **高质感版**：优先品牌/商品露出层级、视觉秩序、低噪字幕、克制包装和信任感；不能为了质感把证明功能变成纯装饰。

用户自定义版本目标时，按其目标生成新的 `versionProfile`，但仍必须满足共同不变量和结构差异要求。

## 结构差异要求

多版本输出必须让版本差异落到结构层，至少命中以下一种真实差异：

- 槽位链顺序差异。
- hook 节点选择差异。
- 槽位拆分、合并、前置、重复或删除差异。
- proof obligation 的强弱、层级或出现顺序差异。
- rhythm timingBudget、信息密度、峰值、停顿或回落差异。
- packaging、字幕、商品/品牌露出层级差异。
- CTA 或收口方式差异。

禁止只改文案措辞、标题风格、语气形容词或包装名称就声称是不同版本。

## 链路假设要求

多版本模式下，先按版本目标生成 `versionProfiles`，再在每个版本目标下生成链路假设。

链路假设可以沿用普通重组操作符，例如 `anchor / move / insert / delete / split / merge / duplicate / fragment / invert / contrast / ladder / bridge`，但必须写清：

- 该版本用了哪些操作符。
- 这些操作符如何服务版本目标。
- 哪些共同不变量被保留。
- 哪些 adapter 是该版本必须新增的。
- 该版本的风险和不适用场景。

链路假设格式：

```json
{
  "chainId": "H01",
  "versionId": "V1_click",
  "sequence": ["D04", "D01", "D03", "D04_detail", "D05"],
  "operatorsUsed": ["fragment", "invert", "duplicate"],
  "reason": "strong result proof is the best hook, but detailed result proof must still return after operation",
  "hardEdgesSatisfied": ["D01 -> D04 carryover", "D03 -> D04 causal payoff"],
  "requiredAdapters": ["object adapter from result hook back to problem object"],
  "risks": ["if result hook is too disconnected, add rewind bridge"]
}
```

## 输出路径

启用多版本模式时，默认使用分文件输出，避免把多个完整方案塞进同一个 `restructure.final.md`，也便于后续 `function-slot-shot-design`、展示转换和 storyboard 只读取被选中的单个版本。

目录结构：

```text
Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/
  restructure.final.md
  versions/
    V1_click/restructure.final.md
    V2_conversion/restructure.final.md
    V3_rhythm/restructure.final.md
    V4_quality/restructure.final.md
```

根目录 `restructure.final.md` 是多版本 manifest / index，只写共同信息、版本策略、版本差异总览和每个版本文件链接，不承载完整第 2-10 节。每个版本目录下的 `restructure.final.md` 是可独立进入 ShotDesign 的完整结构方案，必须保持普通重组的第 1-10 节格式。

只有在用户明确要求“所有版本放一个文件”时，才允许单文件多版本输出；即便如此，也必须披露下游解析和 ShotDesign 选择成本。

## 根文件格式

根目录 `restructure.final.md` 使用以下格式：

```markdown
# 多版本重组方案索引

## 1. 重组目标与假设
[共享 brief、素材供给判断、结构库输入摘要]

## 2. 多版本生成策略

共同不变量：
- 产品事实：
- 受众与转化目标：
- 证明义务：
- 素材供给边界：
- binding/rule 硬约束：

| versionId | versionName | optimizationGoal | chainDelta | hookStrategy | proofStrategy | rhythmStrategy | packagingStrategy | riskTradeoff |
|---|---|---|---|---|---|---|---|---|
| `V1_click` | 高点击版 | | | | | | | |

## 3. 版本文件

| versionId | versionName | 文件 | 适用场景 | 不适用场景 |
|---|---|---|---|---|
| `V1_click` | 高点击版 | `versions/V1_click/restructure.final.md` | | |

## 4. 选择建议
[一句话说明优先推荐哪个版本，以及为什么]
```

## 版本文件格式

每个版本文件必须保存到：

```text
Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/versions/<versionId>/restructure.final.md
```

要求：

- 每个版本文件都必须完整输出普通重组第 1-10 节，不得依赖根文件中的“同上”才能成立。
- 第 1 节需要写清该版本的 `versionId / versionName / optimizationGoal / sharedInvariants / versionStrategy`，并链接根目录 `restructure.final.md`。
- 如果某个版本和其他版本共用同一 concrete atom，仍要在该版本的第 3 节写明复用来源和本方案落地。
- 第 8 节必须校验该版本自己的 binding principle / rule policy；高点击、高节奏等激进版本也不能跳过证明和承接校验。
- 第 10 节“必要替代实现”仍只用于该版本存在未满足项时的兜底，不替代多版本方案本身。

## 后续 ShotDesign 规则

多版本重组进入 `function-slot-shot-design` 时，默认对根目录 manifest 中列出的所有 `versionProfiles` / 版本文件逐一生成 Shot 设计，不固定为 4 个版本；版本数量以本轮重组实际输出为准。每个版本的 Shot 设计必须写入对应版本目录：

```text
Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/versions/<versionId>/shot-design.final.md
```

要求：

- 根目录 manifest 不直接进入单版 ShotDesign；ShotDesign 应遍历 manifest 中的版本文件，逐一读取 `versions/<versionId>/restructure.final.md`。
- 每个版本的 `shot-design.final.md` 只服务该版本结构，不得把多个版本混在同一个 Shot 表里。
- 只有用户明确指定某个 `versionId` 或明确要求只做单版时，才只生成该版本的 Shot 设计。
- 若某个版本结构无法落地，只对该版本声明 `return_to_restructure_required` 或说明阻塞，不影响其他版本继续生成。
