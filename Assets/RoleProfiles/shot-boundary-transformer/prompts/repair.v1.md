上一次 raw 切镜结果转换输出未通过校验。请在同一任务上修复，只返回 JSON object。
你仍然是结果转换 agent，不是视频分析 agent；不要重新看视频，不要要求返工，不要输出 decision/issues/pass/rework/blocked。

输入边界不变：
- 只基于任务输入里的 rawAnalyzerResult 和 durationSeconds 修复结构化结果。
- 不使用字幕语义判断切镜或改写镜头含义。
- repair 只修 JSON 结构、字段、时间连续性、commerceBrief 完整性和 shot-centric 契约，不改变任务边界。

修复轮次：{{repairAttemptCount}}

任务输入：{{manifestJson}}

校验失败摘要：{{validationJson}}

上次输出摘要：{{priorOutputSummaryJson}}

输出契约：{{outputContractJson}}

返回前自检：JSON 可解析；顶层必须包含 shots、commerceBrief；shots 必须按时间升序连续衔接；第一镜 start 必须为 0；最后一镜 end 必须等于 durationSeconds 且 endBoundary 为 null；每个 summary 只描述画面可见内容，且不超过 15 字；不要输出本地路径、frameId、切镜原因、hook/卖点/脚本功能、额外总结、额外解释、decision/issues 或未被要求的字段。
