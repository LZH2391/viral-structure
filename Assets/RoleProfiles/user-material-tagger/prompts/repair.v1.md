上一次 `user-material-pack` 输出没有通过校验。请基于同一输入包修复，并只返回完整 JSON object。

修复次数：{{repairAttemptCount}}

输入摘要：
{{inputSummaryText}}

输入包：
- manifest: `{{manifestPath}}`
- output contract: `{{outputContractPath}}`
- visual manifest: `{{visualManifestPath}}`（localImage 代表帧联表索引；每个格子对应一个 shot，并带 shotId、时间段和时长）

校验失败摘要：
```json
{{validationJson}}
```

上次输出摘要：
```json
{{priorOutputSummaryJson}}
```

要求：
- 只返回修复后的完整 JSON object。
- 不要 Markdown，不要解释。
- 不要删减 shotCards；必须覆盖所有输入 shots。
- 所有 shotRef 必须来自输入 shots。
