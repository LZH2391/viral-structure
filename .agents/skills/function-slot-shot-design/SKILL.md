---
name: function-slot-shot-design
description: 基于已确认的 function-slot-restructure 结构方案和当前 thread 中可用的 user-material-pack.stable 生成独立短视频 Shot 设计文件。用于已有 restructure.final.md 或结构方案且用户已认可方案后，需要把脚本段落、节奏曲线、包装与证明方案对齐成具体 shot / shot group，决定现有素材、包装字幕强化、AIGC 自行设计和复用变形兜底，并输出 shot-design.final.md 时；不回写 restructure.final.md、不重新选择槽位链、不重做 FunctionSlotLibrary 检索、不改写核心重组方案。
---

# Function Slot Shot Design

## 职责

这个 skill 只负责第二轮 Shot 设计：

- 读取已确认的 `function-slot-restructure` 方案。
- 使用第 5 节脚本段落、第 6 节节奏曲线、第 7 节包装与证明方案作为唯一表达来源。
- 第 6 节若包含 `timingBudget`，必须把它作为台词长度和镜头拆分的硬输入；不要只按“快 / 中 / 慢”感性判断。
- 如果当前 thread 中已有 `user-material-pack.stable` 或素材包路径，必须消费素材包做逐 slot 镜头落地判断；不要只机械展开上游结构。
- 把三条并行视图对齐为新视频顺序 shot 或必要的 shot group。
- 写具体分镜画面、包装说明、台词/字幕、预计时长占位、必须同步点和证明功能。
- 输出独立 `shot-design.final.md`，只保留可交付 Shot 设计，不输出输入依据、Shot 级校验或风险修复表。

不要在这里重新选择 slotSubtype、slotArchetype、atoms、adapter 或 FunctionSlotLibrary evidence。若发现前序结构无法落地，只在聊天中指出阻塞项并要求回到 `function-slot-restructure` 修正，不要在 Shot 文件里偷偷改核心方案，也不要把校验、风险与修复建议写进 `shot-design.final.md`。

## 输入

优先接受：

- 用户已认可的 `Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/restructure.final.md`
- 或用户粘贴的第 1-7 节结构方案
- 当前 thread 中的 `user-material-pack.stable`、素材包路径或用户明确提供的素材候选说明
- 用户补充的拍摄限制、素材限制、画幅、人物/产品一致性要求

如果缺少第 5、6、7 节，不能直接写 Shot 设计；先要求补齐结构方案。

## 工作流

1. **确认结构已认可**  
   只在用户明确认可结构方案、要求继续完善 Shot、或给出已确认的 `restructure.final.md` 时执行。

2. **读取结构方案**  
   提取第 2 节槽位链、第 4 节 adapter、第 5 节脚本段落、第 6 节节奏区间、第 7 节包装块。第 9-10 节风险和替代实现只作为内部边界检查，不写入最终 Shot 文件。不要重新检索库。

3. **建立对齐草图**  
   为每个 shot 确认它承载的 slotSubtype、脚本段落、节奏区间和包装块。允许一对多、多对一和跨边界承接，但必须写清过渡、合并、fragment、hook、payoff 或 adapter 关系。

4. **逐 slot 选择素材落地策略**
   如果有素材包，必须基于 `shotCards / materialGroups / proofCoverage / sequenceRecommendations / restructureInputSummary` 判断每个 slot 的落地策略。评分只用于选策略，不用于删除 slot。

   策略优先级固定为：

   1. `existing_material`：未占用现有素材能直接承载。
   2. `existing_material_packaging_caption`：现有素材基本成立，但需要包装/字幕补清。
   3. `aigc_designed_by_shot_design`：现有素材缺关键画面、场景、动作、非证明性承接、商品记忆或 CTA，需要本 skill 自行设计新镜头。
   4. `return_to_restructure_required`：不是少几个镜头，而是槽位链整体不适合当前素材、合理包装字幕和 AIGC 补镜头，需要按 `function-slot-restructure/references/shot-design-return-to-restructure.md` 交回重组。
   5. `reuse_transformed_fallback`：复用已有镜头兜底，最低优先级。

   同一 `shotRef` 可以成为多个 slot 候选，但默认只能有一个主承载。已占用素材再次使用时必须加高复用惩罚，只有没有更好的现有素材、包装字幕或 AIGC 方案时才允许复用。复用禁止原样使用，必须写明裁切、放大、冻结帧、局部特写、变速、错位重入、反向节奏或其他明确变形方式。

