# Material Strategy

## 核心原则

素材评分只回答“这个 slot 用当前素材落地是否靠谱”，不决定 slot 是否存在，也不决定槽位链是否删除。素材评分只用于缺素材路径；当上游已经给出素材充足推荐路径时，不进入逐 slot 重新评分选材。

如果当前 thread 中存在 `user-material-pack.stable`、素材包路径或用户明确提供的素材候选说明，ShotDesign 必须消费素材包做逐 shot / 逐 slot 的最终落地策略选择。

素材包使用 compact ref schema 时，先用 `semanticDictionaries.entityDict / supportDict / guardrailDict` 展开引用，再评分和路由。需要展开的字段包括 `detectedEntityRefs`、`proofAffordances[].limitRefs`、`sequenceFit.openingCandidate.requiredSupportRefs`、`sequenceFit.middleCandidate.requiredSupportRefs`、`sequenceFit.endingCandidate.requiredSupportRefs`、`constraintRefs`、`safeUsageRefs`、`gapAdviceRefs`、`globalConstraintRefs`、`doNotUseForRefs`、`needsRestructureAttentionRefs`。不要把 ref id 当语义标签，也不要要求素材包回退输出旧展开字段。

少素材时不要把镜头数硬压缩到素材数量。第一版 Shot 设计应尽量落在上游 `timingBudget` 的建议区间内；如果素材、真实补证镜头和合理自行设计都无法支撑合理镜头密度，优先声明 `return_to_restructure_required`。

## 素材充足路径

当上游 `function-slot-restructure` 已判断为 `material_sufficient_specific_path` 或 `material_oversupply_selectable`，且第 2 节给出 `recommendedMaterialPath` / 推荐素材顺序时，ShotDesign 走素材充足路径。

素材充足路径的规则：

1. **推荐路径是主骨架**
   - 必须按上游推荐素材顺序逐项落 Shot 表。
   - 不得跳过推荐路径直接按 slot 重新评分选材。
   - 不得默认用大比例 `self_designed_by_shot_design` 替换推荐路径。
   - 允许把相邻推荐素材合并为 shot group，或把单个推荐素材拆成 fragment，但主顺序不得改变。

2. **策略默认从现有素材开始**
   - 推荐路径中的素材有原字幕/口播时，先判断原字幕/口播在新位置、新前后文和新节奏中是否仍然顺畅；没有明显衔接问题时，默认策略为 `existing_material`，画面、动作、字幕/口播沿用原素材。
   - 推荐路径中的素材需要后期标签、圈选或字幕补清理解，或原字幕/口播因位置时序调整出现明显衔接问题但画面事实仍可用时，可以用 `existing_material_packaging_caption`。
   - 原素材台词可用性判断只看成片衔接是否成立：指代是否清楚，因果/递进是否未断裂，情绪是否连贯，上下文依赖是否还存在，台词长度是否仍落在该 shot 预计时长范围内。
   - 若原字幕/口播有明显衔接问题，应在该 shot 预计时长范围内重写为后期字幕、屏幕文字或旁白，并标明来源；不得继续把该 shot 标为纯 `existing_material`。
   - 若推荐路径素材无原字幕/口播，只有用户在重组完成后明确授权补写，才允许补后期字幕/旁白；未授权时 `台词/字幕（若有）` 写“无”。

3. **只补封面，不补新主路径**
   - 素材充足路径仍必须追加封面生图提示词。
   - 封面不得新增上游没有的功效、价格、安全、评价或对比证明。
   - 不因封面需要而新增普通视频 shot。

4. **偏离推荐路径的条件**
   - 只有推荐素材存在明确 shot 级致命问题，例如画面无法识别、主体不可用、原素材证明会严重越界且无法通过后期处理避免，才允许寻找替代候选。
   - 偏离必须在聊天中先说明具体 `shotRef/groupId` 和致命原因。
   - 若偏离会让整条推荐路径失效，声明 `return_to_restructure_required`，不要在 ShotDesign 内私自重组。

5. **不要把素材包缺口重新升级成补证任务**
   - 上游已基于素材包降级、避开或排除的强主张，ShotDesign 不得重新补回。
   - `missingMaterialAreas / gapAdviceRefs / doNotUseForRefs / globalConstraintRefs` 在素材充足路径只用于防止 Shot 表越界，不用于新增真实补证镜头。

## Missing Material Areas 的真实补证优先级

本节只用于缺素材路径，或上游结构明确保留某个证明义务但推荐路径缺少少量可真实补拍证据时。

当 `user-material-pack.stable` 中存在 `missingMaterialAreas / gapAdviceRefs / globalConstraintRefs / doNotUseForRefs`，且上游没有将对应主张降级、避开或排除时，ShotDesign 不得默认避开对应主张。必须先判断该缺口是否可以通过真实补拍或真实证明素材设计补齐。

