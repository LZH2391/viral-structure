# ShotDesign 回重组能力接口

本参考定义同一 thread 内 `function-slot-shot-design` 如何把结构落地失败交回 `function-slot-restructure`。这是 agent 协作契约，不需要新增 JSON 文件、后端接口或独立 `function-slot-shot-design` ThreadPool role。

## 触发条件

当 ShotDesign 判断问题不是“少几个镜头”，而是当前槽位链整体不适合当前素材、合理包装字幕和自行设计时，触发：

```text
return_to_restructure_required
```

典型触发原因：

- 多个关键 slot 都无法靠现有素材落地。
- 自行设计会伪造结果、对比、资质、评价、检测或强信任证明。
- 包装/字幕只能补表达，不能补真实证明。
- 复用压力过高，同一 shot 会被迫承担多个主功能。
- 当前槽位顺序、节奏或证明路径与素材天然路径冲突。

## ShotDesign 交回内容

ShotDesign 不要在 `shot-design.final.md` 中偷偷改槽位链，也不要硬写一版低质量 Shot 表。应在聊天中明确声明 `return_to_restructure_required`，并交回：

- 上游 `restructure.final.md` 路径或已确认结构方案。
- 当前使用的 `user-material-pack.stable` 或素材包上下文。
- 无法落地的 slot / slotSubtype。
- 无法落地原因：现有素材不足、自行设计不能安全补、证明会被伪造、复用压力过高、顺序/节奏不成立等。
- 已排除的策略：现有素材、包装字幕强化、自行设计、复用变形兜底。

## Restructure 处理方式

`function-slot-restructure` 收到回调后，按重组职责重新处理：

- 重新评估 brief、FunctionSlotLibrary、素材供给类型和推荐素材路径。
- 可以重排、替换、合并或拆分槽位链，但必须继续遵守 binding principle / rule policy。
- 不把 ShotDesign 的失败 slot 直接删掉；要判断它是否应换结构位置、换 slotSubtype、降主张、改证明路径或改成更适合素材的结构方案。
- 输出新的或修正后的 `restructure.final.md`。
- 新方案确认后，再交给 `function-slot-shot-design` 重新落镜头。

## 边界

- 这是同一 thread 内的能力切换，不是新增独立 role。
- ShotDesign 只判断是否需要回重组，不直接改核心槽位链。
- Restructure 只修正结构方案，不在回调处理中展开具体 Shot 表。
- 如果只是单个镜头缺失、承接画面不足或 CTA 画面不足，优先由 ShotDesign 自行设计镜头，不触发回重组。