5. **写分镜画面**
   `分镜画面` 是给 GPT-image-2 生成底图/镜头画面的提示词，只写画面中真实可见的主体、场景、动作、构图、景别、视角、光线、材质、情绪和需要展示的产品/界面/结果。不要写槽位名、atom id、说服任务、字幕文案、包装规则、剪辑指令、购买按钮或海报式版式。

6. **写包装说明**
   `包装说明` 只写后期叠加层：字幕、标题条、箭头、圈选、标签、图卡、对比框、画中画、提示符号、品牌/商品露出层级等。必须继承第 7 节包装与证明方案，不能临时新增只为好看的装饰包装。

7. **写台词/字幕**
   先读取 `references/dialoguePool.md` 作为台词语感池，再把第 5 节的语义任务转成真人短视频口播或屏幕字幕，不直接复述结构说明。

   安全边界、条件采用、素材限制、拍摄提醒和修复建议默认进入 `包装说明` 或内部检查，不得占用 `台词/字幕（若有）`。例如“远离易燃物”“保持通风”“按说明使用”属于包装安全提示；“有真实物证再拍”“没有素材就删除”属于内部条件，不是成片台词。

8. **写预计时长约束**
   如果上游第 6 节提供 `timingBudget`，每个 shot 的 `预计时长` 写预算约束，例如 `预算 0.8-1.2s，后置校验回填`，并让台词/字幕长度服从该预算。若上游没有 timingBudget，统一写 `待后置估算`。不要手写起止时间或脱离预算心算秒数。

9. **落独立文件**
   若输入来自 `restructure.final.md`，在同一个重组目录下写入 `Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/shot-design.final.md`。不要修改上游 `restructure.final.md`，也不要再新建 `Artifacts/FunctionSlotShotDesign/<briefSlug-or-runId>`。

## 素材评分与策略边界

评分只回答“这个 slot 用当前素材落地是否靠谱”，不决定 slot 是否存在。

对每个 slot，先从未占用的 `shotCards/materialGroups` 中找候选，再做策略评分。评分不是为了追求最高素材分，而是为了选择最合适的落地策略。

| 维度 | 分值 | 判断问题 |
|---|---:|---|
| `slotFitScore` | 0-25 | shot/group 是否适合当前 slot 的表达目标、位置和观众动作 |
| `proofValidityScore` | 0-25 | 能否真实支撑该 slot 的证明任务，是否会把弱证据说成强证明 |
| `visualActionScore` | 0-20 | 画面主体、动作、结果是否完整可读，时长是否够剪出有效镜头 |
| `packagingRecoverScore` | 0-15 | 是否能靠字幕、标签、圈选、标题条安全补清楚 |
| `aigcNeedScore` | 0-15 | 是否缺关键画面/场景/动作/承接/商品记忆/CTA，更适合自行设计 AIGC 镜头 |
| `reusePenalty` | 0 至 -30 | 该 shot 是否已被占用，重复使用是否伤害成片；已主承载的 shot 再用必须重扣 |

策略路由：

| 条件 | 策略 |
|---|---|
| 未占用现有素材高度匹配，证明成立，动作/画面完整 | `existing_material` |
| 现有素材主体或动作成立，但表达不够清楚，且包装/字幕可以安全补足 | `existing_material_packaging_caption` |
| 现有素材缺关键画面、关键动作、非证明性承接、商品记忆或 CTA，且 AIGC 不会伪造证明 | `aigc_designed_by_shot_design` |
| 多个关键 slot 都无法靠现有素材、包装字幕或合理 AIGC 落地，说明槽位链整体不适合当前素材 | `return_to_restructure_required` |
| 没有更好的现有素材、包装字幕或 AIGC 方案，且重复出现不会严重伤害观感 | `reuse_transformed_fallback` |

`reuse_transformed_fallback` 永远最低优先级。使用时必须写明变形方式，例如裁切、放大、冻结帧、局部特写、变速、错位重入、反向节奏；禁止原样复用。

AIGC 可以补非真实证明性的场景、动作、氛围、承接、商品记忆和 CTA 镜头；不得伪造结果、对比、资质、评价、检测或强信任证明。包装和字幕也不能把弱素材写成强证明。

