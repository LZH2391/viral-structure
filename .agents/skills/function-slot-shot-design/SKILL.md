---
name: function-slot-shot-design
description: 基于已确认的 function-slot-restructure 结构方案和当前 thread 中可用的 user-material-pack.stable 生成独立短视频 Shot 设计文件。用于已有 restructure.final.md 或结构方案且用户已认可方案后，需要把脚本段落、节奏曲线、包装与证明方案对齐成具体 shot / shot group，决定现有素材、包装字幕强化、自行设计和复用变形兜底，并输出 shot-design.final.md 时；不回写 restructure.final.md、不重新选择槽位链、不重做 FunctionSlotLibrary 检索、不改写核心重组方案。
---

# Function Slot Shot Design

## 使用边界

这个 skill 只负责第二轮 Shot 设计：

- 读取已确认的 `function-slot-restructure` 方案。
- 把第 5 节脚本段落、第 6 节节奏曲线、第 7 节包装与证明方案对齐为新视频顺序 shot 或必要的 shot group。
- 在当前 thread 中消费 `user-material-pack.stable` 或素材包路径，决定现有素材、包装字幕强化、真实补证镜头、自行设计承接镜头、回重组或复用变形兜底。
- 当上游素材供给类型为 `material_sufficient_specific_path` 或 `material_oversupply_selectable`，且已经给出推荐素材路径时，直接按推荐路径落 Shot 表，只补封面；不重新选主路径，不默认新增自设计镜头。
- 写具体分镜画面、动作与运镜、包装说明、台词/字幕、预计时长预算、必须同步点和证明功能。
- 在 Shot 表完成后，基于已确认方案和最终 Shot 设计写一份封面生图提示词；封面不占视频时长，不改变槽位链，也不回写上游结构方案。
- 输出独立 `shot-design.final.md`，只保留可交付 Shot 设计，不输出输入依据、Shot 级校验或风险修复表。

使用素材镜头时要区分两种字段边界：

- `existing_material`：完全使用素材镜头，不需要也不允许再自行设计 `分镜画面`、`包装说明`、`台词/字幕（若有）`。这些字段必须来自原素材镜头：画面写原素材代表帧/动作摘要，包装写原素材已有包装或“无新增包装，沿用原素材”，台词/字幕必须使用原素材镜头的字幕/口播；原素材无字幕时写“无”，不得新写。
- `existing_material_packaging_caption`：画面仍使用素材镜头，不允许把 `分镜画面` 写成给生图服务的自设计画面；但允许在 `包装说明` 和必要的 `台词/字幕（若有）` 中写新包装/字幕如何补强。补强内容必须是后期叠加层、字幕层、圈选、标签、标题条、画中画等剪辑执行说明，不能伪造成新拍摄画面或自行生图镜头。

无原素材口播/字幕的镜头，默认不新写台词或字幕。只有用户在发起 Shot 设计前明确说明“无台词镜头也可以写/需要补字幕/需要补口播”，或在上一轮最终摘要询问后明确回复要写，才允许为无台词素材镜头新增后期字幕、屏幕文字或旁白。新增内容必须标明为“后期字幕/包装层/旁白”，不得伪装成原素材人物口播；新增后该 shot 的策略应使用 `existing_material_packaging_caption`、`self_designed_by_shot_design` 或合适的兜底策略，而不是继续标为纯 `existing_material`。

只要本轮 ShotDesign 新写了任何台词、后期字幕、屏幕文字或旁白，最终聊天回复必须说明“本轮包含新增台词/字幕，等待平台侧外部质检”。ShotDesign 不持有、不调用、也不提及任何台词审查 role；如平台或用户之后返回台词质检结果，再按结果做最小返工。

不要在这里重新选择 slotSubtype、slotArchetype、atoms、adapter 或 FunctionSlotLibrary evidence。若发现前序结构无法落地，只在聊天中指出阻塞项并要求回到 `function-slot-restructure` 修正，不要在 Shot 文件里偷偷改核心方案，也不要把校验、风险与修复建议写进 `shot-design.final.md`。

## 输入

优先接受：

- 用户已认可的 `Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/restructure.final.md`
- 或用户粘贴的第 1-7 节结构方案
- 当前 thread 中的 `user-material-pack.stable`、素材包路径或用户明确提供的素材候选说明
- 用户补充的拍摄限制、素材限制、画幅、人物/产品一致性要求

如果缺少第 5、6、7 节，不能直接写 Shot 设计；先要求补齐结构方案。

## 工作顺序

1. **确认结构已认可**
   只在用户明确认可结构方案、要求继续完善 Shot、或给出已确认的 `restructure.final.md` 时执行。

2. **读取上游结构**
   提取第 2 节槽位链、素材供给判断、推荐素材路径、第 4 节 adapter、第 5 节脚本段落、第 6 节节奏区间、第 7 节包装块。第 9-10 节风险和替代实现只作为内部边界检查，不写入最终 Shot 文件。不要重新检索库。

