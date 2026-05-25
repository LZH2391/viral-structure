# Workbench Src

`Apps/Workbench/src` 是 React 工作台源码入口。

本层负责用户交互、状态展示、API 调用和本地 UI trace。核心业务判断、模型调用、artifact 写入和 cache 逻辑应在后端完成。

## 目录分工

- `api/`：前端 API client，只封装 HTTP 调用和响应解析。
- `components/`：页面、面板、对话框和可视化组件。
- `hooks/`：用户流程 hook，例如上传、切镜、分析 job、字幕草稿、播放同步。
- `observability/`：前端 UI stage log 和本地 uiTrace。
- `types/`：前端共享类型。
- `utils/`：纯工具、domain metadata、本地草稿读写和工作台 helper。
- `workers/`：浏览器 worker，例如音频波形解码。

## 分析能力接入

脚本段落、节奏结构、包装结构的前端运行配置集中在：

- `utils/analysisRoles.ts`

运行流入口：

- `hooks/useAnalysisJobFlow.ts`
- `utils/workbenchHelpers.ts`
- `api/client.ts`

新增同类分析能力时，优先补 `analysisRoles.ts` metadata，再让通用 flow 消费它。避免在 hook、helper、cache dialog 和 stage label 中新增散落的三段分支。

## Trace 边界

前端使用本地 `uiTraceId` 记录 UI 行为。

后端返回的 `traceId` 是主链路权威 trace。前端只展示、传递和关联它，不伪造后端 trace。

错误展示应使用后端安全摘要或前端安全 fallback，不展示完整 stack、本地路径、prompt 或素材内容。

## 改动建议

- UI 组件只负责展示和交互，不承载后端业务推理。
- API client 保持薄层，不在这里拼业务决策。
- hook 可以编排前端工作流，但不要直接写 runtime artifact。
- 本地草稿只保存恢复 UI 所需的最小状态。
- 高频变化的分析文案、stage label 和 artifact key 放到 metadata。
