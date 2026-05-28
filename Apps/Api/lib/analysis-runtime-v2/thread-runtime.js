const { finalizeLease, cleanupLease } = require("../shot-boundary/threadpool-runner");
const { buildActiveThreadMessage, isPendingTurnStatus } = require("./thread-message");
const { buildAgentActivityFromTurnResult } = require("../observability/agent-turn-timeline");

function createThreadRuntime({ jobStore }) {
  function updateActiveThreadMessage(context, turn) {
    const activeThreadMessage = buildActiveThreadMessage(
      turn?.threadId,
      turn?.turnId,
      turn?.activeThreadMessage,
      turn?.status,
    );
    const agentActivity = buildAgentActivityFromTurnResult(turn);
    if (activeThreadMessage || agentActivity || !isPendingTurnStatus(turn?.status)) {
      jobStore.updateJob(context.job.jobId, {
        activeThreadMessage,
        agentActivity,
      });
    }
    return activeThreadMessage;
  }

  function upsertTraceCard(context, card) {
    if (!context?.job?.jobId || !card) return null;
    const currentJob = jobStore.getJob(context.job.jobId);
    if (!currentJob) return null;
    const normalized = normalizeTraceCard(card);
    if (!normalized) return currentJob;
    const cards = Array.isArray(currentJob.agentTraceCards) ? currentJob.agentTraceCards : [];
    const existingIndex = cards.findIndex((item) => item?.id === normalized.id);
    const nextCards = existingIndex >= 0
      ? cards.map((item, index) => index === existingIndex ? { ...item, ...normalized } : item)
      : [...cards, normalized];
    return jobStore.updateJob(context.job.jobId, { agentTraceCards: nextCards });
  }

  async function finalize(context, threadPool) {
    if (!context.agentRun?.leaseId) return null;
    return finalizeLease(threadPool, {
      leaseId: context.agentRun.leaseId,
      threadId: context.agentRun.threadId,
      traceId: context.traceContext.traceId,
    });
  }

  async function cleanup(context, threadPool, lease, reason) {
    if (lease?.thread_id) {
      return cleanupLease(threadPool, lease, context.traceContext.traceId, reason);
    }
    if (context.agentRun?.threadId) {
      return cleanupLease(threadPool, {
        thread_id: context.agentRun.threadId,
        lease_id: context.agentRun.leaseId,
      }, context.traceContext.traceId, reason);
    }
    return null;
  }

  return {
    updateActiveThreadMessage,
    upsertTraceCard,
    finalize,
    cleanup,
  };
}

function normalizeTraceCard(card) {
  const id = textOrNull(card.id);
  if (!id) return null;
  return {
    id,
    label: textOrNull(card.label) ?? "Agent turn",
    role: textOrNull(card.role),
    stageName: textOrNull(card.stageName),
    status: normalizeStatus(card.status),
    threadId: textOrNull(card.threadId),
    turnId: textOrNull(card.turnId),
    leaseId: textOrNull(card.leaseId),
    traceId: textOrNull(card.traceId),
    artifactId: textOrNull(card.artifactId),
    parentArtifactId: textOrNull(card.parentArtifactId),
    activity: card.activity ?? null,
    latestMessagePreview: textOrNull(card.latestMessagePreview),
    startedAt: textOrNull(card.startedAt),
    updatedAt: textOrNull(card.updatedAt) ?? new Date().toISOString(),
  };
}

function normalizeStatus(status) {
  const value = String(status ?? "").trim().toLowerCase();
  if (["completed", "complete", "processed", "success", "succeeded"].includes(value)) return "completed";
  if (["failed", "error", "errored"].includes(value)) return "failed";
  if (["pending", "created", "queued"].includes(value)) return "pending";
  if (["running", "processing", "collecting", "turn_submitted", "submitted", "in_progress", "inprogress"].includes(value)) return "running";
  return "unknown";
}

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

module.exports = {
  createThreadRuntime,
};
