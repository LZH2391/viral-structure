const { acquireLeaseWithRetry } = require("../shot-boundary/threadpool-runner");

function createAppServerTurnRunner({
  role,
  codedError,
  collectFailedMessage,
  collectTimeoutMessage,
  ensureExpectedTurn = true,
  startTimeoutSeconds = 240,
  collectTimeoutSeconds = 120,
}) {
  async function executeAnalyzeTurn({
    context,
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
      role,
      ownerId: context.traceContext.traceId,
      codedError,
    });
    const lease = leaseAcquisition.lease;
    const started = await appServer.startTurnWithInputs({
      workspaceRoot: rootDir,
      threadId: lease.thread_id,
      inputs: turnInputs.inputs,
      timeoutSeconds: startTimeoutSeconds,
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
      timeoutSeconds: startTimeoutSeconds,
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
        timeoutSeconds: collectTimeoutSeconds,
      });
      if (ensureExpectedTurn && !isExpectedTurn(result, turnId)) {
        lastMismatchedTurnId = result?.turnId ?? null;
        await waitBeforeRetry(pollIntervalMs);
        continue;
      }
      await onTurnCollect?.(result);
      if (result?.status === "completed") return result;
      if (!isNonTerminalTurnStatus(result?.status)) {
        throw codedError("appserver_turn_collect_failed", collectFailedMessage, {
          turnId,
          status: result?.status ?? null,
        });
      }
      await waitBeforeRetry(pollIntervalMs);
    }
    throw codedError("appserver_turn_collect_timeout", collectTimeoutMessage, {
      turnId,
      attemptCount: maxCollectAttempts,
      ...(ensureExpectedTurn ? { lastMismatchedTurnId } : {}),
    });
  }

  return {
    executeAnalyzeTurn,
    executeRepairTurn,
    collectTurnToCompletion,
  };
}

async function waitBeforeRetry(delayMs) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  if (delayMs <= 5) {
    await Promise.resolve();
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isNonTerminalTurnStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress"].includes(String(status ?? "").trim().toLowerCase());
}

function isExpectedTurn(result, expectedTurnId) {
  const actual = String(result?.turnId ?? "").trim();
  const expected = String(expectedTurnId ?? "").trim();
  return Boolean(actual && expected && actual === expected);
}

module.exports = {
  createAppServerTurnRunner,
  isExpectedTurn,
  isNonTerminalTurnStatus,
};
