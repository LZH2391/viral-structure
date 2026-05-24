import { useCallback, useState } from "react";
import { getSampleArtifact, resolveShotBoundaryCacheDecision } from "../api/client";
import type { WorkbenchAction } from "../state";
import type { LibraryItemSummary, ProcessingJob, SampleArtifact, WorkbenchState } from "../types";
import { attachAgentJob, runShotBoundaryAnalysis } from "../utils/workbenchHelpers";
import { readWorkbenchDraft, writeActiveAgentJob } from "../utils/workbenchDraft";

type ShotCachePrompt = { jobId: string; sampleVideoId: string; cachedItem: LibraryItemSummary; token: number } | null;

type ShotBoundaryFlowOptions = {
  state: WorkbenchState;
  dispatch: (action: WorkbenchAction) => void;
  agentAnalysisFps: number;
  enableReview: boolean;
  analysisMode: "v1" | "v2";
  setSaveStatus: (value: string) => void;
  uploadTokenRef: { current: number };
};

export function useShotBoundaryFlow(options: ShotBoundaryFlowOptions) {
  const { state, dispatch, agentAnalysisFps, enableReview, analysisMode, setSaveStatus, uploadTokenRef } = options;
  const [agentJob, setAgentJob] = useState<ProcessingJob | null>(null);
  const [shotCachePrompt, setShotCachePrompt] = useState<ShotCachePrompt>(null);

  const restoreDraft = useCallback(async () => {
    const draft = readWorkbenchDraft();
    const activeShotBoundaryJob = draft?.activeShotBoundaryJob ?? draft?.activeAgentJob;
    if (!activeShotBoundaryJob) return;
    await attachAgentJob(activeShotBoundaryJob, setAgentJob, dispatch, writeActiveAgentJob, undefined, { showCacheWaiting: false }).catch(() => setSaveStatus("恢复切镜任务失败"));
    return activeShotBoundaryJob;
  }, [dispatch, setSaveStatus]);

  const run = useCallback(async () => {
    await runShotBoundaryAnalysis(
      state,
      agentAnalysisFps,
      enableReview,
      setAgentJob,
      dispatch,
      writeActiveAgentJob,
      async ({ job, cachedItem }) => {
        if (!job.jobId || !job.sampleVideoId) return;
        setShotCachePrompt({ jobId: job.jobId, sampleVideoId: job.sampleVideoId, cachedItem, token: uploadTokenRef.current });
        setSaveStatus("命中切镜缓存，等待选择");
      },
      "ask",
      analysisMode,
    );
  }, [agentAnalysisFps, analysisMode, dispatch, enableReview, setSaveStatus, state, uploadTokenRef]);

  const reuseCache = useCallback(async () => {
    if (!shotCachePrompt || !state.sampleVideo) return;
    const prompt = shotCachePrompt;
    setShotCachePrompt(null);
    try {
      const job = await resolveShotBoundaryCacheDecision(prompt.jobId, "reuse");
      setAgentJob(job);
      const artifact = await getSampleArtifact(prompt.sampleVideoId);
      dispatch({ type: "set-shot-boundary-analysis", artifact });
      writeActiveAgentJob(null);
      setSaveStatus("已复用切镜缓存");
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "复用切镜缓存失败");
    }
  }, [dispatch, setSaveStatus, shotCachePrompt, state.sampleVideo]);

  const refreshCache = useCallback(async () => {
    if (!state.sampleVideo || !shotCachePrompt) return;
    const prompt = shotCachePrompt;
    setShotCachePrompt(null);
    try {
      const job = await resolveShotBoundaryCacheDecision(prompt.jobId, "refresh");
      setAgentJob(job);
      await attachAgentJob(
        { processingJobId: prompt.jobId, sampleVideoId: prompt.sampleVideoId, traceId: job.traceId, analysisFps: agentAnalysisFps, enableReview },
        setAgentJob,
        dispatch,
        writeActiveAgentJob,
        ({ job: waitingJob, cachedItem }) => {
          setShotCachePrompt({
            jobId: waitingJob.jobId ?? prompt.jobId,
            sampleVideoId: waitingJob.sampleVideoId ?? prompt.sampleVideoId,
            cachedItem,
            token: uploadTokenRef.current,
          });
          setSaveStatus("命中切镜缓存，等待选择");
        },
      );
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "切镜分析失败");
    }
  }, [agentAnalysisFps, dispatch, enableReview, setSaveStatus, shotCachePrompt, state.sampleVideo, uploadTokenRef]);

  return {
    agentJob,
    setAgentJob,
    shotCachePrompt,
    setShotCachePrompt,
    restoreDraft,
    run,
    reuseCache,
    refreshCache,
  };
}
