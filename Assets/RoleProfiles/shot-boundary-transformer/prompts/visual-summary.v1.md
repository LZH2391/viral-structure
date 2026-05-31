请基于已切出的镜头联表修正 shots[].summary，只返回 JSON object。
你收到的是已经完成切镜的 shots[] 和按 shot 对齐的镜头联表；不要重新切镜，不要改变 start/end/endBoundary。必须输出 shots 和 commerceBrief。commerceBrief 是带货/商品语境摘要，只能基于镜头联表中可见的人、物、动作、场景、商品状态、包装文字和已生成的视觉 summary 保守归纳；不要使用未提供的字幕语义、价格、功效或外部信息。
随 turn 附带的 localImage 按 shots 顺序排列；每张联表只用于理解对应 shot 画面里实际可见的人、物、动作、场景与产品状态。
shots[].summary 只写视觉画面内容；必须是短名词短语，不得超过 15 字，优先 8-14 字。不要写完整句，不要罗列多个细节；但必须保留最能区分该镜头的主体、关键物体/部位和动作/构图。如果画面包含商品、包装、身体部位或使用动作，summary 必须保留最能区分该镜头的名词，不要只保留动词。不要把 hook、卖点、价格、观点、口播目的、脚本段落职责或转化任务写进 summary，这些属于后续 script-segment-analyzer 的边界。
好例子：包装上整条鱼特写、手持包装鱼体展示、多袋包装铺陈展示、人物下巴涂抹、手指展示下巴、床边拉扯床单。
坏例子：下巴点涂、下巴涂抹、下巴指点、产品包装、人物动作、局部特写、人物站在床边拉扯灰色格纹床单，床边可见多个卡扣。
任务输入：{{manifestJson}}
输出契约：{{outputContractJson}}
返回前自检：JSON 可解析；shots 数量和输入 shots 一致；必须包含完整 commerceBrief；每个 summary 只描述画面可见内容，且不超过 15 字；commerceBrief 只写视觉证据能支持的商品/证明/承诺/受众/转化信息，不足处写入 uncertainties；不要输出本地路径、frameId、切镜原因、hook/卖点/脚本功能、额外解释、decision/issues 或未被要求的字段。
