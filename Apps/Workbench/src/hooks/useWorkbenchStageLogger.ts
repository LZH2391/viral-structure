import { useCallback } from "react";
import { type WorkbenchAction } from "../state";
import type { LogFields, ProcessingJob } from "../types";
import { beginUiStage, emitUiStage, safeErrorSummary, type UiStage } from "../observability/uiStage";
import { createId } from "../utils/format";

type StageLoggerOptions = {
  uiTraceId: string;
  backendTraceId?: string | null;
  dispatch: (action: WorkbenchAction) => void;
};

export function useWorkbenchStageLogger(options: StageLoggerOptions) {
  const { uiTraceId, backendTraceId, dispatch } = options;

  const writeLog = useCallback(
    (event: string, level: "info" | "done" | "fail", fields: LogFields) => {
      dispatch({
        type: "add-log",
        fields,
        log: {
          id: createId("log"),
          event,
          level,
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          fields,
        },
      });
    },
    [dispatch],
  );

  const beginStage = useCallback(
    (stageName: string, parentArtifactId: string | null = null, inputSummary: unknown = null) => {
      const stage = beginUiStage({
        uiTraceId,
        backendTraceId: backendTraceId ?? null,
        stageName,
        parentArtifactId,
        inputSummary,
      });
      dispatch({ type: "set-active-stage", stageId: stage.stageId });
      writeLog("stage.start", "info", {
        runId: stage.runId,
        uiTraceId: stage.uiTraceId,
        backendTraceId: backendTraceId ?? null,
        stageId: stage.stageId,
        artifactId: stage.artifactId,
        parentArtifactId: stage.parentArtifactId,
        stageName,
        inputSummary,
      });
      emitUiStage(stage, "stage.start");
      return stage;
    },
    [backendTraceId, dispatch, uiTraceId, writeLog],
  );

  const finishStage = useCallback(
    (stage: UiStage, artifactId = stage.artifactId, outputSummary: unknown = null) => {
      const durationMs = Math.max(0, Math.round(performance.now() - stage.startedAt));
      writeLog("stage.end", "done", {
        runId: stage.runId,
        uiTraceId: stage.uiTraceId,
        backendTraceId: backendTraceId ?? null,
        stageId: stage.stageId,
        artifactId,
        parentArtifactId: stage.parentArtifactId,
        stageName: stage.stageName,
        outputSummary,
        durationMs,
      });
      dispatch({ type: "set-active-stage", stageId: stage.stageId });
      emitUiStage(stage, "stage.end", { artifactId, outputSummary, durationMs });
    },
    [backendTraceId, dispatch, writeLog],
  );

  const failStage = useCallback(
    (stage: UiStage, error: unknown, details: Partial<LogFields> & { processingJob?: ProcessingJob | null; debugPayload?: unknown } = {}) => {
      const summary = safeErrorSummary(error, details.errorCode ?? "unknown_error", details.errorMessage ?? "未知错误", details.canRetry ?? true);
      const errorInfo = {
        errorName: error instanceof Error ? error.name : "Error",
        errorCode: summary.code,
        errorStage: details.errorStage ?? details.processingJob?.stage ?? null,
        errorMessage: summary.message,
        canRetry: summary.retryable,
      };
      const snapshot = {
        id: createId("snapshot"),
        runId: stage.runId,
        uiTraceId: stage.uiTraceId,
        backendTraceId: details.backendTraceId ?? details.processingJob?.traceId ?? backendTraceId ?? null,
        stageId: stage.stageId,
        stageName: stage.stageName,
        artifactId: stage.artifactId,
        parentArtifactId: stage.parentArtifactId,
        createdAt: new Date().toISOString(),
        payload: { kind: "stage-failure", ...errorInfo, processingJob: details.processingJob ?? null },
      };
      dispatch({ type: "add-snapshot", snapshot });
      writeLog("stage.fail", "fail", {
        runId: stage.runId,
        uiTraceId: stage.uiTraceId,
        backendTraceId: snapshot.backendTraceId,
        stageId: stage.stageId,
        artifactId: stage.artifactId,
        parentArtifactId: stage.parentArtifactId,
        stageName: stage.stageName,
        ...errorInfo,
        debugSnapshotId: snapshot.id,
        debugSnapshotUri: details.debugSnapshotUri ?? null,
      });
      emitUiStage(stage, "stage.fail", {
        errorSummary: {
          code: errorInfo.errorCode,
          message: errorInfo.errorMessage,
          stageName: errorInfo.errorStage ?? stage.stageName,
          retryable: errorInfo.canRetry,
          debugSnapshotUri: details.debugSnapshotUri ?? null,
        },
        debugPayload: details.debugPayload ?? snapshot.payload,
      });
    },
    [backendTraceId, dispatch, writeLog],
  );

  return { writeLog, beginStage, finishStage, failStage };
}
