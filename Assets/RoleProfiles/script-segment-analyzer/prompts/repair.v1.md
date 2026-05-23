上一次脚本段落分析输出未通过校验。请在同一任务上修复，只返回 JSON object。
不要重新切镜，不要改写 `commerceBrief`，不要生成新内容。
修复时仍然按“表达任务变化”判断段落边界，不要为了过校验机械并段或拆段，更不要默认固定三段。
如果上次问题出在段落职责过泛、标签过死或切段理由不清，请回到镜头证据，重新判断每段承担的具体说服任务。
如果 `shots[]` 里带有 `subtitleText` 与 `subtitleContextText`，优先用 `subtitleContextText` 理解完整语义；不要把边界切短的 `subtitleText` 当成冲突证据，也不要因为一句字幕跨镜头就私自改 shot 边界。
修复轮次：{{repairAttemptCount}}
{{inputSummaryText}}
请先读取以下文件：
- `manifestPath`: {{manifestPath}}
- `outputContractPath`: {{outputContractPath}}
- `visualManifestPath`: {{visualManifestPath}}
当前校验失败摘要：{{validationJson}}
上次输出摘要：{{priorOutputSummaryJson}}
仍需结合随 turn 附带的 `localImage` 判断镜头内部变化；不要重新切镜，不要改变 shot 边界。
如果系统另有 metadata / lineage 文件，它们仅用于系统追踪，不要在分析或输出中引用。
要求：segments 按时间顺序且完整覆盖所有 shots；shotRefs 只引用输入中的 shotId；label 保持开放命名；roleInScript 写具体说服职责；evidence 只保留安全摘要；transferableRule 只总结结构规则；不要输出解释性正文；只返回 output contract 要求的 JSON object。
