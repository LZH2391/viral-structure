import type { SampleArtifact, WorkflowRun } from "../types";

export const FULL_ANALYSIS_DRAFT_STORAGE_KEY = "full-analysis:last-run";

export type FullAnalysisDraft = {
  workflowRunId: string;
  sampleVideoId?: string | null;
  traceId?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  sampleArtifact?: SampleArtifact | null;
};

export function readFullAnalysisDraft(): FullAnalysisDraft | null {
  try {
    return JSON.parse(localStorage.getItem(FULL_ANALYSIS_DRAFT_STORAGE_KEY) ?? "null") as FullAnalysisDraft | null;
  } catch {
    localStorage.removeItem(FULL_ANALYSIS_DRAFT_STORAGE_KEY);
    return null;
  }
}

export function writeFullAnalysisDraft(run: WorkflowRun, sampleArtifact?: SampleArtifact | null) {
  localStorage.setItem(FULL_ANALYSIS_DRAFT_STORAGE_KEY, JSON.stringify({
    workflowRunId: run.workflowRunId,
    sampleVideoId: run.sampleVideoId ?? sampleArtifact?.sampleVideoId ?? null,
    traceId: run.traceId ?? null,
    status: run.status ?? null,
    updatedAt: run.updatedAt ?? null,
    sampleArtifact: sampleArtifact ?? null,
  }));
}
