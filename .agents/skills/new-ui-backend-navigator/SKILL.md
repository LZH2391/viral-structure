---
name: new-ui-backend-navigator
description: 新 UI 开发后端导航器。用于开发或审查 ByteDanceFullStack 新 UI 时快速定位平台 API、旧业务接口、后端实现、模块/workflow 定义、trace/artifact/action 合同和相关测试；当用户提到新 UI、新工作台、平台 API、后端索引、接口位置、资源/动作/血缘/trace/运行状态定位时使用。
---

# 新 UI 后端导航器

## 工作方式

优先回答“新 UI 需要从哪里读、调哪个接口、后端代码在哪里、改动要验证什么”。

先读：

- `references/新UI后端索引速查.md`：快速定位 UI 需求到 API、前端 client、后端文件和测试。

需要平台合同细节时再读：

- `references/后端数据目录与平台能力抽象.md`：资源、artifact、runtime state、action、command、trace、错误合同和稳定边界。

## 判断规则

- 新 UI 的资源列表、详情、动作、血缘、trace、运行状态，优先走 `Apps/Workbench/src/api/platformClient.ts`。
- 上传、完整分析、素材识别、Agent 对话、Storyboard、生图等页面级流程，继续复用 `Apps/Workbench/src/api/client.ts` 中的旧业务接口。
- 不让前端直接读 Runtime 本地文件、绝对路径或文件名规则。
- 不在新 UI 里硬编码动作可用性；读取 resource actions，再执行 platform command 或旧业务接口。
- 后端 `traceId` 是权威 trace；前端本地行为用 `uiTraceId`，不要混用。

## 输出偏好

定位类问题直接给：

1. 推荐前端调用。
2. HTTP API。
3. 后端实现文件。
4. 相关类型或测试入口。
5. 当前不承诺或需要旧接口兜底的边界。

实施类问题先确认是否只是 UI 组合。如果要新增核心能力、模型链路、数据流或返工流程，必须同时对照 `Docs/Architecture/基础架构约束.md` 和 `Docs/Architecture/Debug追踪规范.md`。
