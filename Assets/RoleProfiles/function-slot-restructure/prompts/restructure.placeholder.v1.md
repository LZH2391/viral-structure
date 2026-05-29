这是结构重组的 ThreadPool 占位任务。

当前任务只确认占位链路可用：
- 不读取或扫描真实 FunctionSlotLibrary 语料。
- 不生成真实槽位链、adapter、脚本段落、节奏曲线或 Shot 设计。
- 不写入 `Artifacts/FunctionSlotRestructure/<runId>/restructure.final.md`。
- 只返回一段简短说明，表明结构重组任务提示词已接入 ThreadPool，后续可替换为真实重组流程。

请用简短中文回复，占位语义即可。
