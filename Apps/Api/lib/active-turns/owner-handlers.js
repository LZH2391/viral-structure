const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");

function createActiveTurnOwnerHandlers({ agentConversationStore = null, jobStore = null, workflowRunStore = null } = {}) {
  async function onCollect(binding, result) {
    if (!binding) return null;
    if (binding.ownerType === "processing-job") return collectProcessingJob(binding, result);
    if (binding.ownerType === "workflow-stage") return collectWorkflowStage(binding, result);
    if (binding.ownerType === "agent-chat") return { status: "owner_managed_by_route" };
    return { status: "owner_unknown", ownerType: binding.ownerType };
  }

  async function onCancel(binding, result) {
    if (!binding) return null;
    if (binding.ownerType === "processing-job") return cancelProcessingJob(binding, result);
    if (binding.ownerType === "workflow-stage") return cancelWorkflowStage(binding, result);
    if (binding.ownerType === "agent-chat") return { status: "owner_managed_by_route" };
    return { status: "owner_unknown", ownerType: binding.ownerType };
  }

  function collectProcessingJob(binding, result) {
    const job = jobStore?.getJob?.(binding.ownerId);
    if (!job) return { status: "owner_missing" };
    if (!isCurrentJobTurn(job, binding)) return { status: "stale", ownerId: binding.ownerId, turnId: binding.turnId };
    if (!isTerminalStatus(result?.status)) return { status: "running" };
    const failed = !isCompletedStatus(result?.status);
    const nextAgentRun = job.agentRun
      ? {
          ...job.agentRun,
          status: failed ? "failed" : "completed",
          turnId: result?.turnId ?? binding.turnId ?? job.agentRun.turnId ?? null,
          updatedAt: new Date().toISOString(),
        }
      : job.agentRun;
    jobStore.updateJob(binding.ownerId, {
      agentRun: nextAgentRun,
      ...(failed ? {
        status: SAMPLE_STATUS.failed,
        errorSummary: {
          code: "active_turn_terminal_failure",
          message: "Agent turn 已结束但未成功完成",
          stageName: binding.stageName,
          retryable: true,
          turnId: binding.turnId,
        },
      } : {}),
    });
    return { status: failed ? "failed" : "completed" };
  }

  function cancelProcessingJob(binding, result) {
    const job = jobStore?.getJob?.(binding.ownerId);
    if (!job) return { status: "owner_missing" };
    if (!isCurrentJobTurn(job, binding)) return { status: "stale", ownerId: binding.ownerId, turnId: binding.turnId };
    jobStore.updateJob(binding.ownerId, {
      status: SAMPLE_STATUS.failed,
      agentRun: job.agentRun
        ? { ...job.agentRun, status: "canceled", turnId: result?.turnId ?? binding.turnId ?? job.agentRun.turnId ?? null, updatedAt: new Date().toISOString() }
        : job.agentRun,
      errorSummary: {
        code: "active_turn_canceled",
        message: "Agent turn 已被手动停止",
        stageName: binding.stageName,
        retryable: true,
        turnId: result?.turnId ?? binding.turnId,
      },
    });
    return { status: "canceled" };
  }

  function collectWorkflowStage(binding, result) {
    if (!workflowRunStore?.updateStageTurnState) return { status: "owner_handler_unavailable" };
    if (!isTerminalStatus(result?.status)) return { status: "running" };
    return workflowRunStore.updateStageTurnState(binding.ownerId, {
      currentAttemptId: binding.currentAttemptId,
      turnId: binding.turnId,
      status: isCompletedStatus(result?.status) ? "completed" : "failed",
      errorSummary: isCompletedStatus(result?.status) ? null : {
        code: "active_turn_terminal_failure",
        message: "Workflow stage turn 已结束但未成功完成",
        stageName: binding.stageName,
        retryable: true,
        turnId: binding.turnId,
      },
    }) ?? { status: "owner_missing" };
  }

  function cancelWorkflowStage(binding, result) {
    if (!workflowRunStore?.updateStageTurnState) return { status: "owner_handler_unavailable" };
    return workflowRunStore.updateStageTurnState(binding.ownerId, {
      currentAttemptId: binding.currentAttemptId,
      turnId: binding.turnId,
      status: "canceled",
      errorSummary: {
        code: "active_turn_canceled",
        message: "Workflow stage turn 已被手动停止",
        stageName: binding.stageName,
        retryable: true,
        turnId: result?.turnId ?? binding.turnId,
      },
    }) ?? { status: "owner_missing" };
  }

  return {
    agentConversationStore,
    onCollect,
    onCancel,
  };
}

function isCurrentJobTurn(job, binding) {
  const agentRun = job?.agentRun;
  if (!agentRun) return false;
  return String(agentRun.turnId ?? "") === String(binding.turnId ?? "")
    || String(agentRun.currentAttemptId ?? "") === String(binding.currentAttemptId ?? "");
}

function isTerminalStatus(status) {
  return ["completed", "complete", "failed", "error", "errored", "canceled", "cancelled"].includes(String(status ?? "").trim().toLowerCase());
}

function isCompletedStatus(status) {
  return ["completed", "complete"].includes(String(status ?? "").trim().toLowerCase());
}

module.exports = {
  createActiveTurnOwnerHandlers,
};