若上游重组方案已经基于素材包降级、避开或排除某类主张，ShotDesign 不得在本轮重新补回该主张，也不得为该主张新增自设计补证镜头。

处理顺序：

1. **真实补证镜头优先**
   - 如果缺口属于可拍、可收集、可展示的真实证据，优先设计 `self_designed_by_shot_design` 补证镜头。
   - 典型补证方向：
     - 成分温和 / 安全适用：补拍包装背面、成分表、说明书、适用范围、注意事项、备案信息、检测报告、品牌合规材料。
     - 价格 / 活动 / 购买入口：补拍商品详情页、活动页、订单页、价格页、规格数量、优惠规则。
     - 使用成本 / 开一整晚不心疼：补拍规格容量、使用时长说明、耗用说明、价格页或官方说明。
     - 驱蚊结果：补拍真实使用前后、蚊虫减少证据、用户反馈、合规功效依据或可验证实验过程。
     - 对比证明：补拍旧方案/新方案同场对比、不同插座适配对比、同类产品页面或实物对比。
   - 这些镜头必须写成“补拍/自设计真实证明镜头”，不能写成氛围镜头、口播承诺或纯包装字幕。

2. **包装字幕只补理解，不补事实**
   - 如果已有素材画面已经包含真实证据但不够清楚，可以用 `existing_material_packaging_caption` 加圈选、箭头、放大框、标题条说明。
   - 如果画面本身没有证据，不得用包装字幕创造证据。

3. **不能真实补证时才降级**
   - 如果缺口需要外部事实，但当前 brief、素材、可合理补拍范围都没有提供证据来源，才降级为避开强主张、改成弱主张，或声明 `return_to_restructure_required`。
   - “不能真实补证”指即使补拍也只能拍到氛围、摆拍或口播，拍不到证据本体。例如只拍干净卧室不能证明驱蚊结果，只拍儿童在房间不能证明适用人群安全，只拍多瓶陈列不能证明价格真实。

4. **补证镜头的写法要求**
   - `分镜画面` 必须写真实可见的证明载体，例如包装背面、说明书、详情页、检测报告、订单页、商品规格页、前后对照、真实评价或对比对象。
   - `动作与运镜` 必须写普通可拍动作，例如手持包装翻到背面、手指指向成分表、手机页面稳定停留、同场景前后对比稳定展示。
   - `包装说明` 可以圈选、放大、标注证据位置，但不能新增证据内容。
   - `台词/字幕` 只能解读画面中真实出现的证据，不得说画面没有的结论。

## 策略优先级

策略优先级固定为：

1. `existing_material`：未占用现有素材能直接承载。
2. `existing_material_packaging_caption`：未占用现有素材基本成立，但需要包装/字幕补清。
3. `self_designed_by_shot_design`：现有素材缺关键画面、场景、动作、非证明性承接、商品记忆或 CTA；或现有素材缺某个主张的证明，但该证明可通过真实补拍/真实证明素材设计补齐，例如成分表、说明书、检测报告、商品详情页、价格页、规格页、订单页、真实前后对照、用户反馈截图等。
4. `return_to_restructure_required`：不是少几个镜头，而是槽位链整体不适合当前素材、合理包装字幕和自行设计，需要按 `function-slot-restructure/references/shot-design-return-to-restructure.md` 交回重组。
5. `reuse_transformed_fallback`：复用已有镜头兜底，最低优先级。

## 评分维度

本节只用于缺素材路径。对每个 slot，先从未占用的 `shotCards/materialGroups` 中找候选，再做策略评分。评分不是为了追求最高素材分，而是为了选择最合适的落地策略。

如果上游存在 `recommendedMaterialPath`，不要使用本节重新选主素材；先按“素材充足路径”逐项落地推荐素材。

素材占用状态先于评分和包装策略。某个 `shotRef/groupId` 已经作为主承载进入本版任一 shot 后，再次作为另一个 shot 的主画面时，不管是否裁切、放大、冻结帧、局部特写、变速、加字幕或加包装，都不得再判为 `existing_material` 或 `existing_material_packaging_caption`；只能在前四类策略都不成立时，按最低优先级判为 `reuse_transformed_fallback`。

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

评分只用于当前 slot / shot 候选，不跨 slot 平均。`reusePenalty` 只用于评估复用兜底是否仍可执行，不得把已占用素材扣分后重新路由进 `existing_material` 或 `existing_material_packaging_caption`；同一素材只是被列为候选但未占用，不扣复用分。

