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
  onTurnCollect,
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
    onTurnCollect,
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
  onTurnCollect,
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
    onTurnCollect,
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
  onTurnCollect,
}) {
  for (let attempt = 0; attempt < maxCollectAttempts; attempt += 1) {
    const result = await appServer.collectTurnResult({
      workspaceRoot: rootDir,
      threadId,
      turnId,
      timeoutSeconds: 120,
    });
    await onTurnCollect?.(result);
    if (result?.status === "completed") return result;
    if (!isNonTerminalTurnStatus(result?.status)) {
      throw codedError("appserver_turn_collect_failed", "节奏结构 Agent 结果收集失败", {
        turnId,
        status: result?.status ?? null,
      });
    }
    await waitBeforeRetry(pollIntervalMs);
  }
  throw codedError("appserver_turn_collect_timeout", "节奏结构 Agent 长时间未返回结果", {
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

function isNonTerminalTurnStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress"].includes(String(status ?? "").trim().toLowerCase());
}