如果选择 `return_to_restructure_required`，按 `function-slot-restructure/references/shot-design-return-to-restructure.md` 交回重组。不要在 `shot-design.final.md` 中偷偷改槽位链，也不要硬写一版低质量 Shot 表。

## 台词与字幕原则

Shot 里的台词/字幕是面向拍摄和剪辑的可执行文案，不是结构说明的复述。写台词前先明确本 shot 的观众动作：看见问题、理解依据、感到安心、确认质感、记住选择对象。台词只服务这个动作，不解释 slot、atom、proof obligation 或 adapter。

- 写台词前必须先读取 `references/dialoguePool.md`，把它当作“语感池”：学习句长、停顿、转折、口语强度、生活化称呼和短视频带货的说话节奏。
- 语感池只提供语感，不提供可直接搬运的文案。不得照抄其中原句，不得把原商品、原场景、原人群硬套进新 brief。
- 生成台词时要用新 brief 的对象、场景和证明任务重新组织表达；只让成句方式接近语感池里的自然口播感。
- 台词必须像真人短视频口播，优先口语、可一口读完；默认每个 shot 只放 1 个意思。
- 每个有台词的 shot 必须提供当前镜头内的新信息、感受或判断；不能只写结构承接半句，例如“也不是不能用”“接下来看看”“这个镜头”等空转表达。
- 不把上游第 5 节“本方案表达”直接改写成口播。上游第 5 节是语义任务，`shot-design.final.md` 的台词要重新压成自然说法。
- 不在台词里写结构词或审计词，例如“机制主张”“证明载体”“适用范围说明”“替换入口”“长期可信”“购买记忆”。这些只属于方案说明、包装说明或校验备注。
- 不在台词里写制作说明、条件判断或风险修复语，例如“这个镜头”“如果有素材”“条件采用”“需确认”“删除该 shot”“别硬装”“必须打码”“拍摄时”。这些只能作为内部判断，必要时转成包装说明里的成片提示。
- 写完 Shot 设计后必须通读台词：凡是读起来像表格说明、品牌 brief、审计报告或“正确但没人会这么说”的句子，都要重写。
写台词必须经过两步：
1. 先确定本 shot 的口播功能：场景代入 / 动作指令 / 低门槛判断 / 结果落点 / 轻 CTA等。
2. 再写成真人会说的话，允许使用“你看”“就”“其实”“这包”“不用”“直接”“一会儿”等自然口语连接，但不得堆砌。

禁止初版台词出现以下人机感：
- 把证明功能直译成台词，如“证明商品身份”“粉体状态可见”“完成态确认”。
- 用名词短语硬拼句子，如“商品记忆轻转化”“过程可执行”。
- 每条都写成同一种短句结构。
- 只描述画面，没有观众利益或动作判断。
- 为了安全过度克制，导致句子像备注或说明书。

- 写完后做一次活人化改写：如果这句话一个真人主播不会顺嘴说，重写。

## 包装与字幕默认层

默认短视频成片会有字幕层。字幕不是“有一行字”即可，也不是台词字段的重复；字幕是包装证明的一部分，必须说明它服务什么功能、长什么样、放在哪里、什么时候出现。

- 每个 shot 的 `包装说明` 必须写可执行覆盖层规格，至少包含：字幕/标签/标题条/图卡/圈选/箭头的层级、位置、样式、强调规则、出现时机和服务功能。
- 字幕样式要写到可交给剪辑执行的粒度，例如：底部主字幕、白字黑描边、半透明深色底条、关键词黄色高亮、证据标签右上角小胶囊、对象旁小箭头标签。不要只写“短字幕”“轻量字幕”“极简 CTA”。
- 特殊字或重点词如果需要强调，必须写强调范围和样式，例如“核心问题词用黄色描边强调”，“关键证据词用绿色胶囊标签”，“关键数据或状态词用框选高亮”。如果不需要特殊强调，写“无特殊字强调”。
- 字幕层必须说明目的：动作命名、视线引导、证据标注、主张钉子、风险提示、场景归类或 CTA。不能只为了好看添加。
- 字幕不得遮挡证明主体。涉及关键动作、结果状态、证据画面、主体表情、产品或界面细节时，必须写避让位置或安全区。
- 治理库中的 packaging pattern 提供证明功能、视觉层级和可替换形式；最终视觉规格由第 7 节包装方案、brief、平台和画面内容落地。不要期待治理库自动给出每条字幕的字号、描边和强调字。