| 条件 | 策略 |
|---|---|
| 未占用现有素材高度匹配，证明成立，动作/画面完整；`slotFitScore >= 20`、`proofValidityScore >= 20`、`visualActionScore >= 15`、`materialSupportScore >= 65`、`selfDesignPressure <= 6` | `existing_material` |
| 未占用现有素材主体或动作成立，但表达不够清楚，且包装/字幕可以安全补足；`slotFitScore >= 16`、`proofValidityScore >= 16`、`visualActionScore >= 10`、`packagingRecoverScore >= 8`、`materialSupportScore >= 50` | `existing_material_packaging_caption` |
| 现有素材缺关键画面、关键动作、非证明性承接、商品记忆或 CTA，且自行设计不会伪造证明；或缺失点属于可真实补拍/可真实收集的证明资产，例如成分表、说明书、检测报告、详情页、价格页、规格页、真实对照、用户反馈；`selfDesignPressure >= 9`，或 `materialSupportScore < 50` 且缺失点属于可合理自设计内容 | `self_designed_by_shot_design` |
| 多个关键 slot 的 `proofValidityScore < 12`，且既不能靠包装字幕补清，也不能靠真实补证镜头或合理自行设计补齐，说明槽位链整体不适合当前素材 | `return_to_restructure_required` |
| 已占用素材再次使用后仍比其他方案更可执行，且前四类都不成立；`reusePenalty < 0` 时只能作为最低优先级兜底 | `reuse_transformed_fallback` |

路由顺序必须按表格自上而下判断，但已占用素材不得进入前两类现有素材策略。不要因为 `materialSupportScore` 总分高就跳过证明边界；`proofValidityScore < 12` 时禁止走 `existing_material` 或 `existing_material_packaging_caption`。`reuse_transformed_fallback` 只能在没有更好的未占用现有素材、包装字幕方案、自行设计方案时选择。

## 素材镜头字段边界

`existing_material` 是完全使用素材镜头：画面、已有包装、台词/字幕都以原素材为准。ShotDesign 不再自行设计分镜画面，不新增包装说明，不重写台词/字幕；但原素材台词/字幕必须先通过新时序可用性判断。原素材没有台词/字幕时写“无”，并在素材充足路径的最终摘要中提示用户这些镜头无原素材台词，询问是否需要补写。

`existing_material_packaging_caption` 是“未占用素材画面 + 后期包装/字幕补强”：画面仍锁定为原素材镜头，只能写原素材代表帧、主体动作、结果状态或素材包摘要；不得写给生图模型使用的自设计画面提示词。允许新增包装/字幕，但必须写清楚补强的是哪一层后期信息、如何安全补清证明或理解，不能把弱素材包装成强证明，不能伪造素材里不存在的动作、结果、对比、评价或资质。素材充足路径中，若原素材无口播/字幕，只有用户已明确授权补写时才允许新增后期字幕、屏幕文字或旁白；若原素材口播/字幕在新时序中明显不顺，可以重写为后期字幕、屏幕文字或旁白。新增内容必须标为后期层或旁白，不得伪装成原素材人物口播。

缺素材路径的台词/字幕不受原素材口播/字幕默认约束。只要 ShotDesign 已进入缺素材路径，`台词/字幕（若有）` 应按新结构自行设计：服务当前 shot 的 slot 功能、前后衔接、证明边界和节奏区间，并严格落在该 shot 的预计时长范围内。若画面策略使用现有素材但文案是新写的，策略应写 `existing_material_packaging_caption` 或 `reuse_transformed_fallback`；只有画面、包装和台词/字幕都沿用原素材且原台词在新时序中无明显问题时，才可写 `existing_material`。

## 复用硬约束

同一 `shotRef` 可以成为多个 slot 候选，但默认只能有一个主承载。已占用素材再次使用时必须加高复用惩罚，只有没有更好的现有素材、包装字幕或自行设计方案时才允许复用。

已占用 `shotRef/groupId` 再次作为主承载时，策略字段必须写 `reuse_transformed_fallback`。裁切、放大、冻结帧、局部特写、变速、错位重入、反向节奏、标题条、圈选、标签、画中画或后期字幕，都只是复用变形方式或包装说明，不能把复用镜头改判为 `existing_material_packaging_caption`。

`reuse_transformed_fallback` 永远最低优先级。使用时必须写明变形方式，例如裁切、放大、冻结帧、局部特写、变速、错位重入、反向节奏；禁止原样复用。

## 自行设计边界

自行设计本质是对拍摄的指导，若有需要真实证明的内容，可以直接设计。比如真实包装背面、成分表、备案页、检测报告、商品详情页、使用说明；
但不能自行假设，比如无依据硬说“过欧盟检测”。可以说“看我们的成分表，都是安全可见的”，这不属于伪造。
缺素材路径遇到 `missingMaterialAreas` 时，先按“真实补证镜头优先级”判断是否补拍证据本体；不要把缺口直接改写成避开主张。只有补拍也只能得到氛围、摆拍或口播时，才降级、避开或回重组。素材充足路径中，上游已降级或排除的缺口只用于防越界，不重新补证。
如果选择 `return_to_restructure_required`，按 `function-slot-restructure/references/shot-design-return-to-restructure.md` 交回重组。不要在 `shot-design.final.md` 中偷偷改槽位链，也不要硬写一版低质量 Shot 表。
