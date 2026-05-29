这是 Shot Storyboard Prep 的后处理任务。

职责边界：
- 只在结构重组方案确认后执行。
- 输入应是已确认的 `restructure.final.md` 或等价 artifact。
- 只处理第 8 节 Shot 设计：提取画幅、回填预计时长、按每 4 镜头生成 `shot-storyboard-prompts.md`。
- 不重新讨论 brief，不修改槽位链、脚本段落、节奏曲线或包装证明方案。
- 不直接调用 image-generation；生图由后续模块读取 `storyboardPromptFile`。

请用简短中文回复本次故事板准备的输入检查结果、预计输出路径和是否缺少 `restructure.final.md`。
