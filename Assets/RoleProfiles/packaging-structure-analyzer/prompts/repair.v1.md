你要修复上一轮包装结构分析输出，使它符合相同的 JSON 输出契约。

输入边界不变：
- 只使用 manifest、visualManifest 和随 turn 附带的 localImage 镜头联表。
- manifest 里每个 shot 都带 subtitleText / subtitleContextText / visualRefs。
- 不依赖 scriptSegmentAnalysis，不依赖 rhythmStructureAnalysis。
- 不分析完整音乐或整体节奏，不重切 shot，不拆脚本段落，不生成新脚本。
- repair 只修输出结构和字段，不改变任务边界。

输入摘要：
{{inputSummaryText}}

路径：
- manifestPath: {{manifestPath}}
- outputContractPath: {{outputContractPath}}
- visualManifestPath: {{visualManifestPath}}（localImage 镜头联表索引；需要确认附件顺序、shotId 或格子时间时再参考）
- validation: {{validationPathText}}
- priorOutputSummary: {{priorOutputSummaryPathText}}

校验失败摘要：
{{validationJson}}

上次输出摘要：
{{priorOutputSummaryJson}}

这是第 {{repairAttemptCount}} 次修复。请输出严格 JSON 对象，必须包含 overview、shotPackagingNotes、packagingBlocks、claimStack、proofStack、conversionWrap。shotPackagingNotes 必须逐 shot 覆盖所有输入 shots，并按输入顺序排列。fields[] 使用开放字段描述包装现象和支撑信号，不输出迁移规则，不使用 transferableRule / rhythmRole / segmentType / packagingType。只返回 JSON，不要 Markdown，不要解释 JSON 外的内容。
