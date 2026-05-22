const { acquireLeaseWithRetry } = require("../shot-boundary/threadpool-runner");
const { ROLE, codedError } = require("./shared");

async function executeAnalyzeTurn({
  context,
  input,
  turnInputs,
  threadPool,
  appServer,
  rootDir,
  pollIntervalMs,
  maxCollectAttempts,
}) {
  const leaseAcquisition = await acquireLeaseWithRetry(threadPool, {
    role: ROLE,
    ownerId: context.traceContext.traceId,
    maxAttempts: 3,
    backoffMs: [500, 1000],
    codedError,
  });
  const lease = leaseAcquisition.lease;
  const started = await appServer.startTurnWithInputs({
    workspaceRoot: rootDir,
    threadId: lease.thread_id,
    inputs: turnInputs.inputs,
    timeoutSeconds: 240,
  });
  const finalTurn = await collectTurnToCompletion({
    appServer,
    rootDir,
    threadId: lease.thread_id,
    turnId: started.turnId,
    pollIntervalMs,
    maxCollectAttempts,
  });
  return { lease, started, finalTurn };
}

async function executeRepairTurn({
  agentRun,
  turnInputs,
  appServer,
  rootDir,
  pollIntervalMs,
  maxCollectAttempts,
}) {
  const started = await appServer.startTurnWithInputs({
    workspaceRoot: rootDir,
    threadId: agentRun.threadId,
    inputs: turnInputs.inputs,
    timeoutSeconds: 240,
  });
  const finalTurn = await collectTurnToCompletion({
    appServer,
    rootDir,
    threadId: agentRun.threadId,
    turnId: started.turnId,
    pollIntervalMs,
    maxCollectAttempts,
  });
  return { started, finalTurn };
}

async function collectTurnToCompletion({
  appServer,
  rootDir,
  threadId,
  turnId,
  pollIntervalMs,
  maxCollectAttempts,
}) {
  for (let attempt = 0; attempt < maxCollectAttempts; attempt += 1) {
    const result = await appServer.collectTurnResult({
      workspaceRoot: rootDir,
      threadId,
      turnId,
      timeoutSeconds: 120,
    });
    if (result?.status === "completed") return result;
    if (result?.status !== "running" && result?.status !== "submitted") {
      throw codedError("appserver_turn_collect_failed", "脚本段落 Agent 结果收集失败", {
        turnId,
        status: result?.status ?? null,
      });
    }
    await waitBeforeRetry(pollIntervalMs);
  }
  throw codedError("appserver_turn_collect_timeout", "脚本段落 Agent 长时间未返回结果", {
    turnId,
    attemptCount: maxCollectAttempts,
  });
}

async function waitBeforeRetry(delayMs) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

module.exports = {
  executeAnalyzeTurn,
  executeRepairTurn,
  collectTurnToCompletion,
};
