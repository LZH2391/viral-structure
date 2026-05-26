# 新增 ThreadPool Role 标准路线

## 定位

本文档定义新增一个 ThreadPool role 的标准接入路线，目标是让新 role 具备最小完整闭环：

- role 可注册
- profile 可加载
- prompt 可渲染
- service 可运行
- thread lease 可追踪
- artifact / cache / debug 可落地
- 测试可覆盖

本文档适用于当前仓库基于 `thread_roles.json + role profile + API service + ThreadPool runtime` 的接入方式。

注意：新增 ThreadPool role 只是新增执行供给，不等于新增模块。凡是要被 API、workflow 或前端稳定调用的能力，还必须接入 `模块注册体系.md` 中的 module descriptor；需要进入完整分析时，还要接入 workflow descriptor。

---

## 1. 先确认是否真的需要新 role

只有满足以下情况之一时，才建议新增 role：

- 新任务的输入输出契约与现有 role 明显不同
- prompt、修复策略、结果校验需要独立演进
- 线程复用、cache、调试、返工链路需要独立隔离

不建议因为以下原因新建 role：

- 只是同一任务的小字段变化
- 只是 prompt 文案轻微差异
- 只是临时试验一个参数

能在现有 role 内通过 schemaVersion、template version、策略参数解决的，优先不要扩 role。

---

## 2. 新增 role 的标准文件路径

当前标准接入链路如下：

1. `Infrastructure/ThreadPool/thread_roles.json`
2. `Assets/RoleProfiles/<role>/role.json`
3. `Assets/RoleProfiles/<role>/init.*`
4. `Assets/RoleProfiles/<role>/turn templates`
5. `Apps/Api/lib/<domain>-service.js`
6. `Apps/Api/lib/<domain>-analysis/*`
7. `Apps/Api/lib/<domain>/analysis-definition.js` 或 `module-definition.js`
8. `Apps/Api/lib/modules/catalog.js`
9. 如进入完整分析，`Apps/Api/lib/workflows/full-analysis/descriptor.js`
10. `Apps/Api/lib/gateways/threadpool/proxy.js` 与现有 acquire/release 路线
11. 对应测试文件

如果新增 role 需要新的主链路服务，优先仿照现有：

- `shot-boundary-service`
- `script-segment-service`

---

## 3. 标准接入步骤

### 步骤 1：注册 role

在 [thread_roles.json](C:/ByteDanceFullStack/Infrastructure/ThreadPool/thread_roles.json) 中增加 role 条目：

- `profile_path`
- `min_idle`

要求：

- role 名称要稳定、可读、单义
- 不要使用临时试验名

### 步骤 2：补 role profile

新增 `Assets/RoleProfiles/<role>/role.json`，至少定义：

- `role`
- `profileVersion`
- `init.template`
- `turnTemplates`

要求：

- `role` 必须与 `thread_roles.json` 中的 key 完全一致
- `profileVersion` 每次契约变化要可递增
- 所有模板文件路径必须可解析

### 步骤 3：补 init 与 turn template

至少准备：

- init 模板
- `analyze` 模板

如存在修复闭环，再补：

- `repair` 模板

要求：

- 模板占位符必须可由代码完整提供
- prompt 中要明确哪些输入是分析依据，哪些只是 metadata
- 不得把完整敏感内容、本地路径、无必要调试字段直接写给模型

### 步骤 4：补输入准备与输出契约

在 `Apps/Api/lib/<domain>-analysis/` 中定义：

- `prepareInput`
- `buildTurnInputs`
- `renderAnalyzeTurnInputs`
- 如需要，`renderRepairTurnInputs`
- `outputContract`

要求：

- manifest / metadata / lineage / visual-manifest 分层清楚
- 输出契约只要求模型产出它真正负责的字段
- 系统可派生字段不要反压给模型

### 步骤 5：补 service 编排

新增或扩展 service，使其具备完整 stage 编排：

- input prepared
- cache lookup / reuse（如适用）
- thread acquired
- turn submit
- turn collect
- validate
- repair submit / collect（如适用）
- result written

要求：

- 核心流程文件只做编排
- 媒体处理、模型调用、结果构建、cache 不要混写成一个大文件
- 单文件超过架构约束时要及时拆分

### 步骤 6：接入 ThreadPool lease 生命周期

沿用现有标准路线：

- `ensureRoleReady`
- `acquireLease`
- `releaseLease`
- 失败时 `cleanupLease`
- 不可恢复时 `discardThread`

要求：

- ownerId、traceId、threadId、leaseId 关系清晰
- 失败和中断都要能释放 lease
- 不得留下难追踪的孤儿线程

### 步骤 7：补 artifact、cache、history

根据任务性质补齐：

- 结果 artifact
- `parentArtifactId`
- revision / history
- cache 参数
- cache reuse 结果说明

要求：

- 不静默覆盖旧结果
- 新结果能追到旧结果
- cache 只依赖真正影响结果的字段

### 步骤 8：接入 Module Descriptor

如果该 role 背后是可独立运行、可追踪、可重跑、可产出核心结果的能力，必须新增 module descriptor：

- `moduleId`
- `moduleKind`
- `executorKind`
- `executorRef`
- `dependencies`
- `artifact`
- `cacheKind`
- `stages`
- `ui`
- `startOptionsFromBody`
- `getArtifact` / `buildCacheParams`

