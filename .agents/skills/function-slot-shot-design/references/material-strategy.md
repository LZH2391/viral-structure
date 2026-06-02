# Material Strategy

## 核心原则

素材评分只回答“这个 slot 用当前素材落地是否靠谱”，不决定 slot 是否存在，也不决定槽位链是否删除。

如果当前 thread 中存在 `user-material-pack.stable`、素材包路径或用户明确提供的素材候选说明，ShotDesign 必须消费素材包做逐 shot / 逐 slot 的最终落地策略选择。

素材包使用 compact ref schema 时，先用 `semanticDictionaries.entityDict / supportDict / guardrailDict` 展开引用，再评分和路由。需要展开的字段包括 `detectedEntityRefs`、`proofAffordances[].limitRefs`、`sequenceFit.openingCandidate.requiredSupportRefs`、`sequenceFit.middleCandidate.requiredSupportRefs`、`sequenceFit.endingCandidate.requiredSupportRefs`、`constraintRefs`、`safeUsageRefs`、`gapAdviceRefs`、`globalConstraintRefs`、`doNotUseForRefs`、`needsRestructureAttentionRefs`。不要把 ref id 当语义标签，也不要要求素材包回退输出旧展开字段。

少素材时不要把镜头数硬压缩到素材数量。第一版 Shot 设计应尽量落在上游 `timingBudget` 的建议区间内；如果素材与自行设计都无法支撑合理镜头密度，优先声明 `return_to_restructure_required`。

## 策略优先级

策略优先级固定为：

1. `existing_material`：未占用现有素材能直接承载。
2. `existing_material_packaging_caption`：现有素材基本成立，但需要包装/字幕补清。
3. `self_designed_by_shot_design`：现有素材缺关键画面、场景、动作、非证明性承接、商品记忆或 CTA，需要本 skill 自行设计新镜头。
4. `return_to_restructure_required`：不是少几个镜头，而是槽位链整体不适合当前素材、合理包装字幕和自行设计，需要按 `function-slot-restructure/references/shot-design-return-to-restructure.md` 交回重组。
5. `reuse_transformed_fallback`：复用已有镜头兜底，最低优先级。

## 评分维度

对每个 slot，先从未占用的 `shotCards/materialGroups` 中找候选，再做策略评分。评分不是为了追求最高素材分，而是为了选择最合适的落地策略。

| 维度 | 分值 | 判断问题 |
|---|---:|---|
| `slotFitScore` | 0-25 | shot/group 是否适合当前 slot 的表达目标、位置和观众动作 |
| `proofValidityScore` | 0-25 | 能否真实支撑该 slot 的证明任务，是否会把弱证据说成强证明 |
| `visualActionScore` | 0-20 | 画面主体、动作、结果是否完整可读，时长是否够剪出有效镜头 |
| `packagingRecoverScore` | 0-15 | 是否能靠字幕、标签、圈选、标题条安全补清楚 |
| `selfDesignNeedScore` | 0-15 | 是否缺关键画面/场景/动作/承接/商品记忆/CTA，更适合自行设计镜头 |
| `reusePenalty` | 0 至 -30 | 该 shot 是否已被占用，重复使用是否伤害成片；已主承载的 shot 再用必须重扣 |

## 策略路由

先计算两个内部判断值：

```text
materialSupportScore = slotFitScore + proofValidityScore + visualActionScore + packagingRecoverScore + reusePenalty
selfDesignPressure = selfDesignNeedScore
```

评分只用于当前 slot / shot 候选，不跨 slot 平均。`reusePenalty` 必须在候选素材已经被其他 shot 主承载时计入；同一素材只是被列为候选但未占用，不扣复用分。

| 条件 | 策略 |
|---|---|
| 未占用现有素材高度匹配，证明成立，动作/画面完整；`slotFitScore >= 20`、`proofValidityScore >= 20`、`visualActionScore >= 15`、`materialSupportScore >= 65`、`selfDesignPressure <= 6` | `existing_material` |
| 现有素材主体或动作成立，但表达不够清楚，且包装/字幕可以安全补足；`slotFitScore >= 16`、`proofValidityScore >= 16`、`visualActionScore >= 10`、`packagingRecoverScore >= 8`、`materialSupportScore >= 50` | `existing_material_packaging_caption` |
| 现有素材缺关键画面、关键动作、非证明性承接、商品记忆或 CTA，且自行设计不会伪造证明；`selfDesignPressure >= 9`，或 `materialSupportScore < 50` 且缺失点属于可合理自设计内容 | `self_designed_by_shot_design` |
| 多个关键 slot 的 `proofValidityScore < 12`，且既不能靠包装字幕补清，也不能靠合理自行设计补齐，说明槽位链整体不适合当前素材 | `return_to_restructure_required` |
| 已占用素材再次使用后仍比其他方案更可执行，且前四类都不成立；`reusePenalty < 0` 时只能作为最低优先级兜底 | `reuse_transformed_fallback` |

路由顺序必须按表格自上而下判断。不要因为 `materialSupportScore` 总分高就跳过证明边界；`proofValidityScore < 12` 时禁止走 `existing_material` 或 `existing_material_packaging_caption`。`reuse_transformed_fallback` 只能在没有更好的未占用现有素材、包装字幕方案、自行设计方案时选择。

## 素材镜头字段边界

`existing_material` 是完全使用素材镜头：画面、已有包装、台词/字幕都以原素材为准。ShotDesign 不再自行设计分镜画面，不新增包装说明，不重写台词/字幕；原素材没有台词/字幕时写“无”，并在最终摘要中提示用户这些镜头无原素材台词，询问是否需要补写。

`existing_material_packaging_caption` 是“素材画面 + 后期包装/字幕补强”：画面仍锁定为原素材镜头，只能写原素材代表帧、主体动作、结果状态或素材包摘要；不得写给生图模型使用的自设计画面提示词。允许新增包装/字幕，但必须写清楚补强的是哪一层后期信息、如何安全补清证明或理解，不能把弱素材包装成强证明，不能伪造素材里不存在的动作、结果、对比、评价或资质。若原素材无口播/字幕，只有用户已明确授权补写时才允许新增后期字幕、屏幕文字或旁白；新增内容必须标为后期层或旁白，不得伪装成原素材人物口播。

## 复用硬约束

同一 `shotRef` 可以成为多个 slot 候选，但默认只能有一个主承载。已占用素材再次使用时必须加高复用惩罚，只有没有更好的现有素材、包装字幕或自行设计方案时才允许复用。

`reuse_transformed_fallback` 永远最低优先级。使用时必须写明变形方式，例如裁切、放大、冻结帧、局部特写、变速、错位重入、反向节奏；禁止原样复用。

## 自行设计边界

自行设计可以补非真实证明性的场景、动作、氛围、承接、商品记忆和 CTA 镜头。

自行设计不得伪造结果、对比、资质、评价、检测或强信任证明。包装和字幕也不能把弱素材写成强证明。

如果选择 `return_to_restructure_required`，按 `function-slot-restructure/references/shot-design-return-to-restructure.md` 交回重组。不要在 `shot-design.final.md` 中偷偷改槽位链，也不要硬写一版低质量 Shot 表。
