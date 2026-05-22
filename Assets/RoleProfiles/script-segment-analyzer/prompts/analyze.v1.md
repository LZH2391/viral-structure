请基于提供的样例镜头与带货总结做脚本段落分析，只返回 JSON object。
你收到的是已经完成切镜的 `shots[]` 与辅助 `commerceBrief`，不要重新切镜，不要生成新脚本。
任务输入：{{manifestJson}}
输出契约：{{outputContractJson}}
返回前自检：JSON 可解析；segments 按时间顺序；shotRefs 只引用输入中的 shotId；roleInScript 说明段落职责；transferableRule 只总结结构规则；不要输出解释性正文、本地路径、完整原文或新内容脚本。