结构分析类 role 优先复用 `createShotBoundaryDependentRoleDefinition`，并在 `modules/catalog.js` 注册。`Analysis Role Registry` 只做旧接口投影，不再作为权威注册入口。

### 步骤 9：确认 Executor 边界

ThreadPool role 的执行方式应走 `threadpool-role` executor；不要把 ThreadPool lease 逻辑当成模块本身。若新增的是 AppServer turn 生命周期、外部 HTTP API 或远程任务队列，优先新增 executor，而不是把生命周期散写进模块 service。

要求：

- executor 只负责执行生命周期和安全摘要。
- module 负责 cache、artifact、业务校验和 result writer。
- workflow 只通过 module registry 调模块。

### 步骤 10：接入 Workflow Descriptor（如需要）

如果该能力要进入完整分析或其他 workflow，只修改 workflow descriptor：

- 增加 `node.moduleId`
- 设置 `after`
- 如可并行，加入 `parallelGroup`
- 如可重跑，标记 `rerunnable`
- 如失败应阻断 workflow，标记 `blocking`

不要在 workflow runtime 里新增模块 ID 常量或专门分支。

### 步骤 11：补日志与 DebugSnapshot

新增 role 必须满足 `Debug追踪规范`：

- 每个核心 stage 有 `stage.start / stage.end / stage.fail`
- 普通日志只记摘要
- 失败写 `DebugSnapshot`
- 记录 profile / template 版本、输入摘要、输出摘要、重试摘要

特别要记：

- `role`
- `profilePath`
- `profileVersion`
- `promptTemplateId`
- `promptTemplateVersion`
- `promptTemplateHash`

### 步骤 12：补最小测试闭环

至少覆盖：

- role profile 可加载
- module descriptor 可列出，并且 `/api/modules` 不暴露内部字段
- analyze prompt 可渲染
- 占位符齐全
- threadPool acquire / release 流程
- 输出校验
- repair 流程（如有）
- cache reuse（如有）
- artifact lineage
- stage log / debug snapshot 关键断言
- 如进入 workflow，descriptor 能生成节点并保持 rerun / partial failure 行为

---

## 4. 新 role 的最小交付标准

一个新 role 只有同时满足以下条件，才算接入完成：

- 能被 `thread_roles.json` 正常发现
- 能成功预热并获取 lease
- 能跑通至少一轮 analyze
- 输出能通过结构校验
- 失败时能生成安全错误摘要和 DebugSnapshot
- 结果能写入 artifact，并带 `parentArtifactId`
- 已注册 module descriptor；如面向前端，`/api/modules` 能返回安全投影
- 如进入完整分析，workflow descriptor 已接入
- 有最小测试覆盖

缺其中任一项，都不算完整接入。

---

## 5. 常见错误

### 1. 只加 profile，不加 service 闭环

后果：

- role 能注册但不能稳定运行

### 2. 只改 prompt，不改 output contract

后果：

- 模型输出和校验器脱节

### 3. 把 lineage / cache / path 暴露给模型

后果：

- 模型可见输入被污染
- 输出更容易混入系统字段

### 4. 没有 repair 路线却要求严格结构输出

后果：

- 一旦首轮输出轻微偏差，就只能整体失败

### 5. 只写成功路径，不写 lease 清理和 fail snapshot

后果：

- ThreadPool 残留脏状态
- 问题难定位

### 6. 只加 role，不加 module descriptor

后果：

- 能力只能被某个 service 私下调用
- 前端、workflow、cache decision 和 rerun 入口难以统一
- 后续新增四五个模块时会重新长出平行注册表

---

## 6. 推荐 checklist

新增 role 前后，至少逐项确认：

- 是否真的需要新 role，而不是现有 role 升级？
- `thread_roles.json` 是否已注册？
- role 名称与 profile 是否一致？
- init / analyze / repair 模板是否齐全？
- 模板占位符是否都有代码提供？
- manifest / metadata / lineage 分层是否清楚？
- service stage 是否完整？
- module descriptor 是否已注册？
- executor 边界是否清楚？
- 需要进入 workflow 时，workflow descriptor 是否已更新？
- lease 生命周期是否闭环？
- artifact / history / cache 是否可追踪？
- `stage.start / end / fail` 是否齐全？
- DebugSnapshot 是否落地？
- 最小测试是否覆盖成功、失败、修复、缓存中的相关路径？

---

## 7. 当前参考实现

建议优先参考现有两条链路：

- `shot-boundary-transformer`
  - service: [shot-boundary-service.js](C:/ByteDanceFullStack/Apps/Api/lib/shot-boundary-service.js)
  - input: [input.js](C:/ByteDanceFullStack/Apps/Api/lib/shot-boundary-analysis/input.js)
- `script-segment-analyzer`
  - service: [script-segment-service.js](C:/ByteDanceFullStack/Apps/Api/lib/script-segment-service.js)
  - input: [input.js](C:/ByteDanceFullStack/Apps/Api/lib/script-segment-analysis/input.js)

role profile 加载入口：

- [role-profile-loader.js](C:/ByteDanceFullStack/Apps/Api/lib/role-profile-loader.js)

ThreadPool gateway 入口：

- [proxy.js](C:/ByteDanceFullStack/Apps/Api/lib/gateways/threadpool/proxy.js)

ThreadPool role 注册入口：

- [thread_roles.json](C:/ByteDanceFullStack/Infrastructure/ThreadPool/thread_roles.json)

优先沿用现有路径，不另起一套平行机制。
