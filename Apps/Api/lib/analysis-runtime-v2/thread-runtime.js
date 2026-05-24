const { finalizeLease, cleanupLease } = require("../shot-boundary/threadpool-runner");
const { buildActiveThreadMessage, isPendingTurnStatus } = require("./thread-message");

function createThreadRuntime({ jobStore }) {
  function updateActiveThreadMessage(context, turn) {
    const activeThreadMessage = buildActiveThreadMessage(
      turn?.threadId,
      turn?.turnId,
      turn?.activeThreadMessage,
      turn?.status,
    );
    if (activeThreadMessage || !isPendingTurnStatus(turn?.status)) {
      jobStore.updateJob(context.job.jobId, { activeThreadMessage });
    }
    return activeThreadMessage;
  }

  async function finalize(context, threadPool, options = {}) {
    if (!context.agentRun?.leaseId) return null;
    const result = await finalizeLease(threadPool, {
      leaseId: context.agentRun.leaseId,
      threadId: context.agentRun.threadId,
      traceId: context.traceContext.traceId,
    }, { shouldDiscard: Boolean(options.shouldDiscard) });
    return result;
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
    finalize,
    cleanup,
  };
}

module.exports = {
  createThreadRuntime,
};
