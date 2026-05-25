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
  onTurnStarted,
  onTurnCollect,
}) {
  const leaseAcquisition = await acquireLeaseWithRetry(threadPool, {
    role: ROLE,
    ownerId: context.traceContext.traceId,
    codedError,
  });
  const lease = leaseAcquisition.lease;
  const started = await appServer.startTurnWithInputs({
    workspaceRoot: rootDir,
    threadId: lease.thread_id,
    inputs: turnInputs.inputs,
    timeoutSeconds: 240,
  });
  await onTurnStarted?.({ lease, started });
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
  onTurnStarted,
  onTurnCollect,
}) {
  const started = await appServer.startTurnWithInputs({
    workspaceRoot: rootDir,
    threadId: agentRun.threadId,
    inputs: turnInputs.inputs,
    timeoutSeconds: 240,
  });
  await onTurnStarted?.({ started });
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
  let lastMismatchedTurnId = null;
  for (let attempt = 0; attempt < maxCollectAttempts; attempt += 1) {
    const result = await appServer.collectTurnResult({
      workspaceRoot: rootDir,
      threadId,
      turnId,
      timeoutSeconds: 120,
    });
    if (!isExpectedTurn(result, turnId)) {
      lastMismatchedTurnId = result?.turnId ?? null;
      await waitBeforeRetry(pollIntervalMs);
      continue;
    }
    await onTurnCollect?.(result);
    if (result?.status === "completed") return result;
    if (!isNonTerminalTurnStatus(result?.status)) {
      throw codedError("appserver_turn_collect_failed", "包装结构 Agent 结果收集失败", {
        turnId,
        status: result?.status ?? null,
      });
    }
    await waitBeforeRetry(pollIntervalMs);
  }
  throw codedError("appserver_turn_collect_timeout", "包装结构 Agent 长时间未返回结果", {
    turnId,
    attemptCount: maxCollectAttempts,
    lastMismatchedTurnId,
  });
}

async function waitBeforeRetry(delayMs) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  if (delayMs <= 5) {
    await Promise.resolve();
    return;
  }
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

function isExpectedTurn(result, expectedTurnId) {
  const actual = String(result?.turnId ?? "").trim();
  const expected = String(expectedTurnId ?? "").trim();
  return Boolean(actual && expected && actual === expected);
}


