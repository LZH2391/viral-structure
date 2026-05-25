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
.\start-api-server.bat
```

该窗口会保持打开；按 `Esc` 或 `Ctrl+C` 会停止 API server，便于更新代码后重启。

直接用 Node 启动：

```powershell
node Apps/Api/server.js
```

默认端口：`5177`。

工作台入口：`http://127.0.0.1:5177/`。

运行追踪页：`http://127.0.0.1:5177/debug`。

已提供：

- `POST /api/workspaces/:workspaceId/sample-videos`
- `GET /api/processing-jobs/:jobId`
- `GET /api/sample-videos/:sampleVideoId/artifact`
- `GET /api/debug/traces`
- `GET /runtime/...`

内部编排层说明见 [lib/README.md](lib/README.md)。
