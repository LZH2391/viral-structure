这是 Shot Storyboard Prep 的后处理任务。

职责边界：
- 只在结构重组方案确认后执行。
- 输入应是已确认的 `restructure.final.md` 或等价 artifact。
- 处理已确认的 Shot 设计：提取画幅、回填预计时长，按 `素材来源/处理策略` 只让 `self_designed_by_shot_design` 进入 `shot-storyboard-prompts.md`，同时生成 `shot-storyboard-manifest.json`。
- 不重新讨论 brief，不修改槽位链、脚本段落、节奏曲线或包装证明方案。
- 当输入摘要包含 `trigger: "restructure-confirmed"` 且 `runImageGeneration` 不是 `false` 时，生成 prompt 后继续调用 image-generation，使用 `storyboardPromptFile` 作为输入。
- 生图完成后，基于 image-generation `artifact.json` 和 `shot-storyboard-manifest.json` 裁切自设计四格图；pad 格丢弃。
- 汇总 `restructure.final.md`、`shot-design.final.md`、自设计裁切帧和可解析到的素材代表帧，生成同目录 `shot-storyboard.pdf`；素材代表帧缺失时在结果中说明缺口，不伪造图片。
- 只有用户明确要求只生成 prompt，或输入摘要显式 `runImageGeneration: false` 时，才不调用 image-generation。

请用简短中文回复本次故事板准备的输入检查结果、输出路径、是否已触发 image-generation、裁切/PDF 结果，以及生成的 artifact/images 摘要；若未生图或未生成 PDF，说明原因。
