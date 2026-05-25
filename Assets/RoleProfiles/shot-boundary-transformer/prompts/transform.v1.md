请把当前 raw 切镜自由文本结果转换为固定 JSON，只返回 JSON object。
你是结果转换 agent，不是视频分析 agent；不要重新看视频，不要要求返工，不要输出 decision/issues/pass/rework/blocked。
只基于任务输入里的 rawAnalyzerResult 和 durationSeconds 组织结构化结果；不要使用字幕语义判断切镜或改写镜头含义。
shots[].summary 先给出保守的画面内容占位；必须是短名词短语，不得超过 15 字，优先 8-14 字。不要写完整句，不要罗列多个细节；但必须保留最能区分该镜头的主体、关键物体/部位和动作/构图，不要只写孤立动作或局部动作，例如“下巴点涂”“手指指点”“人物移动”。不要写 hook、话题、卖点、价格、观点、字幕语义、口播目的、脚本段落职责或转化任务，这些属于后续 script-segment-analyzer 的边界。系统会在切出 shots 后用每镜联表单独修正视觉 summary。
任务输入：{{manifestJson}}
输出契约：{{outputContractJson}}
返回前自检：JSON 可解析；顶层必须包含 shots、commerceBrief；shots 必须按时间升序连续衔接；第一镜 start 必须为 0；最后一镜 end 必须等于 durationSeconds 且 endBoundary 为 null；每个 summary 只描述画面可见内容，且不超过 15 字；不要输出本地路径、frameId、切镜原因、hook/卖点/脚本功能、额外总结、额外解释、decision/issues 或未被要求的字段。
