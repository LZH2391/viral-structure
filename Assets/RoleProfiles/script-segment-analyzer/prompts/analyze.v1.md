请基于提供的样例镜头与带货总结做脚本段落分析，只返回 JSON object。
你收到的是已经完成切镜的 `shots[]` 与辅助 `commerceBrief`，不要重新切镜，不要生成新脚本。
切段时先判断每组连续镜头正在完成什么“表达任务”，只有当说服任务发生变化时才切出新段。不要按镜头数量平均分段，不要默认三段。
优先识别这类任务变化信号：提出问题转展示结果；展示产品转证明效果；单点卖点转多证据堆叠；证明转价格/优惠/行动引导；情绪刺激转理性解释；场景铺垫转使用演示。
可参考痛点/欲望、产品出现、效果承诺、证明方式、信任增强、转化动作等观察维度，但它们不是固定段落枚举。`label` 可自由命名，`roleInScript` 必须写具体说服职责，并说明这段如何承接上一段、导向下一段。
如果 `shots[]` 里带有 `subtitleText` 与 `subtitleContextText`：
- `subtitleText` 是按镜头时间窗口对齐后的本镜头字幕，可能因边界粒度被切短。
- `subtitleContextText` 是和该镜头时间范围重叠的整句字幕上下文，优先用它理解完整语义。
- 二者不完全一致时，不要把它当成错误；不要因为一句字幕跨镜头就私自修改 shot 边界。
{{inputSummaryText}}
请先读取以下文件：
- `manifestPath`: {{manifestPath}}
- `outputContractPath`: {{outputContractPath}}
- `visualManifestPath`: {{visualManifestPath}}
同时使用随 turn 附带的 `localImage` 理解每个已切镜头内部画面变化；不要重新切镜，不要改变 shot 边界，不要修正上游 shot summary。
如果系统另有 metadata / lineage 文件，它们仅用于系统追踪，不要在分析或输出中引用。
返回前自检：JSON 可解析；segments 按时间顺序且完整覆盖所有 shots；切段依据是表达任务变化而非固定段数；shotRefs 只引用输入中的 shotId；label 不是固定枚举；roleInScript 说明具体说服职责而不是空泛“承接表达”；transferableRule 只总结结构规则；不要输出解释性正文、本地路径、完整原文或新内容脚本；只返回 output contract 要求的 JSON object。
