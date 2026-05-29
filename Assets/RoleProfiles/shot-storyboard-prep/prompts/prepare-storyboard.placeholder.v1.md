这是 Shot Storyboard Prep 的 ThreadPool 占位任务。

当前任务只确认占位链路可用：
- 不读取或修改真实 `restructure.final.md`。
- 不运行 `prepare_storyboard.py`。
- 不生成 `shot-storyboard-prompts.md`。
- 不调用 image-generation 或任何生图 provider。
- 只返回一段简短说明，表明 Shot Storyboard Prep 任务提示词已接入 ThreadPool，后续可替换为真实故事板准备流程。

请用简短中文回复，占位语义即可。
