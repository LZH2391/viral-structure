const { randomUUID } = require("crypto");
const { publicRun } = require("./runtime-helpers");

function createWorkflowCancellation({
  workflowRunStore,
  jobStore,
  logger,
  workflowLogger,
  activeTurnRuntime,
  threadPool,
  workflowKey,
  cacheWaitingStatus,
}) {
  async function cancelRunUnlocked({ workflowRunId, reason = "user_requested" } = {}) {
    const run = workflowRunStore.getRun(workflowRunId);
    if (!run) return null;
    if (["processed", "failed", "canceled"].includes(run.status)) return publicRun(run);
    const now = new Date().toISOString();
    const traceContext = { runId: run.runId, traceId: run.traceId, stageId: `stage_${randomUUID()}` };
    const errorSummary = {
      code: "workflow_canceled",
      message: "分析已手动停止",
      stageName: "workflow.run",
      retryable: true,
    };
    await cancelActiveStages(run, traceContext, reason);
    const snapshot = await logger.writeDebugSnapshot({
      traceContext,
      stageName: "workflow.cancel",
      artifactId: null,
      parentArtifactId: null,
      reason: errorSummary.code,
      inputSummary: { workflowRunId, workflowKey, reason },
      outputSummary: {
        canceledStageKeys: run.stages.filter((stage) => ["pending", "running", cacheWaitingStatus].includes(stage.status)).map((stage) => stage.key),
      },
      debugPayload: {
        currentStageKeys: run.currentStageKeys ?? [],
      },
    });
    const canceledSummary = { ...errorSummary, debugSnapshotUri: snapshot.uri };
    const updated = workflowRunStore.updateRun(workflowRunId, (current) => ({
      status: "canceled",
      currentStageKeys: [],
      completedAt: now,
      canceledAt: now,
      cancelReason: reason,
      errorSummary: canceledSummary,
      stages: current.stages.map((stage) => {
        if (!["pending", "running", cacheWaitingStatus].includes(stage.status)) return stage;
        return {
          ...stage,
          status: "canceled",
          completedAt: now,
          errorSummary: {
            code: "workflow_stage_canceled",
            message: "步骤已随整条分析停止",
            stageName: stage.key,
            retryable: true,
            debugSnapshotUri: snapshot.uri,
          },
        };
      }),
    }));
    await workflowLogger.logWorkflowEvent(traceContext, "stage.fail", "workflow.cancel", null, null, { workflowRunId, workflowKey, reason }, { status: "canceled" }, null, canceledSummary);
    await workflowLogger.logWorkflowRunClosed(updated, "stage.fail");
    return publicRun(updated);
  }

  async function cancelActiveStages(run, traceContext, reason) {
    const activeStages = run.stages.filter((stage) => stage.childJobId && ["running", "pending", cacheWaitingStatus].includes(stage.status));
    for (const stage of activeStages) {
      const job = jobStore.getJob(stage.childJobId);
      if (!job) continue;
      await cancelProcessingJobForWorkflow(job, stage, traceContext, reason);
    }
  }

  async function cancelProcessingJobForWorkflow(job, stage, traceContext, reason) {
    const errorSummary = {
      code: "workflow_stage_canceled",
      message: "步骤已手动停止",
      stageName: stage.key,
      retryable: true,
    };
    const agentRun = job.agentRun ?? null;
    if (agentRun?.threadId && agentRun?.turnId && typeof activeTurnRuntime?.cancel === "function") {
      await activeTurnRuntime.cancel({
        workspaceRoot: agentRun.workspaceRoot ?? null,
        threadId: agentRun.threadId,
        turnId: agentRun.turnId,
        traceContext,
      }).catch(() => undefined);
    }
    if (agentRun?.leaseId && agentRun?.traceId && typeof threadPool?.releaseLease === "function") {
      await threadPool.releaseLease({ leaseId: agentRun.leaseId, ownerId: agentRun.traceId }).catch(() => undefined);
    } else if (agentRun?.traceId && typeof threadPool?.releaseOwnerLeases === "function") {
      await threadPool.releaseOwnerLeases(agentRun.traceId).catch(() => undefined);
    }
    jobStore.updateJob(job.jobId, {
      status: "failed",
      errorSummary,
      agentRun: agentRun ? { ...agentRun, status: "canceled", updatedAt: new Date().toISOString() } : agentRun,
      cancelReason: reason,
    });
  }

  return { cancelRunUnlocked };
}

module.exports = {
  createWorkflowCancellation,
};
