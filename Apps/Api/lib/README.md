# API Lib

`Apps/Api/lib` 是 API server 的应用编排层。

它连接 HTTP 路由、运行时存储、ThreadPool/AppServer、artifact index、stage log 和各类分析 service。这里可以编排流程，但不应把模型提示词、媒体处理细节、UI 文案或一次性调试脚本散进主链路。

## 主要入口

- `server.js`：HTTP 路由入口在上层 `Apps/Api/server.js`，这里的模块被 server 组合使用。
- `sample-processing-service.js`：样例上传、媒体处理、基础 artifact 写入。
- `shot-boundary-service.js`：切镜专用主链路。
- `analysis-role-registry.js`：descriptor 驱动的分析能力目录。
- `analysis-role-definition.js`：通用 role definition helper。
- `analysis-runtime-v2/`：分析类 role service 复用的运行时骨架。
- `threadpool-proxy.js`：后端访问本地 ThreadPool HTTP 服务。
- `appserver-bridge.js` / `appserver_bridge.py`：后端访问 Codex AppServer。
- `artifact-reader.js` / `sample-video-artifact.js`：读取和组织样例 artifact。
- `job-store.js`：处理任务状态持久化。
- `api-request-debug.js`、`sample-processing-debug.js`、`ui-debug-events.js`：API 与前端 UI 调试事件入口。

## 分析能力目录

脚本段落、节奏结构、包装结构已经收口到 descriptor registry：

- `script-segment/analysis-definition.js`
- `rhythm-structure/analysis-definition.js`
- `packaging-structure/analysis-definition.js`

新增同类分析能力时，优先新增 definition 并注册到 `analysis-role-registry.js`。不要在 server route、client、hook 和 helper 中重复新增散落的 kind 分支。

长期说明见：

- `Docs/Architecture/Analysis Role Registry.md`

## 分层约定

- API lib 可以做应用编排、依赖注入、错误转译和安全摘要。
- 模型调用应通过 ThreadPool/AppServer 统一入口，不直接散落在 HTTP handler 里。
- artifact / history / cache 写入必须保留 `artifactId`、`parentArtifactId`、`traceId` 等追踪信息。
- 失败路径必须进入结构化日志和受控 DebugSnapshot，不裸写完整 prompt、路径或素材内容。
- 兼容 wrapper 可以保留，但完整配置应尽量放到 definition 或 descriptor 中。

## 测试入口

常用定向测试：

```powershell
node --test Tests/unit/analysis-runtime-v2.test.js Tests/unit/server.test.js
node --test Tests/unit/script-segment-service-flow.test.js Tests/unit/script-segment-cache-trace.test.js Tests/unit/script-segment-input.test.js
node --test Tests/unit/rhythm-structure-service.test.js Tests/unit/packaging-structure-service.test.js
```
