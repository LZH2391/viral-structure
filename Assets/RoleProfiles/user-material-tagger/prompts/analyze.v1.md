请基于输入包生成 `user-material-pack` JSON。

输入摘要：
{{inputSummaryText}}

请先按需阅读输入包文件：
- manifest: `{{manifestPath}}`
- output contract: `{{outputContractPath}}`
- visual manifest: `{{visualManifestPath}}`

要求：
- 只返回 JSON object，不要 Markdown，不要解释。
- 必须遵守 output contract。
- 每个输入 shot 都必须有一个 shotCard。
- 不筛选“高光片段”，只做结构位置适配的开头/中段/结尾候选推荐。
- 不把 shot 标成最终槽位，不生成新脚本或新分镜。
