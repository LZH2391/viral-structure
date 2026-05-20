# Debug 追踪规范

## 定位

本文档定义核心能力的通用 Debug 追踪协议。任何新增核心流程、模型链路、媒体处理、返工重跑、结构迁移或结果生成能力，都必须按本文档设计日志、trace、DebugSnapshot 和 artifact 血缘。

目标不是记录更多日志，而是让问题能被稳定定位：

- 哪一次运行出了问题。
- 哪个阶段出了问题。
- 输入和输出摘要是什么。
- 产物来自哪里。
- 失败是否可重试。
- 下游如何继续追踪。

## 1. 核心概念

### Trace

一次完整运行链路。

必须包含：

- `runId`：一次运行或工作区操作。
- `traceId`：贯穿主链路的追踪 ID。
- `stageId`：当前阶段 ID。

后端主链路的 `traceId` 是权威 trace。前端如需记录本地 UI 行为，应使用 `uiTraceId`，不要和后端 `traceId` 混用。

### Stage

一个可追踪的处理步骤。

命名规则：

```text
领域.动作
```

示例：

- `sample.ingest`
- `sample.process`
- `sample.understand`
- `structure.analyze`
- `content.model`
- `structure.transfer`
- `result.review`
- `version.rerun`

禁止使用含义不清的名字，例如 `step1`、`process`、`done`、`test`。

### Artifact

阶段输入或输出的核心产物。

任何核心产物必须具备：

- `artifactId`
- `parentArtifactId`
- `artifactType`
- `stageName`
- `createdAt`

如果产物没有父级，`parentArtifactId` 填 `null`，不要省略字段。

## 2. Stage 日志

每个核心 stage 必须记录三类结构化事件：

```text
stage.start
stage.end
stage.fail
```

Stage 日志必须能还原以下审计字段：

- `event`
- `runId`
- `traceId`
- `stageId`
- `stageName`
- `artifactId`
- `parentArtifactId`
- `inputSummary`
- `outputSummary`
- `durationMs`
- `errorSummary`
- `createdAt`

这些字段不要求在每一条 jsonl 事件中物理重复。实现可以把公共上下文拆到 `trace.start`、`trace.meta`、stage 上下文或索引文件中，事件行只记录变化字段；但读取、展示、导出或审计时，必须能还原出完整字段集合。

缺失值在还原后的视图中填 `null`，不要省略字段。

Stage 日志应保持轻量：

- 普通事件行只放可检索摘要和变化字段。
- `runId`、`traceId` 等链路公共字段可以按 trace 记录一次。
- `inputSummary` 通常由 `stage.start` 记录，`stage.end` 不应重复同一份输入摘要，除非结束时输入摘要发生了有意义的修正。
- `stage.end` 只记录输出摘要、耗时和最终产物引用。
- 详细诊断信息进入 DebugSnapshot，不进入普通 stage log。

### stage.start

用于说明阶段开始处理什么。

必须包含：

- 当前 `stageName`。
- 上游 `parentArtifactId`。
- 输入摘要 `inputSummary`。

不得写入完整素材内容、完整 prompt、用户隐私或完整本地路径。

### stage.end

用于说明阶段成功产出了什么。

必须包含：

- 输出 `artifactId`。
- 输出摘要 `outputSummary`。
- 耗时 `durationMs`。

### stage.fail

用于说明阶段为什么失败。

必须包含：

- 结构化错误码。
- 用户可理解的安全错误摘要。
- 是否可重试。
- DebugSnapshot 引用。

普通日志不得记录完整异常堆栈、完整 FFmpeg stderr、完整 prompt 或完整素材内容。

## 3. DebugSnapshot

DebugSnapshot 用于保存受控调试细节。普通日志只放摘要，完整或半完整调试信息进入 DebugSnapshot。

每个 DebugSnapshot 必须包含：

- `snapshotId`
- `runId`
- `traceId`
- `stageId`
- `stageName`
- `artifactId`
- `parentArtifactId`
- `createdAt`
- `reason`
- `inputSummary`
- `outputSummary`
- `debugPayload`

`debugPayload` 可包含：

- FFmpeg 命令摘要。
- FFmpeg stderr 摘要。
- 模型输入摘要。
- 模型输出摘要。
- prompt/template 版本。
- schema 校验错误。
- 解析失败原因。
- 重试次数和重试结果。
- 关键参数。

`debugPayload` 禁止包含：

- 完整敏感素材。
- 完整 prompt。
- 用户隐私。
- 大体积原始文件内容。
- 未脱敏的完整本地路径。

## 4. Artifact 血缘

下游产物必须能追溯上游产物。

示例：

```text
原始视频 artifact
-> 标准化视频 artifact
-> 封面帧 artifact
-> 抽帧 artifact
-> 结构卡 artifact
-> 迁移方案 artifact
```

要求：

- 新产物必须记录 `parentArtifactId`。
- 重跑、返工、分支必须保留旧产物来源。
- 下游逻辑不得静默覆盖上游核心产物。
- 如果一个阶段产出多个派生产物，每个派生产物都要独立记录 artifact 信息。

## 5. 前后端追踪关系

后端主链路 trace 是权威来源。

前端要求：

- 上传或触发任务后，必须展示后端返回的 `traceId`。
- 前端本地 UI 行为如需追踪，使用 `uiTraceId`。
- 前端日志不得伪造后端 `traceId`。
- 前端错误展示只显示安全摘要，不显示完整 stack、完整路径或敏感内容。

后端要求：

- API 返回任务信息时必须包含 `traceId`。
- 状态查询应能返回当前 stage、状态、进度和安全错误摘要。
- artifact 查询应返回产物血缘信息。

## 6. 新功能 Debug 四问

任何新增核心能力在实现前必须回答：

- 这个功能有哪些 stage？
- 每个 stage 输入什么、产出什么 artifact？
- 失败时 DebugSnapshot 记录什么？
- 下游如何根据 `traceId` 定位问题？

如果回答不清，先补设计，再实现。

## 7. 审查标准

新增或修改核心流程时，至少检查：

- 是否存在清晰的 stage 清单。
- 每个核心 stage 是否有 `stage.start / stage.end / stage.fail`。
- 还原后的日志视图字段是否完整，缺失值是否显式为 `null`。
- 是否存在裸 `console.log / print / dump`。
- 普通日志是否写入敏感内容。
- 失败是否生成 DebugSnapshot。
- DebugSnapshot 是否保存受控摘要，而不是裸写完整敏感内容。
- artifact 是否能追溯父级。
- 前端是否混用后端 `traceId` 和本地 `uiTraceId`。
- 返工、分支、重跑是否保留新旧版本关系。
