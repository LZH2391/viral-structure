请基于后续多张 localImage 联表做切镜分析，只返回 JSON object。
联表中的帧已经按目标时间网格从抽帧结果中选出，模型只需要基于这些帧判断边界，不需要自行重采样。
你只需要输出切镜时间点，不要输出 frameId、路径、完整输入明细、剧情解释或 OCR 结果。
请额外为每一镜输出 shots[].summary，描述“这镜是什么”；shot summary 不是切换原因。
如果提供了 subtitleContext，只把字幕当作语义辅助，不要把普通字幕断句直接当切镜边界；切镜边界仍以视觉变化为主。
任务输入：{{manifestJson}}
输出契约：{{outputContractJson}}
返回前自检：JSON 可解析；boundaries 不能为空；timestamp 必须在 0 到 durationSeconds 之间；boundaries 必须严格升序且不能重复；shots[].summary 应尽量覆盖每一镜；不要输出本地路径。
