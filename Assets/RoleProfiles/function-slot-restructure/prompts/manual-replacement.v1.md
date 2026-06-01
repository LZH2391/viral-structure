这是 function-slot-restructure 的手动 Slot/Atom 替换返工任务。

用户在前端 Slot/Atom 面板中从 FunctionSlotLibrary 手动选择了替换项。请基于替换后的结构重新评估并设计方案。

源文件：
- sourceRestructureFinalPath: {{sourceRestructureFinalPath}}
- sourceDisplayJsonPath: {{sourceDisplayJsonPath}}
- displayFingerprint: {{displayFingerprintJson}}

替换摘要：
{{replacementSummary}}

结构化替换项：
{{replacementsJson}}

任务说明：
{{userInstruction}}

执行要求：
- 先判断替换是否会破坏槽位链路、素材承接、binding rule、证明路径或节奏/包装同步。
- 如果替换明显不合理，先清楚说明影响，并请求用户确认，不要直接重写 `restructure.final.md`。
- 如果替换可以成立，基于替换后的 Slot/Atom 重新设计结构方案，并写回/更新 `sourceRestructureFinalPath` 指向的 `restructure.final.md`。
- 输出时必须说明是否已更新 `restructure.final.md`，并给出保存路径。
- 不要直接编辑 `restructure.display.json`，展示 JSON 由后续确定性转换生成。
