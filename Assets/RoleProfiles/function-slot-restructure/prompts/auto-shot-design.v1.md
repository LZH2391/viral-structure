这是 function-slot-restructure 会话的自动推进任务。

用户已开启自动推进。当前结构方案已生成并落盘，请基于该结构方案继续完善具体 Shot 设计。

源文件：
- sourceRestructureFinalPath: {{sourceRestructureFinalPath}}
- sourceTurnId: {{sourceTurnId}}

用户补充说明：
{{userInstruction}}

执行要求：
- 使用 function-slot-shot-design 的边界和输出约束完成第二轮 Shot 设计。
- 读取 `sourceRestructureFinalPath` 指向的 `restructure.final.md`，不要重新选择槽位链、atoms、adapter 或 FunctionSlotLibrary evidence。
- 在同一目录写入或更新 `shot-design.final.md`。
- 不要改写 `restructure.final.md`。
- 如果 Shot 设计无法落地，请按 `return_to_restructure_required` 交回重组，不要硬写低质量 Shot 表。
- 完成后在最终回复中给出 `shot-design.final.md` 保存路径。
