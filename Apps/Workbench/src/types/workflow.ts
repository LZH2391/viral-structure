import type { ErrorSummary } from "./debug";

export type WorkflowStageStatus = "pending" | "running" | "cache_waiting" | "processed" | "failed" | string;

export type WorkflowStageState = {
  key: "upload" | "shotBoundary" | "scriptSegment" | "rhythmStructure" | "packagingStructure" | "aggregate" | string;
  stageName: string;
  label: string;
  status: WorkflowStageStatus;
  attemptNo: number;
  stageId?: string | null;
  childJobId?: string | null;
  childTraceId?: string | null;
  artifactId?: string | null;
  parentArtifactId?: string | null;
  sampleVideoId?: string | null;
  outputSummary?: Record<string, unknown> | null;
  errorSummary?: ErrorSummary | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type WorkflowRun = {
  workflowRunId: string;
  workflowKey: "full-analysis" | string;
  workflowVersion: string;
  cacheDecision?: "ask" | "reuse" | "refresh" | string;
  options?: {
    enableFunctionSlotAtomization?: boolean;
    [key: string]: unknown;
  };
  context?: {
    targetConversationId?: string | null;
    bindMaterialToConversation?: boolean;
    materialPackBindingNotifiedAt?: string | null;
    [key: string]: unknown;
  };
  status: "running" | "cache_waiting" | "processed" | "failed" | "partial_failed" | string;
  traceId: string;
  runId: string;
  sampleVideoId?: string | null;
  currentStageKeys: string[];
  stages: WorkflowStageState[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  errorSummary?: ErrorSummary | null;
};

export type FullAnalysisBatchItemStatus = "queued" | "running" | "cache_waiting" | "processed" | "partial_failed" | "failed" | "canceled" | string;

export type FullAnalysisBatchItem = {
  queueItemId: string;
  batchRunId: string;
  workflowRunId?: string | null;
  sampleVideoId?: string | null;
  filename: string;
  mimeType?: string | null;
  size?: number | null;
  status: FullAnalysisBatchItemStatus;
  position: number;
  currentStageKeys: string[];
  currentStageLabel?: string | null;
  errorSummary?: ErrorSummary | null;
  retryable?: boolean;
  sourceFileAvailable?: boolean;
  lastFailure?: ErrorSummary | null;
  completionNotifiedAt?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
};

export type FullAnalysisBatchRun = {
  batchRunId: string;
  workflowKey: "full-analysis" | string;
  status: FullAnalysisBatchItemStatus;
  workspaceId: string;
  maxConcurrentRuns: number;
  options?: {
    enableFunctionSlotAtomization?: boolean;
    [key: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  restored?: boolean;
  items: FullAnalysisBatchItem[];
};
