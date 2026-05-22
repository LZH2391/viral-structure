上一次切镜输出未通过校验。请在同一任务上修复，只返回 JSON object。
联表中的帧已经按系统策略选出，模型只需要基于这些帧判断边界，不需要自行重采样。
修复轮次：{{repairAttemptCount}}
任务输入：{{manifestJson}}
校验失败：{{validationJson}}
上次输出摘要：{{priorOutputSummaryJson}}
输出契约：{{outputContractJson}}
系统 metadata 仅用于追踪，不要在分析或输出中引用未出现在任务输入里的字段。
要求：继续采用 `commerceBrief + shots` 结构；不要返回独立 boundaries 数组；每个 shot 直接包含 summary / start / end / endBoundary；commerceBrief 只回答 6 个问题，不编造品牌、价格、功效；如果没有明显转化动作，conversionAction 直接写“未观察到明显转化动作”；uncertainties 必须为数组；严格按时间升序；第一镜 start 必须为 0；最后一镜 end 必须等于 durationSeconds；除最后一镜外每个 shot.endBoundary.timestamp 必须等于该镜 end；summary 只描述镜头内容；reason 只描述切换原因；字幕只作语义辅助，不作为唯一切镜依据；不要输出 frameId、路径或解释性正文；`boundaryType` 可省略。
