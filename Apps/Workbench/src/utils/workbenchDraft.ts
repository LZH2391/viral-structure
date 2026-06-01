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
  const current = readWorkbenchDraft();
  localStorage.setItem(WORKBENCH_DRAFT_STORAGE_KEY, JSON.stringify({
    ...value,
    activeSemanticGovernanceJob: value.activeSemanticGovernanceJob ?? current?.activeSemanticGovernanceJob,
  }));
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

export function writeActiveSemanticGovernanceJob(job: ActiveJobDraft | null) {
  updateDraft((draft) => {
    if (!job) {
      const { activeSemanticGovernanceJob, ...rest } = draft;
      void activeSemanticGovernanceJob;
      return rest;
    }
    return {
      ...draft,
      activeSemanticGovernanceJob: {
        processingJobId: job.processingJobId,
        sampleVideoId: job.sampleVideoId,
        traceId: job.traceId,
        jobSnapshot: draft.activeSemanticGovernanceJob?.jobSnapshot ?? null,
      },
    };
  });
}

export function writeActiveSemanticGovernanceJobSnapshot(job: NonNullable<DraftState["activeSemanticGovernanceJob"]>["jobSnapshot"] | null) {
  updateDraft((draft) => {
    if (!draft.activeSemanticGovernanceJob) return draft;
    return {
      ...draft,
      activeSemanticGovernanceJob: {
        ...draft.activeSemanticGovernanceJob,
        jobSnapshot: job,
      },
    };
  });
}

function analysisDraftKey(stageKind: AnalysisStageKind): "activeShotBoundaryJob" | "activeScriptSegmentJob" | "activeRhythmStructureJob" | "activePackagingStructureJob" | "activeFunctionSlotAtomizationJob" | "activeUserMaterialTaggerJob" {
  if (stageKind === "scriptSegment") return "activeScriptSegmentJob";
  if (stageKind === "rhythmStructure") return "activeRhythmStructureJob";
  if (stageKind === "packagingStructure") return "activePackagingStructureJob";
  if (stageKind === "functionSlotAtomization") return "activeFunctionSlotAtomizationJob";
  if (stageKind === "userMaterialTagger") return "activeUserMaterialTaggerJob";
  return "activeShotBoundaryJob";
}

function updateDraft(mutator: (draft: Partial<DraftState>) => Partial<DraftState>) {
  const current = readWorkbenchDraft() ?? {};
  localStorage.setItem(WORKBENCH_DRAFT_STORAGE_KEY, JSON.stringify(mutator(current)));
}
