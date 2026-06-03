const { buildAgentActivityFromTurnResult } = require("../observability/agent-turn-timeline");

function markAgentRunLeaseReleased(agentRun) {
  const now = new Date().toISOString();
  return {
    ...agentRun,
    releasedLeaseId: agentRun.leaseId ?? agentRun.releasedLeaseId ?? null,
    leaseReleasedAt: now,
    leaseId: null,
    updatedAt: now,
  };
}

function updateActiveThreadMessageForJob({ jobStore, context, turnOrThreadId, turnIdOrOptions, message, status, options = {} }) {
  const turn = typeof turnOrThreadId === "object" && turnOrThreadId !== null
    ? turnOrThreadId
    : { threadId: turnOrThreadId, turnId: turnIdOrOptions, activeThreadMessage: message, status };
  const resolvedOptions = typeof turnOrThreadId === "object" && turnOrThreadId !== null ? (turnIdOrOptions ?? {}) : options;
  const normalized = buildActiveThreadMessage(turn.threadId, turn.turnId, turn.activeThreadMessage ?? null, turn.status, resolvedOptions);
  const agentActivity = buildAgentActivityFromTurnResult(turn);
  if (normalized || agentActivity || !isPendingTurnStatus(turn.status)) {
    jobStore.updateJob(context.job.jobId, { activeThreadMessage: normalized, agentActivity });
  }
  return normalized;
}

function buildActiveThreadMessage(threadId, turnId, message, status, options = {}) {
  const normalized = String(message ?? "").trim() || String(options.fallbackMessage ?? "").trim();
  if (normalized || !isPendingTurnStatus(status)) {
    return normalized
      ? {
          threadId: threadId ?? null,
          turnId: turnId ?? null,
          role: options.role ?? "thread",
          text: normalized.length <= 1200 ? normalized : `${normalized.slice(0, 1200)}...`,
          createdAt: new Date().toISOString(),
        }
      : null;
  }
  return null;
}

function isPendingTurnStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress", "collecting"].includes(String(status ?? "").trim().toLowerCase());
}

module.exports = {
  markAgentRunLeaseReleased,
  updateActiveThreadMessageForJob,
};
