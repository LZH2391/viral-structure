import { getSampleArtifact, resolveCacheDecision } from "../../api/client";
import type { WorkbenchAction } from "../../state";
import type { ProcessingJob, SampleArtifact, WorkbenchState } from "../../types";
import { getAnalysisRole, type AnalysisKind } from "../../utils/analysisRoles";
import type { useAnalysisJobFlow } from "../../hooks/useAnalysisJobFlow";
import type { FullAnalysisStageTarget } from "../FullAnalysisApp";
import type { PropertyPanelTab } from "../PropertyPanel";

type AnalysisJobFlow = ReturnType<typeof useAnalysisJobFlow>;

export const STAGES = {
  scriptSegmentAnalyze: "script.segment.analyze",
  rhythmStructureAnalyze: "rhythm.structure.analyze",
  packagingStructureAnalyze: "packaging.structure.analyze",
  functionSlotAtomizationAnalyze: "function.slot.atomization.analyze",
} as const;

export async function reuseAnalysisCache(
  kind: AnalysisKind,
  flow: AnalysisJobFlow,
  setSaveStatus: (value: string) => void,
  state: WorkbenchState,
  dispatch: (action: WorkbenchAction) => void,
) {
  if (!flow.cachePrompt) return;
  const role = getAnalysisRole(kind);
  const prompt = flow.cachePrompt;
  flow.setCachePrompt(null);
  try {
    const job = await resolveCacheDecision(prompt.jobId, "reuse");
    flow.setJob(job);
    const artifact = await getSampleArtifact(prompt.sampleVideoId);
    dispatch({ type: "apply-artifact", artifact });
    flow.applyCompletedArtifact(
      artifact,
      job.traceId ?? state.processingJob?.traceId ?? null,
      role.reuseReason,
    );
    flow.setJob(null);
    setSaveStatus(`${role.displayName}已复用缓存`);
  } catch (error) {
    setSaveStatus(error instanceof Error ? error.message : `${role.displayName}复用缓存失败`);
  }
}

export async function refreshAnalysisCache(
  kind: AnalysisKind,
  flow: AnalysisJobFlow,
  setSaveStatus: (value: string) => void,
  state: WorkbenchState,
) {
  if (!state.sampleVideo || !flow.cachePrompt) return;
  const role = getAnalysisRole(kind);
  flow.setCachePrompt(null);
  try {
    const result = await flow.run("refresh");
    if (result?.artifact && role.getArtifact(result.artifact)) {
      flow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, role.refreshReason);
      setSaveStatus(`${role.displayName}已重新生成`);
    }
  } catch (error) {
    setSaveStatus(error instanceof Error ? error.message : role.failureMessage);
  }
}

export function resolveFailedProcessingJob(error: unknown): ProcessingJob | null {
  const job = (error as { processingJob?: ProcessingJob | null })?.processingJob ?? null;
  if (!job) return null;
  return job.status === "failed" || job.status === "processing" || job.status === "pending" ? job : null;
}

export function fullAnalysisStageToPropertyTab(stageKey: FullAnalysisStageTarget): PropertyPanelTab {
  if (stageKey === "scriptSegment") return "script";
  if (stageKey === "rhythmStructure") return "rhythm";
  if (stageKey === "packagingStructure") return "packaging";
  if (stageKey === "functionSlotAtomization") return "atomization";
  if (stageKey === "aggregate") return "meta";
  return "shot";
}

export function toActiveJobDraft(job: ProcessingJob | null) {
  if (!job?.jobId || !job.sampleVideoId || !job.traceId) return null;
  return { processingJobId: job.jobId, sampleVideoId: job.sampleVideoId, traceId: job.traceId };
}

export function sampleArtifactSyncSignature(artifact: SampleArtifact) {
  return [
    artifact.sampleVideoId,
    artifact.sampleVideo.artifactId,
    artifact.status,
    artifact.shotBoundaryAnalysis?.artifactId,
    artifact.scriptSegmentAnalysis?.artifactId,
    artifact.rhythmStructureAnalysis?.artifactId,
    artifact.packagingStructureAnalysis?.artifactId,
    artifact.functionSlotAtomizationAnalysis?.artifactId,
  ].filter(Boolean).join("|");
}
