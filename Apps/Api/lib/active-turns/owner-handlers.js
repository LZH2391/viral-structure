const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");

function createActiveTurnOwnerHandlers({ agentConversationStore = null, jobStore = null, workflowRunStore = null } = {}) {
  async function onCollect(binding, result) {
    if (!binding) return null;
    if (binding.ownerType === "processing-job") return collectProcessingJob(binding, result);
    if (binding.ownerType === "workflow-stage") return collectWorkflowStage(binding, result);
    if (binding.ownerType === "agent-chat") return collectAgentChat(binding, result);
    return { status: "owner_unknown", ownerType: binding.ownerType };
  }

  async function onCancel(binding, result) {
    if (!binding) return null;
    if (binding.ownerType === "processing-job") return cancelProcessingJob(binding, result);
    if (binding.ownerType === "workflow-stage") return cancelWorkflowStage(binding, result);
    if (binding.ownerType === "agent-chat") return cancelAgentChat(binding, result);
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

  async function collectAgentChat(binding, result) {
    if (!agentConversationStore?.recordAssistantTurn) return { status: "owner_handler_unavailable" };
    const terminalStatus = normalizeAgentChatStatus(result?.status);
    if (!terminalStatus) return { status: "running" };
    const conversation = await agentConversationStore.get?.(binding.ownerId);
    if (conversation?.latestTurnId && String(conversation.latestTurnId) !== String(binding.turnId)) {
      return { status: "stale", ownerId: binding.ownerId, turnId: binding.turnId };
    }
    await agentConversationStore.recordAssistantTurn({
      conversationId: binding.ownerId,
      turnId: binding.turnId,
      text: result?.finalMessage || result?.activeThreadMessage || (terminalStatus === "canceled" ? "已停止当前 turn" : "Agent turn 已结束"),
      status: terminalStatus,
      traceId: binding.traceId ?? null,
      runId: binding.runId ?? null,
      stageId: binding.stageId ?? null,
    });
    return { status: terminalStatus };
  }

  async function cancelAgentChat(binding, result) {
    if (!agentConversationStore?.recordTurnStopped) return { status: "owner_handler_unavailable" };
    const conversation = await agentConversationStore.get?.(binding.ownerId);
    if (conversation?.latestTurnId && String(conversation.latestTurnId) !== String(binding.turnId)) {
      return { status: "stale", ownerId: binding.ownerId, turnId: binding.turnId };
    }
    await agentConversationStore.recordTurnStopped({
      conversationId: binding.ownerId,
      turnId: binding.turnId,
      text: "已从运行面板停止当前 turn",
      traceId: binding.traceId ?? null,
      runId: binding.runId ?? null,
      stageId: binding.stageId ?? null,
    });
    return { status: "canceled" };
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

function normalizeAgentChatStatus(status) {
  const value = String(status ?? "").trim().toLowerCase();
  if (["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress", "collecting"].includes(value)) return null;
  if (["canceled", "cancelled"].includes(value)) return "canceled";
  if (["failed", "error", "errored"].includes(value)) return "failed";
  return "completed";
}

module.exports = {
  createActiveTurnOwnerHandlers,
};
