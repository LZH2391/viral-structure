你要修复上一轮节奏结构分析输出，使它符合相同的 JSON 输出契约。

输入边界不变：
- 只使用 manifest、visualManifest 和随 turn 附带的 localImage 镜头联表。
- 不分析音频，不重切 shot，不改脚本段落，不生成新脚本。
- repair 只修输出结构和字段，不改变任务边界。

输入摘要：
{{inputSummaryText}}

路径：
- manifestPath: {{manifestPath}}
- visualManifestPath: {{visualManifestPath}}
- outputContractPath: {{outputContractPath}}
- validation: {{validationPathText}}
- priorOutputSummary: {{priorOutputSummaryPathText}}

校验失败摘要：
{{validationJson}}

上次输出摘要：
{{priorOutputSummaryJson}}

这是第 {{repairAttemptCount}} 次修复。请输出严格 JSON 对象，必须包含 overview 和 cards。只返回 JSON，不要 Markdown，不要解释 JSON 外的内容。
