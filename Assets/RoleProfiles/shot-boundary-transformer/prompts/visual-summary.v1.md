请基于已切出的镜头联表修正 shots[].summary，只返回 JSON object。
你收到的是已经完成切镜的 shots[]，不要重新切镜，不要改变 start/end/endBoundary，不要输出 commerceBrief/videoSummary。
随 turn 附带的 localImage 是按任务输入 sheets 顺序排列的每镜联表；每张联表只用于理解对应 shot 画面里实际可见的人、物、动作、场景与产品状态。
shots[].summary 只写视觉画面内容；不要写 hook、话题、卖点、价格、观点、字幕语义、口播目的、脚本段落职责或转化任务，这些属于后续 script-segment-analyzer 的边界。
任务输入：{{manifestJson}}
输出契约：{{outputContractJson}}
返回前自检：JSON 可解析；shots 数量和输入 shots 一致；每个 summary 只描述画面可见内容；不要输出本地路径、frameId、切镜原因、hook/卖点/脚本功能、额外解释、decision/issues 或未被要求的字段。
