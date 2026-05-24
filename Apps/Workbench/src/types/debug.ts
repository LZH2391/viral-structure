export type StageLevel = "info" | "done" | "fail";

export type ErrorSummary = {
  code?: string;
  message?: string;
  debugSnapshotUri?: string | null;
  stageName?: string | null;
  retryable?: boolean | null;
  preAgentFailure?: boolean | null;
  turnSubmitted?: boolean | null;
};

export type UiLog = {
  id: string;
  event: string;
  level: StageLevel;
  time: string;
  fields: LogFields;
};

export type LogFields = {
  runId: string;
  uiTraceId: string;
  backendTraceId?: string | null;
  stageId: string;
  artifactId: string;
  parentArtifactId?: string | null;
  stageName?: string;
  errorName?: string;
  errorCode?: string;
  errorStage?: string | null;
  errorMessage?: string;
  canRetry?: boolean;
  debugSnapshotId?: string;
  debugSnapshotUri?: string | null;
  inputSummary?: unknown;
  outputSummary?: unknown;
  durationMs?: number | null;
};

export type DebugSnapshot = {
  id: string;
  runId: string;
  uiTraceId: string;
  backendTraceId?: string | null;
  stageId: string;
  stageName: string;
  artifactId: string;
  parentArtifactId: string | null;
  createdAt: string;
  payload: unknown;
};

export type DebugTraceSummary = {
  traceId: string;
  latestEvent?: string | null;
  latestStageName?: string | null;
};

export type DebugEvent = {
  event?: string;
  stage?: string;
  stageName?: string;
  relatedTraceId?: string | null;
  createdAt?: string;
  time?: string;
  inputSummary?: unknown;
  outputSummary?: unknown;
  summary?: unknown;
  errorSummary?: unknown;
};

export type DebugTraceDetail = {
  traceId: string;
  logUri: string;
  events: DebugEvent[];
};

export type UiStageEvent = "stage.start" | "stage.end" | "stage.fail";

export type UiDebugEventRequest = {
  uiTraceId: string;
  backendTraceId?: string | null;
  runId: string;
  stageId: string;
  stageName: string;
  event: UiStageEvent;
  artifactId: string | null;
  parentArtifactId: string | null;
  inputSummary?: unknown;
  outputSummary?: unknown;
  durationMs?: number | null;
  errorSummary?: {
    code?: string | null;
    message?: string | null;
    stageName?: string | null;
    retryable?: boolean | null;
    debugSnapshotUri?: string | null;
  } | null;
  debugPayload?: unknown;
};
