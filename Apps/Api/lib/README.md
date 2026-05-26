# API Lib

`Apps/Api/lib` 是 API server 的应用编排层。

它连接 HTTP 路由、运行时存储、ThreadPool/AppServer、artifact index、stage log 和各类分析 service。这里可以编排流程，但不应把模型提示词、媒体处理细节、UI 文案或一次性调试脚本散进主链路。

## 主要入口

- `server.js`：HTTP 路由入口在上层 `Apps/Api/server.js`，这里的模块被 server 组合使用。
- `modules/registry.js` / `modules/definition.js` / `modules/catalog.js`：后端权威模块目录和安全投影。
- `executors/registry.js`：可复用执行器目录，封装本地 service、ThreadPool role、AppServer turn 等执行方式。
- `workflows/full-analysis/service.js` / `workflows/full-analysis/descriptor.js`：完整分析 workflow 运行时与编排 descriptor。
- `gateways/appserver/bridge.js` / `gateways/threadpool/proxy.js`：后端访问 AppServer 与 ThreadPool 的 gateway。
- `http/`：HTTP 工具、multipart、静态文件、runtime 文件和 capabilities。
- `stores/`：job、workflow run、analysis result、artifact reader 和 sample artifact 读写。
- `observability/`：API request debug、debug trace、UI debug event、thread message 摘要。
- `compatibility/`：旧结构分析接口和旧 shared API 的兼容投影。
- `sample-processing/service.js` / `sample-processing/debug.js`：样例上传、媒体处理、基础 artifact 写入和上传阶段调试校验。
- `shot-boundary/service.js`：切镜专用主链路。
- `script-segment/service.js` / `rhythm-structure/service.js` / `packaging-structure/service.js`：结构分析 service 入口。
- `analysis-runtime-v2/`：分析类 role service 复用的运行时骨架。

## 模块与分析能力目录

样例导入、切镜、脚本段落、节奏结构、包装结构已经收口到 module descriptor：

- `sample-processing/module-definition.js`
- `shot-boundary/module-definition.js`
- `script-segment/analysis-definition.js`
- `rhythm-structure/analysis-definition.js`
- `packaging-structure/analysis-definition.js`

结构分析的旧入口仍通过 `compatibility/analysis-role-registry.js` 投影：

- `script-segment/analysis-definition.js`
- `rhythm-structure/analysis-definition.js`
- `packaging-structure/analysis-definition.js`

新增同类能力时，优先新增 module definition 并注册到 `modules/catalog.js`。如果要进入完整分析，修改 workflow descriptor；不要在 server route、client、hook 和 helper 中重复新增散落的 kind 分支。

长期说明见：

- `Docs/Architecture/模块注册体系.md`
- `Docs/Architecture/Analysis Role Registry.md`

## 分层约定

- API lib 可以做应用编排、依赖注入、错误转译和安全摘要。
- 模型调用应通过 executor registry、ThreadPool/AppServer 统一入口，不直接散落在 HTTP handler 里。
- artifact / history / cache 写入必须保留 `artifactId`、`parentArtifactId`、`traceId` 等追踪信息。
- 失败路径必须进入结构化日志和受控 DebugSnapshot，不裸写完整 prompt、路径或素材内容。
- 兼容 wrapper 可以保留，但完整配置应尽量放到 definition 或 descriptor 中。

## 测试入口

常用定向测试：

```powershell
node --test Tests/unit/executor-registry.test.js Tests/unit/workflow-runtime.test.js Tests/unit/analysis-runtime-v2.test.js Tests/unit/server.test.js
node --test Tests/unit/script-segment-service-flow.test.js Tests/unit/script-segment-cache-trace.test.js Tests/unit/script-segment-input.test.js
node --test Tests/unit/rhythm-structure-service.test.js Tests/unit/packaging-structure-service.test.js
```
