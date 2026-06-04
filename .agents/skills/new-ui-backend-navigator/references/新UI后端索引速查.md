# 新 UI 后端索引速查

## 用法

本文用于新 UI 开发时快速定位后端位置。平台合同细节见同目录的 `后端数据目录与平台能力抽象.md`。

原则：

- 新 UI 优先通过 `Apps/Workbench/src/api/platformClient.ts` 消费平台 API。
- 上传、完整分析、素材识别、Agent 对话等页面级流程仍复用 `Apps/Workbench/src/api/client.ts` 的旧业务接口。
- 不直接读取 Runtime 本地文件和绝对路径。
- 展示后端 `traceId`，前端本地行为另用 `uiTraceId`。

## 快速路径

| UI 需求 | 前端入口 | HTTP API | 后端实现 | 备注 |
| --- | --- | --- | --- | --- |
| 资源目录 | `getPlatformCatalog` | `GET /api/platform/v1/catalog` | `Apps/Api/lib/platform/resource-catalog.js` | 资源类型和能力 flags |
| 资源列表 | `listPlatformResources(kind)` | `GET /api/platform/v1/resources?kind=<kind>` | `Apps/Api/lib/platform/resource-resolver.js` | sample/workflowRun/job/activeTurn/conversation/module/trace |
| 资源摘要详情 | `getPlatformResource(kind, id)` | `GET /api/platform/v1/resources/:kind/:id` | `Apps/Api/lib/platform/resource-resolver.js` | 安全摘要，不是完整业务对象 |
| 可用动作 | `getPlatformResourceActions(kind, id)` | `GET /api/platform/v1/resources/:kind/:id/actions` | `Apps/Api/lib/platform/action-registry.js` | UI 不硬编码动作可用性 |
| 执行动作 | `executePlatformCommand` | `POST /api/platform/v1/commands` | `Apps/Api/lib/platform/command-dispatcher.js` | 重跑、缓存选择、停止 turn、归档会话 |
| 运行状态 | `getPlatformRuntimeState(kind, id)` | `GET /api/platform/v1/runtime-state/:kind/:id` | `Apps/Api/lib/platform/runtime-state-resolver.js` | workflowRun/job/activeTurn |
| Artifact 定位 | `getPlatformArtifact(artifactId)` | `GET /api/platform/v1/artifacts/:artifactId` | `Apps/Api/lib/platform/artifact-resolver.js` | 只返回安全 `/runtime/...` URI |
| 血缘图 | `getPlatformResourceLineage(kind, id)` | `GET /api/platform/v1/resources/:kind/:id/lineage` | `Apps/Api/lib/platform/lineage-resolver.js` | 当前重点覆盖 sample/artifact |
| 安全 trace | `getPlatformTrace(traceId)` | `GET /api/platform/v1/traces/:traceId` | `Apps/Api/lib/platform/trace-resolver.js` | 不直接读旧 debug 全量结构 |

## 页面级旧业务接口

