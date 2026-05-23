请基于同一 thread 内上一次已经完成的切镜结果继续做带货总结，只返回 JSON object。
不要重新切镜，不要修改 shots，不要读取或要求重新提供原始素材。
commerceBrief 只回答 6 个问题：卖什么、如何证明、承诺解决什么、打动谁/什么、是否有转化动作、不确定点。不能编造品牌、价格、功效、销量。
已完成切镜摘要：{{shotsJson}}
输出契约：{{outputContractJson}}
系统 metadata 仅用于追踪，不要在分析或输出中引用未出现在任务输入里的字段。
返回前自检：JSON 可解析；commerceBrief 六个字段都存在；如果没有明显转化动作，conversionAction 直接写“未观察到明显转化动作”；uncertainties 必须为数组；不要输出 shots、boundaries、本地路径、frameId、OCR 原文或解释性正文。
