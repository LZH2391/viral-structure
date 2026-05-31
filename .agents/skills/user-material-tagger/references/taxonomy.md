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

证明能力类型：

- `problem_visibility`：能否让观众看见问题对象或需求场景。
- `product_identity`：能否让观众识别商品/服务/界面是什么。
- `process_demonstration`：能否证明使用过程或操作步骤。
- `mechanism_support`：能否支撑机制、原理、因果解释。
- `result_evidence`：能否支撑结果、完成态、收益或状态改善。
- `comparison_evidence`：能否支撑对比判断。
- `trust_evidence`：能否支撑信任、长期性、第三方、记录或资质。
- `conversion_support`：能否支撑结尾行动、购买/咨询/下一步。

`shot.capabilityRefs[][1]` 只能是：

- `strong`
- `medium`
- `weak`
- `none`
- `unknown`

`capabilities.*.supportLevel` 只能是：

- `strong`
- `partial`
- `weak`
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
