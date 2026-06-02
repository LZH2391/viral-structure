# Output Contract

## 输出路径

输出独立 Markdown 文件，默认路径：

```text
Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/shot-design.final.md
```

若输入来自 `restructure.final.md`，在同一个重组目录下写入 `shot-design.final.md`。不要修改上游 `restructure.final.md`，也不要新建 `Artifacts/FunctionSlotShotDesign/<briefSlug-or-runId>`。

## 文件结构

```markdown
# Shot 设计方案

上游重组方案：`Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/restructure.final.md`

## Shot 设计

| shot | slotSubtype 对齐 | 素材来源/处理策略 | 脚本段落 | 节奏区间 | 包装块 | 分镜画面 | 包装说明 | 台词/字幕（若有） | 预计时长 | 必须同步点 | 证明功能 |
|---|---|---|---|---|---|---|---|---|---|---|---|
```

## 字段规则

- `shot` 使用 `new_shot_01`、`new_shot_02` 等，不沿用来源样例 shot 编号。
- `slotSubtype 对齐` 写该 shot 承载或过渡的 slotSubtype；一个 shot 承载多个槽位时，说明过渡、合并、fragment、hook、payoff 或 adapter 关系。
- `素材来源/处理策略` 必须写 `existing_material`、`existing_material_packaging_caption`、`self_designed_by_shot_design` 或 `reuse_transformed_fallback`。使用现有素材时引用 `shotRef/groupId`；自行设计时写“自设计镜头”；复用兜底时必须写明变形方式，不能只写“复用 shot_x”。
- `脚本段落`、`节奏区间`、`包装块` 写该 shot 对齐第 5、6、7 节中的哪些编号，允许一对多或多对一；不要暗示三者存在上下游生成关系。
- `分镜画面` 必须在当前 shot 内独立可消费，不能依赖前文才能理解；需要一致性时，在当前 shot 内写出可见特征，例如人物大致外观、场景、产品外观或界面状态。
- `包装说明` 写后期叠加的覆盖层、字幕、标题条、圈选、箭头、标签、图卡、画中画等，必须来自第 7 节包装证明方案。
- `台词/字幕（若有）` 只写该 shot 内实际会出现在成片里的口播、主字幕或屏幕文字；无台词写“无”，不要用动作描述、拍摄备注、条件判断、安全规范或修复建议替代台词。
- `预计时长` 有上游 `timingBudget` 时写本版设计时直接定下来的具体范围；没有 `timingBudget` 时只能写 `待估算`。
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
- 是否优先使用未占用现有素材，其次包装/字幕强化，再自行设计，最后才复用变形兜底。
- 每个主张是否有画面、包装或证据承载；只有口播没有证明的主张必须标为风险。
- 分镜画面和包装说明是否分离：底图不承担小字、复杂 UI 文案和包装覆盖层。
- 台词是否自然、口语，不像审计表格或 brief 摘要。
- 包装说明是否写到可执行规格，而不是“轻量字幕”“极简标签”等空泛描述。
- 字幕、标签、箭头、圈选、图卡是否避开主体细节、证据区域、关键动作、结果状态或人物表情。
- 所有 `预计时长` 是否遵守上游 `timingBudget`；若没有 `timingBudget`，是否都是 `待估算`。
- 第一版设计是否已经把 `timingBudget` 前移成镜头密度目标，而不是留到最后校验。
- 是否只输出 Shot 设计表，没有把输入依据、校验表、剩余风险、必要修复或替代实现写进最终文件。

## 聊天回复

完成后只给可点击文件路径和一句摘要；不带验证结果、不带建议 git 提交、不列本轮相关文件。

```markdown
已生成 Shot 设计：[shot-design.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/shot-design.final.md)

摘要：一句话说明 Shot 设计如何承接结构方案。
```
