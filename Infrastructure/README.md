# Infrastructure

基础设施层，承载外部能力和工程支撑。

包括模型调用、媒体处理、存储、观测、配置等能力。它们服务于 `Core`，但不拥有核心业务语义。

模型调用、日志、调试快照和运行产物应在这里建立统一入口，避免散落在展示层或业务流程中。

补充说明：

- [ArtifactIndex](ArtifactIndex/README.md)：本地处理库、artifact tree 和 cache 索引。
- [AgentRuntime](AgentRuntime/README.md)：本地 AppServer / ThreadPool runtime。
- [ThreadPool](ThreadPool/README.md)：ThreadPool role 配置入口。

配置与策略当前由环境变量、启动脚本和实际 runtime 配置文件承载；不保留空 `Config` 目录。后续若出现可版本化的模型选择策略、阶段开关或实验参数，再建立正式配置目录。
