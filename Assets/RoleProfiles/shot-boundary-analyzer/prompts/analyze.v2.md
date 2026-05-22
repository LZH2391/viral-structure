请基于后续多张 localImage 联表做切镜分析，只返回 JSON object。
联表中的帧已经按目标时间网格从抽帧结果中选出，模型只需要基于这些帧判断边界，不需要自行重采样。
输出必须采用 `commerceBrief + shots` 结构：返回一个 commerceBrief 对象和一个 shots 数组，不要单独再返回 boundaries 数组。
每个 shot 必须直接包含这一镜的 summary / start / end / endBoundary。
如果提供了 subtitleContext，只把字幕当作语义辅助，不要把普通字幕断句直接当切镜边界；切镜边界仍以视觉变化为主。
commerceBrief 只回答 6 个问题：卖什么、如何证明、承诺解决什么、打动谁/什么、是否有转化动作、不确定点。不能编造品牌、价格、功效、销量。
任务输入：{{manifestJson}}
输出契约：{{outputContractJson}}
返回前自检：JSON 可解析；commerceBrief 六个字段都存在，uncertainties 必须为数组；shots 必须按时间升序；第一镜 start 必须为 0；最后一镜 end 必须等于 durationSeconds；除最后一镜外每个 shot.endBoundary.timestamp 必须等于该镜 end；下一镜 start 必须等于上一镜 end；summary 描述“这一镜是什么”；reason 描述“为什么在这里切”；不要输出时间戳文本、本地路径、frameId、OCR 原文或解释性正文。
