import type { SampleArtifact, WorkflowRun } from "../types";

export const FULL_ANALYSIS_DRAFT_STORAGE_KEY = "full-analysis:last-run";

export type FullAnalysisDraft = {
  workflowRunId?: string | null;
  batchRunId?: string | null;
  sampleVideoId?: string | null;
  traceId?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  activeSampleRevision?: number;
  activeSampleSource?: "workbench" | "fullAnalysis" | "materialRecognition" | "library";
  sampleArtifact?: SampleArtifact | null;
};

export function readFullAnalysisDraft(storageKey = FULL_ANALYSIS_DRAFT_STORAGE_KEY): FullAnalysisDraft | null {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "null") as FullAnalysisDraft | null;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

export function writeFullAnalysisDraft(run: WorkflowRun, sampleArtifact?: SampleArtifact | null, storageKey = FULL_ANALYSIS_DRAFT_STORAGE_KEY) {
  const current = readFullAnalysisDraft(storageKey);
  localStorage.setItem(storageKey, JSON.stringify({
    workflowRunId: run.workflowRunId,
    batchRunId: current?.batchRunId ?? null,
    sampleVideoId: run.sampleVideoId ?? sampleArtifact?.sampleVideoId ?? null,
    traceId: run.traceId ?? null,
    status: run.status ?? null,
    updatedAt: run.updatedAt ?? null,
    activeSampleRevision: current?.activeSampleRevision ?? 0,
    activeSampleSource: current?.activeSampleSource ?? "fullAnalysis",
    sampleArtifact: sampleArtifact ?? null,
  }));
}

export function writeFullAnalysisBatchDraft(batchRunId: string | null, storageKey = FULL_ANALYSIS_DRAFT_STORAGE_KEY) {
  const current = readFullAnalysisDraft(storageKey);
  localStorage.setItem(storageKey, JSON.stringify({
    ...current,
    batchRunId,
    updatedAt: new Date().toISOString(),
  }));
}

export function writeFullAnalysisActiveSampleDraft(
  sampleArtifact: SampleArtifact,
  options: { activeSampleRevision?: number; activeSampleSource?: FullAnalysisDraft["activeSampleSource"] } = {},
  storageKey = FULL_ANALYSIS_DRAFT_STORAGE_KEY,
) {
  const current = readFullAnalysisDraft(storageKey);
  localStorage.setItem(storageKey, JSON.stringify({
    ...current,
    sampleVideoId: sampleArtifact.sampleVideoId,
    activeSampleRevision: options.activeSampleRevision ?? current?.activeSampleRevision ?? 0,
    activeSampleSource: options.activeSampleSource ?? current?.activeSampleSource ?? "workbench",
    sampleArtifact,
  }));
}
