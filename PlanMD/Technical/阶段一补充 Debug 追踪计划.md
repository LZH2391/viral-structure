# 阶段一补充 Debug 追踪计划

## Summary

目标：让“样例视频输入与处理”完全对齐 [Debug追踪规范](C:/ByteDanceFullStack/Docs/Architecture/Debug追踪规范.md)。当前已有 trace、stage log、失败 snapshot 和前端运行日志，但还缺统一字段、规范 stage 名、完整 `stage.start/end/fail`、后端权威 trace 贯通，以及 FFmpeg 调试摘要。

本次只补 Debug 追踪，不改变上传、FFmpeg 处理、artifact 生成和工作台主流程。

## Implementation Changes

### 后端 Stage 追踪

统一阶段一 stage 名称：

- `sample.upload.received`
- `sample.upload.validated`
- `sample.source.saved`
- `sample.metadata.probed`
- `sample.cover.extracted`
- `sample.frames.extracted`
- `sample.audio.extracted`
- `sample.artifact.written`

每个 stage 必须写：

- `stage.start`
- `stage.end`
- `stage.fail`

统一日志字段：

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

改造 `Infrastructure/Observability/stage-logger.js`：保留现有写入 JSONL 的方式，但输出字段改为规范字段，缺失值填 `null`。

### FFmpeg Debug 摘要

改造媒体处理链路，让 `ffprobe/ffmpeg` 失败时能进入 DebugSnapshot：

- `commandSummary`：命令名和参数摘要，不写完整敏感路径。
- `stderrSummary`：截断后的 stderr 摘要。
- `exitCode`：退出码。
- `retryable`：第一版默认 `false`。
- `mediaOperation`：`metadata.probe`、`cover.extract`、`frames.extract`、`audio.extract`。

普通 stage log 只写安全错误摘要，完整 stderr 不进普通日志。

### DebugSnapshot 结构

后端失败 snapshot 改为规范结构：

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

失败时 job 的 `errorSummary` 保留：

- `code`
- `message`
- `stageName`
- `debugSnapshotUri`

前端只展示这些安全字段。

### 前后端 Trace 关系

后端 `traceId` 是权威 trace。

前端调整：

- 本地 UI trace 改名为 `uiTraceId`。
- 上传成功后，运行追踪区域显示后端返回的 `traceId`。
- 前端本地 `stage.start/end/fail` 继续用于 UI 行为，但字段名不要伪装成后端主链路 trace。
- 前端失败日志优先展示后端 `errorSummary.debugSnapshotUri`。

### 测试补充

新增或调整测试：

- Stage logger contract：所有日志字段完整，缺失值为 `null`。
- Stage lifecycle unit：成功阶段有 start/end，失败阶段有 start/fail 和 snapshot。
- FFmpeg error unit：失败错误携带 `stderrSummary`、`commandSummary`、`mediaOperation`。
- Processing failure integration：损坏视频返回结构化错误和 `debugSnapshotUri`。
- Frontend trace unit：前端本地 trace 使用 `uiTraceId`，上传后展示后端 `traceId`。

## Acceptance Criteria

- `Runtime/DebugSnapshots/{traceId}.log.jsonl` 中每条日志都符合统一字段。
- 阶段一每个核心 stage 都能看到 start/end 或 start/fail。
- 任意失败任务都能从 job `errorSummary.debugSnapshotUri` 找到 DebugSnapshot。
- DebugSnapshot 中包含安全的 FFmpeg stderr 摘要，不包含完整本地路径或完整素材内容。
- 前端不再把 workspace id 当后端 `traceId` 使用。
- 默认测试 `node Tests/run-tests.js` 通过；新增 Debug 相关测试通过。
- 不引入裸 `console.log / print / dump`。
- 单业务文件仍保持 200 行以内，超过需拆分。

## Assumptions

- 本次不改 API 路径和主要响应结构，只补充字段。
- 本次不实现 DebugSnapshot 查看器，只提供 uri 和安全摘要。
- 本次不做模型链路 Debug，因为阶段一不接真实模型。
- 本次不要求成功阶段全部生成 DebugSnapshot，只要求完整 stage log；失败必须生成 DebugSnapshot。
