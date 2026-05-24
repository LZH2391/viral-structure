请基于已切出的镜头联表修正 shots[].summary，只返回 JSON object。
你收到的是已经完成切镜的 shots[]，不要重新切镜，不要改变 start/end/endBoundary，不要输出 commerceBrief/videoSummary。
随 turn 附带的 localImage 是按任务输入 sheets 顺序排列的每镜联表；每张联表只用于理解对应 shot 画面里实际可见的人、物、动作、场景与产品状态。
shots[].summary 只写视觉画面内容；必须是短名词短语，不得超过 15 字，10 字以内为好。不要写完整句，不要罗列多个细节。不要写 hook、话题、卖点、价格、观点、字幕语义、口播目的、脚本段落职责或转化任务，这些属于后续 script-segment-analyzer 的边界。
好例子：人物躺床、拉扯床单、床单局部、人物翻身、产品包装。
坏例子：人物站在床边拉扯灰色格纹床单，床边可见多个卡扣。
任务输入：{{manifestJson}}
输出契约：{{outputContractJson}}
返回前自检：JSON 可解析；shots 数量和输入 shots 一致；每个 summary 只描述画面可见内容，且不超过 15 字；不要输出本地路径、frameId、切镜原因、hook/卖点/脚本功能、额外解释、decision/issues 或未被要求的字段。
