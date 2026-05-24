import type { DraftState } from "../state";
import type { ActiveJobDraft, AnalysisStageKind } from "./workbenchHelpers";

export const WORKBENCH_DRAFT_STORAGE_KEY = "workbench:last-sample";
const DEFAULT_ANALYSIS_FPS = 10;

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
  writeActiveAnalysisJob("shotBoundary", job);
}

export function writeActiveAnalysisJob(stageKind: AnalysisStageKind, job: ActiveJobDraft | null) {
  const draftKey = analysisDraftKey(stageKind);
  updateDraft((draft) => {
    if (!job) {
      const { [draftKey]: removed, ...rest } = draft;
      void removed;
      if (stageKind === "shotBoundary" && "activeAgentJob" in rest) {
        const { activeAgentJob, ...legacyRest } = rest;
        void activeAgentJob;
        return legacyRest;
      }
      return rest;
    }
    const nextDraft = {
      ...draft,
      [draftKey]: {
        processingJobId: job.processingJobId,
        sampleVideoId: job.sampleVideoId,
        traceId: job.traceId,
        ...(stageKind === "shotBoundary" ? { analysisFps: job.analysisFps ?? DEFAULT_ANALYSIS_FPS, enableReview: job.enableReview ?? true } : {}),
      },
    };
    if (stageKind === "shotBoundary") {
      return { ...nextDraft, activeAgentJob: { processingJobId: job.processingJobId, sampleVideoId: job.sampleVideoId, traceId: job.traceId, analysisFps: job.analysisFps ?? DEFAULT_ANALYSIS_FPS, enableReview: job.enableReview ?? true } };
    }
    return nextDraft;
  });
}

function analysisDraftKey(stageKind: AnalysisStageKind): "activeShotBoundaryJob" | "activeScriptSegmentJob" | "activeRhythmStructureJob" {
  if (stageKind === "scriptSegment") return "activeScriptSegmentJob";
  if (stageKind === "rhythmStructure") return "activeRhythmStructureJob";
  return "activeShotBoundaryJob";
}

function updateDraft(mutator: (draft: Partial<DraftState>) => Partial<DraftState>) {
  const current = readWorkbenchDraft() ?? {};
  localStorage.setItem(WORKBENCH_DRAFT_STORAGE_KEY, JSON.stringify(mutator(current)));
}
