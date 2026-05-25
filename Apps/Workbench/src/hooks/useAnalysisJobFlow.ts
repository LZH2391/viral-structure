import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import { addVersion, type WorkbenchAction } from "../state";
import type { LibraryItemSummary, ProcessingJob, SampleArtifact, WorkbenchState } from "../types";
import { attachAnalysisJob, runAnalysisRole } from "../utils/workbenchHelpers";
import { getAnalysisRole, type AnalysisKind } from "../utils/analysisRoles";
import { writeActiveAnalysisJob } from "../utils/workbenchDraft";

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
  const role = getAnalysisRole(kind);
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
    const result = await runAnalysisRole(
      role.kind,
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
        setSaveStatus(`${role.displayName}命中缓存，等待选择`);
      },
      cacheDecision,
    );
    return result;
  }, [dispatch, role, setSaveStatus, state, uploadTokenRef]);

  const applyCompletedArtifact = useCallback((artifact: SampleArtifact, traceId: string | null, reason: string) => {
    persistWorkbenchArtifact(artifact, traceId);
    dispatch({
      type: "add-version",
      version: addVersion(
        reason,
        role.stageId,
        role.getArtifactId(artifact),
        role.getParentArtifactId(artifact),
      ),
    });
  }, [dispatch, persistWorkbenchArtifact, role]);

  useEffect(() => {
    if (!job || job.status !== "failed") return;
    writeActiveAnalysisJob(role.kind, null);
  }, [job, role]);

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
