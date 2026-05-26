# Analysis Role Registry

## 定位

`Analysis Role Registry` 是旧分析接口兼容层，不再是新的权威能力目录。正式能力目录以 `模块注册体系.md` 和 `/api/modules` 为准。

它负责把结构分析类模块投影成旧接口仍然理解的 `analysisId` 视图：

- 前端和 API 用哪个 `analysisId` 启动。
- 任务依赖哪些上游 artifact。
- 产出写入哪个 artifact key / artifact type。
- 使用哪个 cache kind。
- 使用哪组 stage、文案和 UI metadata。
- 保持旧路由和 cache decision 分发兼容。

当前由 module registry 投影为 analysis role 的模块：

- `script-segments`
- `rhythm-structure`
- `packaging-structure`

`shot-boundary` 已纳入模块注册体系，但不是旧 `analysis-role` 分组的一员；它继续保留专用切镜接口和模块入口。`sample-ingest` 也已纳入模块注册，但不投影为 analysis role。

## 文件入口

后端核心入口：

- `Apps/Api/lib/compatibility/analysis-role-registry.js`
- `Apps/Api/lib/compatibility/analysis-role-definition.js`
- `Apps/Api/lib/modules/registry.js`
- `Apps/Api/lib/modules/catalog.js`
- `Apps/Api/lib/script-segment/analysis-definition.js`
- `Apps/Api/lib/rhythm-structure/analysis-definition.js`
- `Apps/Api/lib/packaging-structure/analysis-definition.js`

前端本地 metadata 入口：

- `Apps/Workbench/src/utils/analysisRoles.ts`

前端会优先读取 `/api/modules` 的安全投影，再把结构分析模块 metadata 合并到本地 panel 绑定。

兼容 service wrapper：

- `Apps/Api/lib/script-segment/service.js`
- `Apps/Api/lib/rhythm-structure/service.js`
- `Apps/Api/lib/packaging-structure/service.js`

这些 wrapper 只保留兼容导出，不再承载完整 service 配置。

## Descriptor 字段

旧 analysis role 视图来自 module descriptor。新增结构分析能力时，后端 definition 至少要说明：

- `moduleId`：模块稳定 ID，同时作为 analysis role 的 `analysisId`。
- `stageKind`：前端和草稿状态使用的本地分析类型。
- `serviceKey`：测试或 server 依赖注入时使用。
- `executorKind`：公开安全字段，当前结构分析模块走 `role-service` 兼容名，内部映射到可复用 executor。
- `legacyPathSegment`：旧 API 路由片段。
- `cacheKind`：cache decision 分发依据。
- `route` / `legacyRoute`：通用路由和兼容路由。
- `dependencies`：上游 artifact 依赖。
- `artifact`：结果 artifact key、history key、artifact type。
- `role`：ThreadPool role 名称。
- `stages`：运行时 stage 列表。
- `ui`：前端安全展示文案和运行文案。
- `startOptionsFromBody`：把请求 body 转成 service enqueue 参数。
- `createService`：兼容适配层，用于把旧 service 接入 executor registry；不要把长期执行逻辑散在这里。

## 公开 API

能力目录：

```text
GET /api/modules
GET /api/analysis-roles
```

`/api/modules` 是正式安全投影；`/api/analysis-roles` 是结构分析兼容投影。返回字段只允许包含前端安全信息：

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
- `supportsCacheReuse`
- `supportsRerun`
- `artifactPolicy`

不得暴露：

- 本地 `skillPath`
- 函数引用
- `createService`
- 内部 service 实例
- 仅用于依赖注入的 `serviceKey`
- `executorRef`
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
4. 在 `modules/catalog.js` 注册 definition；`analysis-role-registry.js` 会从 module registry 自动投影结构分析模块。
5. 保留或新增兼容 service wrapper，只导出公共兼容面。
6. 如前端已有固定 panel，在 `Apps/Workbench/src/utils/analysisRoles.ts` 补 surface 绑定；运行文案优先来自 `/api/modules`。
7. 如需要前端启动，优先调用 `startAnalysisRole(analysisId, sampleVideoId, options)`。
8. 如要进入完整分析，修改 `full-analysis` workflow descriptor，而不是改 runtime 里的模块 ID 表。
9. 补 module registry、server、workflow、frontend flow 和 service 定向测试。

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
- `moduleId`、`legacyPathSegment`、`cacheKind` 三类索引可查。
- `GET /api/modules` 不暴露内部字段。
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
