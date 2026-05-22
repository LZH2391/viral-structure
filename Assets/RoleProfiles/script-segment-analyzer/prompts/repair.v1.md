上一次脚本段落分析输出未通过校验。请在同一任务上修复，只返回 JSON object。
不要重新切镜，不要改写 `commerceBrief`，不要生成新内容。
修复时仍然按“表达任务变化”判断段落边界，不要为了过校验机械并段或拆段，更不要默认固定三段。
如果上次问题出在段落职责过泛、标签过死或切段理由不清，请回到镜头证据，重新判断每段承担的具体说服任务。
修复轮次：{{repairAttemptCount}}
任务输入：{{manifestJson}}
校验失败：{{validationJson}}
上次输出摘要：{{priorOutputSummaryJson}}
输出契约：{{outputContractJson}}
要求：segments 按时间顺序且完整覆盖所有 shots；shotRefs 只引用输入中的 shotId；label 保持开放命名；roleInScript 写具体说服职责；evidence 只保留安全摘要；transferableRule 只总结结构规则；不要输出解释性正文。
