# Api

API 入口和应用编排层。

重点职责：

- 接收创作工作台请求。
- 创建和读取创作工作区。
- 调用核心业务流程。
- 返回可追踪的阶段结果和产物引用。

API 层应传递 `runId`、`traceId`、`stageId`、`artifactId`、`parentArtifactId` 等追踪信息，不直接绕过核心流程写入结果。

## 第一阶段本地服务

启动：

```powershell
node Apps/Api/server.js
```

默认端口：`5177`。

已提供：

- `POST /api/workspaces/:workspaceId/sample-videos`
- `GET /api/processing-jobs/:jobId`
- `GET /api/sample-videos/:sampleVideoId/artifact`
- `GET /runtime/...`
