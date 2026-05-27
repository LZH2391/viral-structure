import type { SampleArtifact, WorkflowRun } from "../types";

export const FULL_ANALYSIS_DRAFT_STORAGE_KEY = "full-analysis:last-run";

export type FullAnalysisDraft = {
  workflowRunId?: string | null;
  sampleVideoId?: string | null;
  traceId?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  activeSampleRevision?: number;
  activeSampleSource?: "workbench" | "fullAnalysis" | "library";
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
  const current = readFullAnalysisDraft();
  localStorage.setItem(FULL_ANALYSIS_DRAFT_STORAGE_KEY, JSON.stringify({
    workflowRunId: run.workflowRunId,
    sampleVideoId: run.sampleVideoId ?? sampleArtifact?.sampleVideoId ?? null,
    traceId: run.traceId ?? null,
    status: run.status ?? null,
    updatedAt: run.updatedAt ?? null,
    activeSampleRevision: current?.activeSampleRevision ?? 0,
    activeSampleSource: current?.activeSampleSource ?? "fullAnalysis",
    sampleArtifact: sampleArtifact ?? null,
  }));
}

export function writeFullAnalysisActiveSampleDraft(
  sampleArtifact: SampleArtifact,
  options: { activeSampleRevision?: number; activeSampleSource?: FullAnalysisDraft["activeSampleSource"] } = {},
) {
  const current = readFullAnalysisDraft();
  localStorage.setItem(FULL_ANALYSIS_DRAFT_STORAGE_KEY, JSON.stringify({
    ...current,
    sampleVideoId: sampleArtifact.sampleVideoId,
    activeSampleRevision: options.activeSampleRevision ?? current?.activeSampleRevision ?? 0,
    activeSampleSource: options.activeSampleSource ?? current?.activeSampleSource ?? "workbench",
    sampleArtifact,
  }));
}
