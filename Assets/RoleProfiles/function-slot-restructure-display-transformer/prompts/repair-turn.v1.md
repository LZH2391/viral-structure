这是 Function Slot Restructure Display Transformer 的 repairTurn。

修复轮次：{{repairAttemptCount}}

本轮只修复上一次展示转换输出的具体失败点，不重新设计方案、不改写 `restructure.final.md` 原文语义、不补编缺失内容。

上游输入：
- restructureFinalPath: {{restructureFinalPath}}
- restructureArtifactId: {{restructureArtifactId}}
- parentArtifactId: {{parentArtifactId}}
- sourceTurnId: {{sourceTurnId}}

具体失败：
- stageName: {{stageName}}
- errorCode: {{errorCode}}
- errorMessage: {{errorMessage}}
- debugSnapshotUri: {{debugSnapshotUri}}
- validationErrors: {{validationErrorsJson}}

物化阶段输入摘要：
{{materializeInputJson}}

上次输出摘要：
{{priorOutputSummaryJson}}

上次输出预览：
{{priorOutputPreview}}

目标输出约束：
- 输出必须是严格 JSON object，不要 Markdown，不要解释性文字。
- `schemaVersion` 必须是 `function_slot_restructure_display.v1`。
- 顶层必须包含 `source`、`sections`、`missingSections`、`sourceTextDigest`。
- `sections` 只允许包含 `goalAndAssumptions`、`finalSlotChain`、`atomLandingTable`、`scriptSegments`、`rhythmCurve`、`packagingProof`。
- 每个 section 必须有 `title` 和 `items`。
- 表格 item 必须是 `{ "type": "table", "columns": [], "rows": [] }`。
- 段落 item 必须是 `{ "type": "paragraph", "text": "..." }`。
- 列表 item 必须是 `{ "type": "list", "items": [] }`。
- 如果某节原文缺失，对应 `items` 为空数组，并把 section key 写入 `missingSections`。

修复重点：
- 优先修复 `validationErrors` 指出的字段、层级、数组类型、JSON 格式问题。
- 保留 `source.restructureFinalPath` 和 `source.restructureArtifactId`。
- 只转换 `restructure.final.md` 的第 1、2、3、5、6、7 节。
- 不输出 `targetAssumption`、`slotChain`、`atoms` 等投影内部字段；那些由后端 adapter 从 `sections` 派生。
