import { postUiDebugEvent } from "../api/client";
import type { UiDebugEventRequest, UiStageEvent } from "../types";
import { createId, sanitizeText } from "../utils/format";

export type UiStage = {
  runId: string;
  uiTraceId: string;
  backendTraceId?: string | null;
  stageId: string;
  stageName: string;
  artifactId: string;
  parentArtifactId: string | null;
  startedAt: number;
  inputSummary?: unknown;
};

type BeginStageOptions = {
  uiTraceId: string;
  backendTraceId?: string | null;
  stageName: string;
  parentArtifactId?: string | null;
  inputSummary?: unknown;
};

export function beginUiStage(options: BeginStageOptions): UiStage {
  return {
    runId: createId("run"),
    uiTraceId: options.uiTraceId,
    backendTraceId: options.backendTraceId ?? null,
    stageId: createId("stage"),
    stageName: options.stageName,
    artifactId: createId("artifact"),
    parentArtifactId: options.parentArtifactId ?? null,
    startedAt: performance.now(),
    inputSummary: options.inputSummary ?? null,
  };
}

export function emitUiStage(stage: UiStage, event: UiStageEvent, details: Partial<UiDebugEventRequest> = {}) {
  const durationMs = event === "stage.start" ? null : Math.max(0, Math.round(performance.now() - stage.startedAt));
  const payload: UiDebugEventRequest = {
    uiTraceId: stage.uiTraceId,
    runId: stage.runId,
    stageId: stage.stageId,
    stageName: stage.stageName,
    event,
    artifactId: details.artifactId ?? stage.artifactId,
    parentArtifactId: details.parentArtifactId ?? stage.parentArtifactId,
    inputSummary: details.inputSummary ?? (event === "stage.start" ? stage.inputSummary ?? null : null),
    outputSummary: details.outputSummary ?? null,
    durationMs: details.durationMs ?? durationMs,
    errorSummary: details.errorSummary ?? null,
    debugPayload: details.debugPayload ?? null,
  };
  void postUiDebugEvent(payload).catch(() => undefined);
}

export function safeErrorSummary(error: unknown, fallbackCode: string, fallbackMessage: string, retryable = true) {
  return {
    code: (error as { code?: string })?.code ?? fallbackCode,
    message: sanitizeText(error instanceof Error ? error.message : fallbackMessage, 160),
    retryable,
  };
}