## 输出格式

输出独立 Markdown 文件，默认路径：

```text
Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/shot-design.final.md
```

文件结构：

```markdown
# Shot 设计方案

上游重组方案：`Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/restructure.final.md`

## Shot 设计

| shot | slotSubtype 对齐 | 素材来源/处理策略 | 脚本段落 | 节奏区间 | 包装块 | 分镜画面 | 包装说明 | 台词/字幕（若有） | 预计时长 | 必须同步点 | 证明功能 |
|---|---|---|---|---|---|---|---|---|---|---|---|
```

字段规则：

- `shot` 使用 `new_shot_01`、`new_shot_02` 等，不沿用来源样例 shot 编号。
- `slotSubtype 对齐` 写该 shot 承载或过渡的 slotSubtype；一个 shot 承载多个槽位时，说明过渡、合并、fragment、hook、payoff 或 adapter 关系。
- `素材来源/处理策略` 必须写 `existing_material`、`existing_material_packaging_caption`、`aigc_designed_by_shot_design` 或 `reuse_transformed_fallback`。使用现有素材时引用 `shotRef/groupId`；AIGC 时写“自设计镜头”；复用兜底时必须写明变形方式，不能只写“复用 shot_x”。
- `脚本段落`、`节奏区间`、`包装块` 写该 shot 对齐第 5、6、7 节中的哪些编号，允许一对多或多对一；不要暗示三者存在上下游生成关系。
- `分镜画面` 必须在当前 shot 内独立可消费，不能依赖前文才能理解；需要一致性时，在当前 shot 内写出可见特征，例如人物大致外观、场景、产品外观或界面状态。
- `包装说明` 写后期叠加的覆盖层、字幕、标题条、圈选、箭头、标签、图卡、画中画等，必须来自第 7 节包装证明方案。
- `台词/字幕（若有）` 只写该 shot 内实际会出现在成片里的口播、主字幕或屏幕文字；无台词写“无”，不要用动作描述、拍摄备注、条件判断、安全规范或修复建议替代台词。
- `预计时长` 有上游 timingBudget 时写预算约束；没有 timingBudget 时只能写 `待后置估算`。
- `必须同步点` 写台词、动作、证据、包装弹出、节奏峰值之间必须同时发生或按顺序贴合的点。
- `证明功能` 写该 shot 最终证明了什么；不能只写“展示产品”或“加强可信”。

如果用户只要求粗分镜，可以输出 shot group，但仍使用同一字段，并在 `shot` 写 `new_shot_group_01` 这类编号。

## 质量检查

完成 `shot-design.final.md` 后逐项检查：

- 是否没有改变第 2-7 节已确认的核心结构。
- 每个 shot 是否至少对齐一个槽位或 adapter。
- 如果有素材包，是否消费了素材包并为每个 shot 写明素材来源/处理策略。
- 是否没有把同一 `shotRef` 原样复用到多个主承载。
- 所有 `reuse_transformed_fallback` 是否写明裁切、放大、冻结帧、局部特写、变速、错位重入等变形处理。
- 是否优先使用未占用现有素材，其次包装/字幕强化，再 AIGC 自行设计，最后才复用变形兜底。
- 每个主张是否有画面、包装或证据承载；只有口播没有证明的主张必须标为风险。
- 分镜画面和包装说明是否分离：底图不承担小字、复杂 UI 文案和包装覆盖层。
- 台词是否自然、口语，不像审计表格或 brief 摘要。
- 包装说明是否写到可执行规格，而不是“轻量字幕”“极简标签”等空泛描述。
- 字幕、标签、箭头、圈选、图卡是否避开主体细节、证据区域、关键动作、结果状态或人物表情。
- 所有 `预计时长` 是否遵守上游 timingBudget；若没有 timingBudget，是否都是 `待后置估算`。
- 是否只输出 Shot 设计表，没有把输入依据、校验表、剩余风险、必要修复或替代实现写进最终文件。

## 聊天回复

完成后只给可点击文件路径和一句摘要；不带验证结果、不带建议 git 提交、不列本轮相关文件。

```markdown
已生成 Shot 设计：[shot-design.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/shot-design.final.md)

摘要：一句话说明 Shot 设计如何承接结构方案。
```
