# 分类、标签与枚举

## shotClass

`shotClass` 表示镜头的主要素材形态，只选一个主类：

- `product_display`：商品、包装、界面或服务对象被明确展示。
- `usage_process`：出现使用、操作、演示、步骤或动作过程。
- `problem_scene`：出现问题对象、痛点状态、旧方案失败或需求场景。
- `result_or_state`：出现结果、状态变化、完成态或可被当作结果的画面。
- `comparison`：出现前后、左右、新旧、好坏、方案对照。
- `trust_evidence`：出现评价、记录、资质、票据、日志、第三方证据、长期使用痕迹。
- `human_presence`：人物出镜但核心不是具体操作或证明。
- `scene_context`：场景环境、生活/工作背景、使用语境。
- `transition_or_filler`：转场、空镜、重复、无关铺垫、信息价值低。
- `unusable`：模糊、遮挡、严重抖动、主体不清、内容不可判断。

## shotFunctions

`shotFunctions` 可多选，描述镜头能服务的表达功能：

- `attention_entry`
- `context_setup`
- `problem_visibility`
- `product_visibility`
- `operation_demonstration`
- `process_continuity`
- `result_visibility`
- `comparison_support`
- `trust_support`
- `mechanism_support`
- `emotion_or_reaction`
- `conversion_support`
- `visual_bridge`

不要写成具体槽位名，例如不要写 `problem_activation_slot`。

## proofNeedClass

`proofNeedClass` 是稳定的粗粒度素材能力枚举，用于让下游把素材供给映射到结构库 atoms 的 proof need。它不是完整语义分类，细分能力、边界和禁止误用必须写进 `reason / safeUsageRefs / gapAdviceRefs / limitRefs / constraintRefs`。

证明/支撑能力类型：

- `problem_visibility`：能否让观众看见问题对象或需求场景。
- `product_identity`：能否让观众识别商品/服务/界面是什么。
- `process_demonstration`：能否证明使用过程或操作步骤。
- `mechanism_support`：能否支撑机制、原理、因果解释。
- `result_evidence`：能否支撑结果、完成态、收益或状态改善。
- `comparison_evidence`：能否支撑对比判断。
- `trust_evidence`：能否支撑信任、长期性、第三方、记录或资质。
- `conversion_support`：能否支撑结尾行动、购买/咨询/下一步。注意它包含行动触发能力，不等于价格、优惠、库存或购买入口事实已经被证明。

### conversion_support 细分边界

`conversion_support` 必须在理由或限制中区分两类语义：

- **转化钩子 / 行动触发**：例如价格悬念、点击查看、进店看看、备货提醒、数量感、购买对象记忆。只要字幕或画面能触发下一步行动，可以标为 `conversion_support`，但理由要说明它支撑的是 CTA / 悬念 / 备货语境。
- **转化事实证明**：例如低价、活动价、马上涨价、库存不足、优惠规则、购买入口、历史价格对比。只有画面或输入材料出现可核查证据时，才能写成价格/优惠/库存/入口证明；否则必须在 `limitRefs / constraintRefs / gapAdviceRefs` 中说明“不能证明价格/优惠/库存事实”。

不要因为缺少价格页、活动规则或购买入口，就把价格悬念型 CTA 判为不可用；也不要因为字幕提到“这个价/活动价”，就把它升级成价格优势证明。

`shotCards[].proofAffordances[].strength` 只能是：

- `strong`
- `medium`
- `weak`
- `none`
- `unknown`

`proofCoverage[].coverage` 只能是：

- `strong`
- `partial`
- `weak`
- `missing`
- `unknown`

## 序列推荐规则

推荐依据不是“高光”或“精彩”，而是结构位置适配：

- 开头候选：能快速建立对象、问题、场景、冲突、欲望或强识别点。
- 中段候选：能承载过程、解释、产品信息、证明、连续动作或方案展开。
- 结尾候选：能承载结果、信任、选择收束、行动引导、品牌/商品记忆点。

`fit` 只能是：

- `strong`
- `medium`
- `weak`

顶层 `sequenceRecommendations` 只收录 `strong` / `medium` 候选。`weak` 不进入开头/中段/结尾候选池，只在对应 shot 的 `sequenceFit` 中说明原因和所需支持。

不要输出“高光片段”“精彩片段”“爆点片段”这类剪辑概念。若某个镜头视觉吸引力强，只能作为 `attention_entry` 或推荐理由的一部分说明。

## groups

常见 `groupType`：

- `opening_context_group`
- `problem_scene_group`
- `product_display_group`
- `usage_process_group`
- `result_or_state_group`
- `comparison_group`
- `trust_evidence_group`
- `conversion_support_group`
- `bridge_group`

`continuity` 只能是：

- `strong`
- `medium`
- `weak`
- `none`

## quality

质量字段取值：

- `visualClarity`
- `stability`
- `subjectFocus`
- `captionUsefulness`
- `audioUsefulness`

取值只能是：

- `high`
- `medium`
- `low`
- `none`
- `unknown`
