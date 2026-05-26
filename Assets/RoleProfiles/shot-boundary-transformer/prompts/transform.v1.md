请把当前 raw 切镜自由文本结果转换为固定 JSON，只返回 JSON object。
你是结果转换 agent，不是视频分析 agent；不要重新看视频，不要要求返工，不要输出 decision/issues/pass/rework/blocked。
只基于任务输入里的 rawAnalyzerResult 和 durationSeconds 组织结构化结果；不要使用字幕语义判断切镜或改写镜头含义。
turn1 只负责把 raw 切镜时间段转换为 shots 的 start/end/endBoundary，并整理 commerceBrief；不要生成、猜测或填写 shots[].summary。系统会在 turn2 基于每镜联表单独生成视觉 summary。
commerceBrief 是带货/商品语境摘要，用来兼容下游字段：sellingObject、proofApproach、promisedOutcome、persuasionTarget、conversionAction、uncertainties。只能基于 rawAnalyzerResult 中明确出现的信息保守填写；信息不足时写“未提供”，uncertainties 说明缺口。
任务输入：{{manifestJson}}
输出契约：{{outputContractJson}}
返回前自检：JSON 可解析；顶层必须包含 shots、commerceBrief；shots 必须按时间升序连续衔接；第一镜 start 必须为 0；最后一镜 end 必须等于 durationSeconds 且 endBoundary 为 null；不要输出 shots[].summary、本地路径、frameId、切镜原因、hook/卖点/脚本功能、额外总结、额外解释、decision/issues 或未被要求的字段。
