上一次切镜输出未通过校验。请在同一任务上修复，只返回 JSON object。
联表中的帧已经按目标时间网格从抽帧结果中选出，模型只需要基于这些帧判断边界，不需要自行重采样。
修复轮次：{{repairAttemptCount}}
任务输入：{{manifestJson}}
校验失败：{{validationJson}}
上次输出摘要：{{priorOutputSummaryJson}}
输出契约：{{outputContractJson}}
要求：只保留你能确认的切换时间点；严格按时间升序；不要返回空 boundaries；继续输出 shots[].summary；字幕只作语义辅助，不作为唯一切镜依据；不要输出 frameId、路径或解释性正文。