3. **先判断 ShotDesign 路径**
   若上游第 2 节存在 `materialSupplyType=material_sufficient_specific_path` 或 `material_oversupply_selectable`，并给出 `recommendedMaterialPath` / 推荐素材顺序，进入“素材充足路径”：ShotDesign 的第一责任是把推荐路径逐 shot 落地；包装字幕、自行设计和复用变形不能替代推荐路径成为新的主成片逻辑。
   素材充足路径中，不再逐 slot 重新评分选材，不默认新增自设计镜头，不主动重写已有字幕/口播。推荐路径素材有原字幕/口播时沿用；推荐路径素材无原字幕/口播时，只有用户在重组最终回复后明确授权补写，才允许新增后期字幕/旁白，否则写“无”。封面生图提示词仍必须补充。
   若上游第 2 节为 `material_insufficient_for_full_video`、没有推荐素材路径，或用户明确要求重新选择素材，才进入“缺素材路径”，按 `references/material-strategy.md` 的评分和策略路由执行。

4. **先定镜头密度目标**
   如果上游第 6 节包含 `timingBudget`，先转成本版 Shot 设计的镜头密度目标：大概需要多少镜头、每段节奏大致放多少镜头、单镜信息容量多大。这个目标必须在逐 slot 落地前确定，不要留到最后校验。

5. **建立 Shot 对齐草图**
   在镜头密度目标上，为每个 shot 确认它承载的 slotSubtype、脚本段落、节奏区间和包装块。允许一对多、多对一和跨边界承接，但必须写清过渡、合并、fragment、hook、payoff 或 adapter 关系。
   素材充足路径中，Shot 对齐草图必须以推荐素材路径顺序为主骨架；允许把相邻推荐素材合并为 shot group，或把单个推荐素材拆成 fragment，但不得跳过推荐素材后另起一条主路径。若某个推荐素材存在明确 shot 级致命问题，先在聊天中说明偏离原因；偏离导致主路径失效时声明 `return_to_restructure_required`。

6. **选择素材/设计策略**
   进入素材来源和处理策略判断时，读取 `references/material-strategy.md`。若是素材充足路径，只使用该 reference 中的“素材充足路径”规则：按推荐路径逐项落表，策略通常为 `existing_material`，无授权时不新增台词/字幕。若是缺素材路径，先按 compact ref schema 展开 `semanticDictionaries` 引用，再基于 `shotCards / materialGroups / proofCoverage / sequenceRecommendations / restructureInputSummary / globalConstraintRefs` 选择每个 shot 的策略。

7. **写画面、包装、台词**
   进入分镜画面、动作与运镜、包装说明、台词/字幕写作时，读取 `references/dialogue-and-packaging.md`；需要写台词或字幕语感时，再读取 `references/dialoguePool.md`。先让画面关键帧、拍摄动作、包装强化和口播/字幕共同服务 slot 功能，不要先套固定句式。
   `分镜画面` 会用于生图，只写单帧可见的主体、场景、构图、人物/手部当前姿态和产品状态；不要写连续运镜、后期动效或剪辑指令。`动作与运镜` 写这个 shot 怎么拍、人物/手怎么动、镜头怎么动，保持普通可拍，例如固定近景、轻推近、俯拍稳定停留、手指按压、手拿起包装、手指依次指向。`包装说明` 写覆盖层和简单出现方式，例如直接出现、淡入、随动作弹出、依次落位；只要写主字幕样式，就必须同时写出该 shot 真实会出现的主字幕文案，不能只写“底部主字幕白字黑描边”这类纯样式。`必须同步点` 只写动作、台词、证据、包装出现和节奏峰值之间的对齐关系。
   对 `existing_material` shot，跳过自行画面设计、包装设计和新台词写作，只从素材包读取原镜头画面摘要、已有包装/字幕和原字幕/口播填表；原素材没有口播/字幕时写“无”，并记录到最终摘要的“无原素材台词镜头”清单中，询问用户是否需要补写。对 `existing_material_packaging_caption` shot，画面仍只写素材镜头摘要，包装/字幕字段只写后期补强方案，不写自设计镜头画面；若补强内容来自用户授权的无台词补写，必须标明为后期新增层。

8. **落表字段与预计时长**
   开始写 Shot 表字段前，读取 `references/output-contract.md`。
   有上游 `timingBudget` 时，每个 shot 的 `预计时长` 必须在本版设计时直接写成具体预算范围，例如 `0.8-1.2s`、`1.5-2.0s`，并让台词/字幕长度服从这个范围。没有 `timingBudget` 时，统一写 `待估算`。

9. **追加封面生图提示词**
   在 Shot 表后追加封面生图提示词区块。封面画幅必须跟随视频画幅：竖屏视频写竖版封面，横屏视频写横版封面；视频画幅未明确时写“未明确，需确认”，不要猜。封面应归纳本方案最重要的卖点、产品/人物一致性、情绪峰值和第 7 节包装风格，但不得新增上游没有的核心主张或证据。封面可以和其他自设计镜头进入同一故事板链路，但在 PDF 中必须作为第一页，不计入普通 shot 时长或 slot 分页。

10. **落独立文件并检查**
   在同一个重组目录下写入 `shot-design.final.md`，然后按 `references/output-contract.md` 的质量检查逐项自查。最终聊天回复也遵守该 reference。

11. **台词状态声明**
   如果本轮写入了任何非原素材逐字来源的台词、后期字幕、屏幕文字、封面标题字或旁白，只在最终回复中声明“本轮包含新增台词/字幕，等待平台侧外部质检”。不要在 ShotDesign 内调用其他审查 role，不要在 `shot-design.final.md` 中写质检过程、质检结论或整版风险表。
