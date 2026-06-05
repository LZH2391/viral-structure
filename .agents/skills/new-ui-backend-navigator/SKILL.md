---
name: new-ui-backend-navigator
description: 新 UI 开发后端导航器。用于开发或审查 ByteDanceFullStack 新 UI 时快速定位平台 API、旧业务接口、后端实现、模块/workflow 定义、trace/artifact/action 合同和相关测试；当用户提到新 UI、新工作台、平台 API、后端索引、接口位置、资源/动作/血缘/trace/运行状态定位时使用。
---

# 新 UI 后端导航器

## 工作方式

优先回答“新 UI 需要从哪里读、调哪个接口、后端代码在哪里、改动要验证什么”。

## 检查约束

- 默认只做代码阅读、静态定位和必要的轻量文本检查。
- 禁止主动运行构建命令（如 `npm run build:*`、`vite build`、`tsc --noEmit` 等）。
- 禁止主动使用 Playwright、浏览器自动化、页面截图或浏览器实测检查。
- 只有当用户明确要求“构建 / build / 跑 Playwright / 浏览器检查 / 截图检查 / 实测页面”时，才运行对应检查。
- 如果完成改动后需要验证，默认在 final 中说明“未按约束运行构建或浏览器检查”，并给出用户可手动运行的命令建议。

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

## 接入决策树

遇到新 UI 需求时，先判断它属于哪一类：

- 资源目录、资源列表、资源详情、artifact 定位、血缘、trace、安全运行状态：走 `Apps/Workbench/src/api/platformClient.ts` 和 `/api/platform/v1/...`。
- 上传、完整分析、批量完整分析、素材识别、Agent 对话、Active Turn 旧控制、Storyboard、生图、FunctionSlot 深层业务页：继续走 `Apps/Workbench/src/api/client.ts` 的旧业务接口。
- 资源动作按钮、右键菜单、快捷键、命令面板：先读 resource actions，再执行 platform command 或明确的旧业务接口；不要在 UI 中自行判断动作是否可用。
- 页面需要组合多个资源时：优先组合 platform 资源能力；只有交互稳定且确有必要时，才考虑在 platform 能力之上增加轻量 projection。
- 如果需求会新增核心能力、模型链路、媒体处理、数据流、返工重跑或 artifact 生成：先对照 `Docs/Architecture/基础架构约束.md` 和 `Docs/Architecture/Debug追踪规范.md`，确认 stage、artifact 血缘、trace、DebugSnapshot 和失败处理。

## 架构红线

审查或实施新 UI 时，发现以下情况要明确指出：

- UI component 承载业务推理、模型调用、媒体处理、artifact 写入、cache 决策或 Runtime 文件解析。
- API client 变成业务层，在里面拼装业务决策、动作可用性、artifact 血缘或页面状态机。
- hook 直接写 Runtime artifact、依赖本地绝对路径、猜文件名规则，或绕过后端事实源。
- platform 层重新实现 workflow、模型调用、媒体处理、分析逻辑，而不是转译到已有 service/runtime。
- 后端为新 UI 返回页面专用大对象，例如 `dashboardData`、`samplePageData`，绕过 resource/artifact/runtime state/action/command/trace 合同。
- 前端混用后端 `traceId` 和本地 `uiTraceId`，或展示完整 stack、本地路径、prompt、素材内容等敏感信息。
- 新增核心流程没有结构化 `stage.start`、`stage.end`、`stage.fail`，没有受控 DebugSnapshot，或 artifact 缺少 `parentArtifactId`。
- 返工、重跑、分支静默覆盖旧结果，无法追踪新旧版本关系。

## 审查输出

当用户要求 review、判断是否乱塞、或检查新 UI 架构时，按代码审查口径输出：

1. 先列问题，按严重程度排序，并给出文件和行号。
2. 每条问题说明违反的边界：平台接入、UI/业务分层、动作合同、trace 边界、artifact 血缘、Debug 规范、返工历史、敏感信息。
3. 每条问题给最小修复方向，避免直接扩成大重构。
4. 如果没有明显问题，说明已检查的范围和剩余风险。

任务卡可以按以下格式给：

```text
P<级别> <标题>
- 位置：<文件:行>
- 问题：<为什么违反边界>
- 最小修复：<应该挪到哪个 client/service/resolver/hook，或补哪个 trace/artifact/debug 合同>
- 验证：<推荐定向测试或 build 命令>
```

## 输出偏好

定位类问题直接给：

1. 推荐前端调用。
2. HTTP API。
3. 后端实现文件。
4. 相关类型或测试入口。
5. 当前不承诺或需要旧接口兜底的边界。

实施类问题先确认是否只是 UI 组合。如果要新增核心能力、模型链路、数据流或返工流程，必须同时对照 `Docs/Architecture/基础架构约束.md` 和 `Docs/Architecture/Debug追踪规范.md`。

审查类问题不要只给接口索引；必须同时判断是否违反“接入决策树”和“架构红线”。
