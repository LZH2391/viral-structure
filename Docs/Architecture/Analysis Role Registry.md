# Analysis Role Registry

## 定位

`Analysis Role Registry` 是分析能力目录，不是单纯的后端路由表。

它负责把一个可运行的分析能力描述清楚：

- 前端和 API 用哪个 `analysisId` 启动。
- 任务依赖哪些上游 artifact。
- 产出写入哪个 artifact key / artifact type。
- 使用哪个 cache kind。
- 使用哪组 stage、文案和 UI metadata。
- 通过哪类 executor 执行。

当前已接入：

- `script-segments`
- `rhythm-structure`
- `packaging-structure`

`shot-boundary` 暂时仍是专用服务，不在本轮 registry 内。

## 文件入口

后端核心入口：

- `Apps/Api/lib/analysis-role-registry.js`
- `Apps/Api/lib/analysis-role-definition.js`
- `Apps/Api/lib/script-segment/analysis-definition.js`
- `Apps/Api/lib/rhythm-structure/analysis-definition.js`
- `Apps/Api/lib/packaging-structure/analysis-definition.js`

前端本地 metadata 入口：

- `Apps/Workbench/src/utils/analysisRoles.ts`

兼容 service wrapper：

- `Apps/Api/lib/script-segment-service.js`
- `Apps/Api/lib/rhythm-structure-service.js`
- `Apps/Api/lib/packaging-structure-service.js`

这些 wrapper 只保留兼容导出，不再承载完整 service 配置。

## Descriptor 字段

后端 definition 至少要说明：

- `analysisId`：通用启动入口使用的稳定 ID。
- `stageKind`：前端和草稿状态使用的本地分析类型。
- `serviceKey`：测试或 server 依赖注入时使用。
- `executorKind`：当前支持 `role-service`，预留 `custom-service`。
- `legacyPathSegment`：旧 API 路由片段。
- `cacheKind`：cache decision 分发依据。
- `route` / `legacyRoute`：通用路由和兼容路由。
- `dependencies`：上游 artifact 依赖。
- `artifact`：结果 artifact key、history key、artifact type。
- `role`：ThreadPool role 名称。
- `stages`：运行时 stage 列表。
- `ui`：前端安全展示文案和运行文案。
- `startOptionsFromBody`：把请求 body 转成 service enqueue 参数。
- `createService`：创建实际 executor。

## 公开 API

能力目录：

```text
GET /api/analysis-roles
```

返回字段只允许包含前端安全信息：

- `analysisId`
- `stageKind`
- `cacheKind`
- `artifactKey`
- `artifactType`
- `route`
- `legacyRoute`
- `dependencies`
- `ui`
- `stages`

不得暴露：

- 本地 `skillPath`
- 函数引用
- `createService`
- 内部 service 实例
- 仅用于依赖注入的 `serviceKey`
- executor 内部实现细节

通用启动入口：

```text
POST /api/sample-videos/:sampleVideoId/analyses/:analysisId
```

旧接口继续保留：

```text
POST /api/sample-videos/:sampleVideoId/script-segments
POST /api/sample-videos/:sampleVideoId/rhythm-structure
POST /api/sample-videos/:sampleVideoId/packaging-structure
```

## 前端使用规则

前端保留现有三个按钮和三个 panel，不做全动态渲染。

但运行流应优先消费本地 `analysisRoles` metadata：

- `analysisId`
- `cacheKind`
- `artifactKey`
- `stageId`
- 初始 stage
- cache lookup stage
- 完成、失败、刷新、复用文案
- stage label
- artifact id / parent artifact id 读取函数

避免在 `useAnalysisJobFlow`、cache reuse / refresh、stage label 中新增三段 ternary 或散落的 kind 判断。

## 新增分析能力步骤

新增一个同类分析 role 时，优先按以下顺序：

1. 确认它是否真的需要独立 role，参考 `新增ThreadPoolRole标准路线.md`。
2. 新建 `Apps/Api/lib/<domain>/analysis-definition.js`。
3. 如果依赖切镜结果，优先复用 `createShotBoundaryDependentRoleDefinition`。
4. 在 `analysis-role-registry.js` 注册 definition。
5. 保留或新增兼容 service wrapper，只导出公共兼容面。
6. 在 `Apps/Workbench/src/utils/analysisRoles.ts` 补前端 metadata。
7. 如需要前端启动，优先调用 `startAnalysisRole(analysisId, sampleVideoId, options)`。
8. 补 registry、server、frontend flow 和 service 定向测试。

不要把新 role 的配置拆回 server route、API client、hook、helper 多处硬编码。

## Trace 与 Debug 要求

Registry 只负责能力目录和分发，不降低核心流程的可观测性要求。

每个实际 executor 仍必须满足：

- 主链路携带 `runId / traceId / stageId / artifactId / parentArtifactId`。
- 核心 stage 有 `stage.start / stage.end / stage.fail`。
- 失败生成受控 `DebugSnapshot`。
- 模型调用记录 role、profile/template 版本、输入摘要、输出摘要、解析和重试信息。
- cache reuse、refresh、rerun 保留 artifact lineage。

具体规则以 `Debug追踪规范.md` 为准。

## 测试建议

至少覆盖：

- definition 字段完整。
- `analysisId`、`legacyPathSegment`、`cacheKind` 三类索引可查。
- `GET /api/analysis-roles` 不暴露内部字段。
- 通用 route 可启动分析。
- 旧 route 仍可启动分析。
- cache decision 仍按 `cacheKind` 分发。
- 前端 API wrapper 仍存在，但内部走通用入口。
- `useAnalysisJobFlow` 从 metadata 取 runner、artifact、stage 和文案。

常用定向测试：

```powershell
node --test Tests/unit/analysis-runtime-v2.test.js Tests/unit/server.test.js Tests/unit/frontend-trace.test.js
node --test Tests/unit/rhythm-structure-service.test.js Tests/unit/packaging-structure-service.test.js
node --test Tests/unit/script-segment-service-flow.test.js Tests/unit/script-segment-cache-trace.test.js Tests/unit/script-segment-input.test.js
```
