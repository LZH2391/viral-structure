# Observability

观测与调试能力。

负责结构化日志、trace、阶段开始/结束/失败记录和受控 DebugSnapshot。

主链路必须携带 `runId`、`traceId`、`stageId`、`artifactId`、`parentArtifactId`，确保问题可以定位到具体操作、阶段和产物。
