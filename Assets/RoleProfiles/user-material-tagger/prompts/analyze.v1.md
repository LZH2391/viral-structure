请基于输入包生成 `user-material-pack` JSON。

输入摘要：
{{inputSummaryText}}

请先按需阅读输入包文件：
- manifest: `{{manifestPath}}`
- output contract: `{{outputContractPath}}`
- output skeleton: `{{outputSkeletonPath}}`
- visual manifest: `{{visualManifestPath}}`（localImage 代表帧联表索引；每个格子对应一个 shot，并带 shotId、时间段和时长）

要求：
- 只返回 JSON object，不要 Markdown，不要解释。
- 必须遵守 output contract。
- 以 output skeleton 为答题纸：保留顶层结构和每个 shotCard 的 `shotRef / shotNo / timeRange / visualSummary`，不要删除、改名或重排。
- 直接按 output skeleton 的 compact 结构输出：重复实体写入 `semanticDictionaries.entityDict` 并在 `detectedEntityRefs` 引用；重复支持写入 `supportDict` 并在 `requiredSupportRefs` 引用；重复限制/缺口/安全边界写入 `guardrailDict` 并在 `limitRefs / constraintRefs / safeUsageRefs / gapAdviceRefs / globalConstraintRefs` 引用。
- 不要先输出 `detectedEntities / limits / constraints / requiredSupport / globalConstraints` 这类展开字段再压缩。
- `visualSummary` 已由切镜 summary 预填，只能在明显不通顺时轻微修正，不要加入证明判断。
- 每个输入 shot 都必须有一个 shotCard。
- `materialGroups`、`proofCoverage`、`sequenceRecommendations`、`restructureInputSummary` 必须由你基于素材证据补全；不要原样返回空骨架。
- 所有 `candidateShots`、`shotRefs`、推荐候选只能引用 output skeleton 中已有的 `shotRef`。
- 随 turn 附带的 localImage 只提供每个 shot 的中间代表画面；不要臆测代表帧之外的镜头内部连续变化。
- 不筛选“高光片段”，只做结构位置适配的开头/中段/结尾候选推荐。
- 不把 shot 标成最终槽位，不生成新脚本或新分镜。
