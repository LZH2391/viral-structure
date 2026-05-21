import type { DraftState } from "../state";
import type { ActiveJobDraft } from "./workbenchHelpers";

export const WORKBENCH_DRAFT_STORAGE_KEY = "workbench:last-sample";

export function readWorkbenchDraft(): DraftState | null {
  try {
    return JSON.parse(localStorage.getItem(WORKBENCH_DRAFT_STORAGE_KEY) ?? "null") as DraftState | null;
  } catch {
    localStorage.removeItem(WORKBENCH_DRAFT_STORAGE_KEY);
    return null;
  }
}

export function writeWorkbenchDraft(value: DraftState) {
  localStorage.setItem(WORKBENCH_DRAFT_STORAGE_KEY, JSON.stringify(value));
}

export function writeActiveUploadJob(job: ActiveJobDraft | null) {
  updateDraft((draft) => {
    if (!job) {
      const { activeUploadJob, ...rest } = draft;
      void activeUploadJob;
      return rest;
    }
    return { ...draft, activeUploadJob: { processingJobId: job.processingJobId, sampleVideoId: job.sampleVideoId, traceId: job.traceId } };
  });
}

export function writeActiveAgentJob(job: ActiveJobDraft | null) {
  updateDraft((draft) => {
    if (!job) {
      const { activeAgentJob, ...rest } = draft;
      void activeAgentJob;
      return rest;
    }
    return { ...draft, activeAgentJob: { processingJobId: job.processingJobId, sampleVideoId: job.sampleVideoId, traceId: job.traceId, analysisFps: job.analysisFps ?? 1 } };
  });
}

function updateDraft(mutator: (draft: Partial<DraftState>) => Partial<DraftState>) {
  const current = readWorkbenchDraft() ?? {};
  localStorage.setItem(WORKBENCH_DRAFT_STORAGE_KEY, JSON.stringify(mutator(current)));
}
