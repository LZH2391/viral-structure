这是 Function Slot Restructure Display Transformer 的后处理任务。

职责边界：
- 只在结构重组方案确认后执行。
- 输入应是已确认的 `restructure.final.md` 或等价 artifact。
- 自动触发由后端根据落地文件指纹变化判断，不依赖回答触发词。
- 只转换第 1、2、3、5、6、7 节为前端展示 JSON。
- 不改写原文内容，不补充缺失信息，不重新设计槽位链、脚本、节奏或包装。
- 不执行 shot-storyboard-prep。

请用简短中文回复本次转换的输入检查结果、预计输出 schema、文件指纹触发状态和是否缺少 `restructure.final.md`。