| UI 需求 | 前端函数 | HTTP API | 后端位置 | 备注 |
| --- | --- | --- | --- | --- |
| 上传样例视频 | `uploadSampleVideo` | `POST /api/workspaces/:workspaceId/sample-videos` | `Apps/Api/server.js` + `Apps/Api/lib/sample-processing/service.js` | 工作台单视频入口 |
| 完整分析 | `startFullAnalysisRun` | `POST /api/workflows/full-analysis/runs` | `Apps/Api/lib/workflows/full-analysis/service.js` | 一键上传 + 切镜 + 结构分析 + 原子化 |
| 批量完整分析 | `startFullAnalysisBatchRun` | `POST /api/workflows/full-analysis/batch-runs` | `Apps/Api/lib/workflows/full-analysis/batch-queue.js` | 多视频队列 |
| 素材识别 | `startMaterialRecognitionRun` | `POST /api/workflows/material-recognition/runs` | `Apps/Api/lib/workflows/material-recognition/service.js` | 上传 + 切镜 + user-material-tagger |
| Workflow 轮询 | `getWorkflowRun` | `GET /api/workflows/runs/:workflowRunId` | `Apps/Api/lib/http/workflow-routes.js` | 完整 workflow 详情 |
| Job 轮询 | `getProcessingJob` | `GET /api/processing-jobs/:jobId` | `Apps/Api/server.js` + `Apps/Api/lib/stores/job-store.js` | 子任务详情 |
| 样例完整 artifact | `getSampleArtifact` | `GET /api/sample-videos/:sampleVideoId/artifact` | `Apps/Api/lib/stores/sample-video-artifact.js` | 工作台详情视图常用 |
| Agent 对话 | `startAgentChatThread` / `sendAgentChatMessage` | `/api/agent-chat/...` | `Apps/Api/lib/http/agent-chat-*.js` + `Apps/Api/lib/agent-chat/` | 仍是旧业务接口 |
| Active Turns | `listActiveTurns` / `stopActiveTurn` | `/api/active-turns...` | `Apps/Api/lib/active-turns/` | 运行中 turn 控制 |
| FunctionSlot Library | `getFunctionSlotLibraryItems` 等 | `/api/function-slot-library...` | `Apps/Api/lib/function-slot-library/` | 深层库能力暂未完全平台化 |
| Storyboard Prep | `autoRunShotStoryboardPrep` | `POST /api/function-slot-workflow/storyboard-prep/auto-run` | `Apps/Api/lib/agent-chat/shot-storyboard-*` | 自动分镜准备链路 |

## 模块与 workflow 定义

| 目标 | 文件 |
| --- | --- |
| 后端模块总目录 | `Apps/Api/lib/modules/catalog.js` |
| 模块定义约束 | `Apps/Api/lib/modules/definition.js` |
| 模块 registry | `Apps/Api/lib/modules/registry.js` |
| 完整分析 descriptor | `Apps/Api/lib/workflows/full-analysis/descriptor.js` |
| 素材识别 descriptor | `Apps/Api/lib/workflows/material-recognition/descriptor.js` |
| FunctionSlot workflow 模块定义 | `Apps/Api/lib/function-slot-workflow/module-definitions.js` |

## 前端已有可复用 UI

| 能力 | 文件 |
| --- | --- |
| 主工作台路由和多视图挂载 | `Apps/Workbench/src/components/WorkbenchApp.tsx` |
| 完整分析/素材识别页 | `Apps/Workbench/src/components/FullAnalysisApp.tsx` |
| 结果面板 | `Apps/Workbench/src/components/full-analysis/FullAnalysisResults.tsx` |
| 属性面板 | `Apps/Workbench/src/components/PropertyPanel.tsx` |
| Agent 对话页 | `Apps/Workbench/src/components/AgentChatApp.tsx` |
| Active Turns 页 | `Apps/Workbench/src/components/ActiveTurnsApp.tsx` |
| ThreadPool 页 | `Apps/Workbench/src/components/ThreadPoolApp.tsx` |
| 结构图谱页 | `Apps/Workbench/src/components/FunctionSlotGraphApp.tsx` |
| Debug 页 | `Apps/Workbench/src/components/DebugApp.tsx` |

## 约束文档

| 主题 | 文件 |
| --- | --- |
| 平台合同 | `.agents/skills/new-ui-backend-navigator/references/后端数据目录与平台能力抽象.md` |
| 架构底线 | `Docs/Architecture/基础架构约束.md` |
| Debug/trace 规范 | `Docs/Architecture/Debug追踪规范.md` |
| 模块注册体系 | `Docs/Architecture/模块注册体系.md` |

## 测试入口

| 改动范围 | 推荐命令 |
| --- | --- |
| 平台 API 后端 | `node --test Tests/unit/platform-*.test.js Tests/unit/api-request-debug.test.js` |
| Workbench 前端类型/构建 | `npm run build:workbench` |
| 单个 workflow/runtime 改动 | 优先找 `Tests/unit/*workflow*`、`Tests/unit/*runtime*` 定向测试 |

不要默认跑全量测试；除非改动范围已经跨多个核心流程。
