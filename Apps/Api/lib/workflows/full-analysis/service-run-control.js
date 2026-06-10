const { randomUUID } = require("crypto");
const {
  downstreamStageKeys,
  publicRun,
  resetCanceledOrFailedStageForResume,
  resetStageForRun,
  unique,
} = require("./runtime-helpers");

function createWorkflowRunControl({
  workflowRunStore,
  workflowLogger,
  workflowKey,
  workflowDescriptor,
  stageDefinitions,
  rerunnableStageKeys,
  startStage,
  advanceUnlocked,
  scheduleAdvance,
  buildUploadRerunInputForSample,
}) {
  async function resumeRunUnlocked({ workflowRunId } = {}) {
    const run = workflowRunStore.getRun(workflowRunId);
    if (!run) return null;
    if (["running", "cache_waiting"].includes(run.status)) {
      await advanceUnlocked(workflowRunId);
      scheduleAdvance(workflowRunId);
      return publicRun(workflowRunStore.getRun(workflowRunId));
    }
    if (!["canceled", "failed", "partial_failed"].includes(run.status)) return publicRun(run);
    const firstStageKey = firstResumeStageKey(run);
    if (!firstStageKey) return publicRun(run);
    if (firstStageKey === "upload") {
      if (!run.sampleVideoId) {
        const error = new Error("上传尚未完成，请从队列继续该任务");
        error.statusCode = 400;
        error.code = "workflow_resume_upload_unavailable";
        error.retryable = true;
        throw error;
      }
      return rerunStageUnlocked({ workflowRunId, stageKey: "upload" });
    }
    const now = new Date().toISOString();
    workflowRunStore.updateRun(workflowRunId, (current) => ({
      status: "running",
      currentStageKeys: [],
      completedAt: null,
      resumedAt: now,
      errorSummary: null,
      stages: current.stages.map(resetCanceledOrFailedStageForResume),
    }));
    await workflowLogger.logWorkflowEvent(
      { runId: run.runId, traceId: run.traceId, stageId: `stage_${randomUUID()}` },
      "stage.start",
      "workflow.resume",
      null,
      null,
      { workflowRunId, workflowKey, fromStatus: run.status, firstStageKey },
    );
    await advanceUnlocked(workflowRunId);
    return publicRun(workflowRunStore.getRun(workflowRunId));
  }

  async function rerunStageUnlocked({ workflowRunId, stageKey }) {
    const run = workflowRunStore.getRun(workflowRunId);
    if (!run) return null;
    if (!rerunnableStageKeys.has(stageKey)) {
      const error = new Error("该步骤暂不支持重跑");
      error.statusCode = 400;
      error.code = "workflow_stage_rerun_unsupported";
      error.retryable = false;
      throw error;
    }
    if (!run.sampleVideoId && stageKey !== "upload") {
      const error = new Error("样例视频尚未生成，不能重跑后续步骤");
      error.statusCode = 400;
      error.code = "workflow_stage_not_ready";
      error.retryable = true;
      throw error;
    }
    const uploadRerunInput = stageKey === "upload" ? await buildUploadRerunInputForSample(run.sampleVideoId) : null;
    const traceContext = { runId: run.runId, traceId: run.traceId, stageId: `stage_${randomUUID()}` };
    const resetKeys = unique([stageKey, ...downstreamStageKeys(stageDefinitions, stageKey, workflowDescriptor.parallelGroups)]);
    workflowRunStore.updateRun(workflowRunId, (current) => ({
      status: "running",
      currentStageKeys: [stageKey],
      sampleVideoId: stageKey === "upload" ? null : current.sampleVideoId,
      stages: current.stages.map((stage) => {
        if (!resetKeys.includes(stage.key)) return stage;
        const reset = resetStageForRun(stage);
        return {
          ...reset,
          attemptNo: stage.key === stageKey ? stage.attemptNo + 1 : stage.attemptNo,
        };
      }),
      completedAt: null,
      errorSummary: null,
    }));
    await startStage(workflowRunId, stageKey, uploadRerunInput ?? { cacheDecision: "refresh" }, traceContext);
    scheduleAdvance(workflowRunId);
    return publicRun(workflowRunStore.getRun(workflowRunId));
  }

  return {
    resumeRunUnlocked,
    rerunStageUnlocked,
  };
}

function firstResumeStageKey(run) {
  const first = run.stages.find((stage) => stage.status !== "processed");
  return first?.key ?? null;
}

module.exports = {
  createWorkflowRunControl,
};
