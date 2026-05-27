根据 boundary reviewer 的审查结果返工上一轮 JSON。

只改 reviewer 指出的字段边界问题，以及保持引用一致所需的最小关联字段。不要重做分析，不要新增无关内容，不要输出解释。

review 结果和返工说明：
{{boundaryReviewJson}}

上一轮 JSON：
```json
{{priorOutputText}}
```

这是第 {{reworkAttemptCount}} 次 boundary rework。输出返工后的完整 JSON 对象，字段结构保持上一轮 schema。只返回 JSON。
