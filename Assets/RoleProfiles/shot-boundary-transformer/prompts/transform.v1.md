请把当前 raw 切镜自由文本结果转换为固定 JSON，只返回 JSON object。
你是结果转换 agent，不是视频分析 agent；不要重新看视频，不要要求返工，不要输出 decision/issues/pass/rework/blocked。
只基于任务输入里的 rawAnalyzerResult 和 durationSeconds 组织结构化结果；不要使用字幕语义判断切镜或改写镜头含义。
turn1 只负责把 raw 切镜时间段转换为 shots 的 start/end/endBoundary；不要生成、猜测或填写 shots[].summary，也不要生成 commerceBrief。系统会在 turn2 基于每镜联表生成视觉 summary 和 commerceBrief。
任务输入：{{manifestJson}}
输出契约：{{outputContractJson}}
返回前自检：JSON 可解析；顶层必须包含 shots；shots 必须按时间升序连续衔接；第一镜 start 必须为 0；最后一镜 end 必须等于 durationSeconds 且 endBoundary 为 null；不要输出 commerceBrief、shots[].summary、本地路径、frameId、切镜原因、hook/卖点/脚本功能、额外总结、额外解释、decision/issues 或未被要求的字段。
