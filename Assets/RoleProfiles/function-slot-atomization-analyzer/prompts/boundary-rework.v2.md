根据 boundary reviewer 的审查结果，基于同一输入包重新产出功能槽位原子化 JSON。

只修 reviewer 指出的字段边界问题，以及保持引用一致所需的最小关联字段。不要依赖上次输出内容，不要重做脚本段落/节奏/包装分析，不要新增无关内容，不要输出解释。

输入摘要：
{{inputSummaryText}}

路径：
- manifestPath: {{manifestPath}}
- outputContractPath: {{outputContractPath}}

review 结果和返工说明：
{{boundaryReviewJson}}

这是第 {{reworkAttemptCount}} 次 boundary rework。输出返工后的完整 JSON 对象，字段必须符合 outputContract.schema。只返回 JSON。
