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
    finalize,
    cleanup,
  };
}

module.exports = {
  createThreadRuntime,
};
