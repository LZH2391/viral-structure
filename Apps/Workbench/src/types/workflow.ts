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
