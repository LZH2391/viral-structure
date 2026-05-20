# Api

API 入口和应用编排层。

重点职责：

- 接收创作工作台请求。
- 创建和读取创作工作区。
- 调用核心业务流程。
- 返回可追踪的阶段结果和产物引用。

API 层应传递 `runId`、`traceId`、`stageId`、`artifactId`、`parentArtifactId` 等追踪信息，不直接绕过核心流程写入结果。
