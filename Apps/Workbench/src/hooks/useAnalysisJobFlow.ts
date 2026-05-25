import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import { addVersion, STAGES, type WorkbenchAction } from "../state";
import type { LibraryItemSummary, ProcessingJob, SampleArtifact, WorkbenchState } from "../types";
import { attachAnalysisJob, runPackagingStructureAnalysis, runRhythmStructureAnalysis, runScriptSegmentAnalysis } from "../utils/workbenchHelpers";
import { writeActiveAnalysisJob } from "../utils/workbenchDraft";

type AnalysisKind = "scriptSegment" | "rhythmStructure" | "packagingStructure";
type CachePrompt = { jobId: string; sampleVideoId: string; cachedItem: LibraryItemSummary; token: number } | null;

type FlowOptions = {
  kind: AnalysisKind;
  state: WorkbenchState;
  dispatch: (action: WorkbenchAction) => void;
  persistWorkbenchArtifact: (artifact: SampleArtifact, traceId: string | null) => void;
  setSaveStatus: (value: string) => void;
  uploadTokenRef: MutableRefObject<number>;
};

export function useAnalysisJobFlow(options: FlowOptions) {
  const { kind, state, dispatch, persistWorkbenchArtifact, setSaveStatus, uploadTokenRef } = options;
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [cachePrompt, setCachePrompt] = useState<CachePrompt>(null);

  const attachDraftJob = useCallback(async (draftJob: { processingJobId: string; sampleVideoId: string; traceId: string } | undefined) => {
    if (!draftJob) return;
    await attachAnalysisJob(
      draftJob,
      setJob,
      dispatch,
      (nextJob) => writeActiveAnalysisJob(kind, nextJob),
      { artifactAction: "apply-artifact", showCacheWaiting: false },
    );
  }, [dispatch, kind]);

  const run = useCallback(async (cacheDecision: "ask" | "refresh" = "ask") => {
    const runner = kind === "scriptSegment"
      ? runScriptSegmentAnalysis
      : kind === "rhythmStructure"
        ? runRhythmStructureAnalysis
        : runPackagingStructureAnalysis;
    const result = await runner(
      state,
      dispatch,
      setJob,
      (nextJob) => writeActiveAnalysisJob(kind, nextJob),
      async ({ job: waitingJob, cachedItem }) => {
        if (!waitingJob.jobId || !waitingJob.sampleVideoId) return;
        setCachePrompt({
          jobId: waitingJob.jobId,
          sampleVideoId: waitingJob.sampleVideoId,
          cachedItem,
          token: uploadTokenRef.current,
        });
        setSaveStatus(analysisCopy(kind, "命中缓存，等待选择"));
      },
      cacheDecision,
    );
    return result;
  }, [dispatch, kind, setSaveStatus, state, uploadTokenRef]);

  const applyCompletedArtifact = useCallback((artifact: SampleArtifact, traceId: string | null, reason: string) => {
    persistWorkbenchArtifact(artifact, traceId);
    dispatch({
      type: "add-version",
      version: addVersion(
        reason,
        stageForKind(kind),
        artifactIdForKind(kind, artifact),
        parentArtifactIdForKind(kind, artifact),
      ),
    });
  }, [dispatch, kind, persistWorkbenchArtifact]);

  useEffect(() => {
    if (!job || job.status !== "failed") return;
    writeActiveAnalysisJob(kind, null);
  }, [job, kind]);

  return {
    job,
    setJob,
    cachePrompt,
    setCachePrompt,
    run,
    attachDraftJob,
    applyCompletedArtifact,
  };
}

function analysisCopy(kind: AnalysisKind, suffix: string) {
  const prefix = kind === "scriptSegment" ? "脚本段落" : kind === "rhythmStructure" ? "节奏结构" : "包装结构";
  return `${prefix}${suffix}`;
}

function stageForKind(kind: AnalysisKind) {
  if (kind === "scriptSegment") return STAGES.scriptSegmentAnalyze;
  if (kind === "rhythmStructure") return STAGES.rhythmStructureAnalyze;
  return STAGES.packagingStructureAnalyze;
}

function artifactIdForKind(kind: AnalysisKind, artifact: SampleArtifact) {
  if (kind === "scriptSegment") return artifact.scriptSegmentAnalysis?.artifactId ?? artifact.sampleVideo.artifactId;
  if (kind === "rhythmStructure") return artifact.rhythmStructureAnalysis?.artifactId ?? artifact.sampleVideo.artifactId;
  return artifact.packagingStructureAnalysis?.artifactId ?? artifact.sampleVideo.artifactId;
}

function parentArtifactIdForKind(kind: AnalysisKind, artifact: SampleArtifact) {
  if (kind === "scriptSegment") return artifact.scriptSegmentAnalysis?.parentArtifactId ?? artifact.shotBoundaryAnalysis?.artifactId ?? null;
  if (kind === "rhythmStructure") return artifact.rhythmStructureAnalysis?.parentArtifactId ?? artifact.shotBoundaryAnalysis?.artifactId ?? null;
  return artifact.packagingStructureAnalysis?.parentArtifactId ?? artifact.shotBoundaryAnalysis?.artifactId ?? null;
}
