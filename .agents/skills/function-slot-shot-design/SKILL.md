---
name: function-slot-shot-design
description: 基于已确认的 function-slot-restructure 结构方案和当前 thread 中可用的 user-material-pack.stable 生成独立短视频 Shot 设计文件。用于已有 restructure.final.md 或结构方案且用户已认可方案后，需要把脚本段落、节奏曲线、包装与证明方案对齐成具体 shot / shot group，决定现有素材、包装字幕强化、自行设计和复用变形兜底，并输出 shot-design.final.md 时；不回写 restructure.final.md、不重新选择槽位链、不重做 FunctionSlotLibrary 检索、不改写核心重组方案。
---

# Function Slot Shot Design

## 使用边界

这个 skill 只负责第二轮 Shot 设计：

- 读取已确认的 `function-slot-restructure` 方案。
- 把第 5 节脚本段落、第 6 节节奏曲线、第 7 节包装与证明方案对齐为新视频顺序 shot 或必要的 shot group。
- 在当前 thread 中消费 `user-material-pack.stable` 或素材包路径，决定现有素材、包装字幕强化、自行设计、回重组或复用变形兜底。
- 写具体分镜画面、包装说明、台词/字幕、预计时长预算、必须同步点和证明功能。
- 输出独立 `shot-design.final.md`，只保留可交付 Shot 设计，不输出输入依据、Shot 级校验或风险修复表。

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
   提取第 2 节槽位链、第 4 节 adapter、第 5 节脚本段落、第 6 节节奏区间、第 7 节包装块。第 9-10 节风险和替代实现只作为内部边界检查，不写入最终 Shot 文件。不要重新检索库。

3. **先定镜头密度目标**
   如果上游第 6 节包含 `timingBudget`，先转成本版 Shot 设计的镜头密度目标：大概需要多少镜头、每段节奏大致放多少镜头、单镜信息容量多大。这个目标必须在逐 slot 落地前确定，不要留到最后校验。

4. **建立 Shot 对齐草图**
   在镜头密度目标上，为每个 shot 确认它承载的 slotSubtype、脚本段落、节奏区间和包装块。允许一对多、多对一和跨边界承接，但必须写清过渡、合并、fragment、hook、payoff 或 adapter 关系。

5. **选择素材/设计策略**
   进入素材来源和处理策略判断时，读取 `references/material-strategy.md`。若有素材包，基于 `shotCards / materialGroups / proofCoverage / sequenceRecommendations / restructureInputSummary` 选择每个 shot 的策略。

6. **写画面、包装、台词**
   进入分镜画面、包装说明、台词/字幕写作时，读取 `references/dialogue-and-packaging.md`；需要写台词或字幕语感时，再读取 `references/dialoguePool.md`。先让画面动作、包装强化和口播/字幕共同服务 slot 功能，不要先套固定句式。

7. **落表字段与预计时长**
   开始写 Shot 表字段前，读取 `references/output-contract.md`。
   有上游 `timingBudget` 时，每个 shot 的 `预计时长` 必须在本版设计时直接写成具体预算范围，例如 `0.8-1.2s`、`1.5-2.0s`，并让台词/字幕长度服从这个范围。没有 `timingBudget` 时，统一写 `待估算`。

8. **落独立文件并检查**
   在同一个重组目录下写入 `shot-design.final.md`，然后按 `references/output-contract.md` 的质量检查逐项自查。最终聊天回复也遵守该 reference。
