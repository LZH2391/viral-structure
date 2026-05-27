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
    collectIdleTimeoutMs,
    collectHardTimeoutMs,
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
      collectIdleTimeoutMs,
      collectHardTimeoutMs,
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
    collectIdleTimeoutMs,
    collectHardTimeoutMs,
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
      collectIdleTimeoutMs,
      collectHardTimeoutMs,
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
    collectIdleTimeoutMs,
    collectHardTimeoutMs,
    onTurnCollect,
  }) {
    const startedAt = Date.now();
    const idleTimeoutMs = normalizePositiveMs(collectIdleTimeoutMs, maxCollectAttempts && pollIntervalMs ? maxCollectAttempts * pollIntervalMs : 360_000);
    const hardTimeoutMs = normalizePositiveMs(collectHardTimeoutMs, 45 * 60 * 1000);
    let lastProgressAt = startedAt;
    let lastProgressFingerprint = null;
    let lastMismatchedTurnId = null;
    let attemptCount = 0;
    while (true) {
      const now = Date.now();
      const idleElapsedMs = now - lastProgressAt;
      const hardElapsedMs = now - startedAt;
      if (idleElapsedMs >= idleTimeoutMs || hardElapsedMs >= hardTimeoutMs) {
        throw codedError("appserver_turn_collect_timeout", collectTimeoutMessage, buildCollectTimeoutPayload({
          turnId,
          attemptCount,
          timeoutReason: hardElapsedMs >= hardTimeoutMs ? "hard_timeout" : "idle_timeout",
          idleTimeoutMs,
          hardTimeoutMs,
          elapsedMs: hardElapsedMs,
          idleElapsedMs,
          lastProgressAt,
          lastProgressFingerprint,
          ensureExpectedTurn,
          lastMismatchedTurnId,
        }));
      }
      attemptCount += 1;
      const requestTimeoutSeconds = collectRequestTimeoutSeconds({
        collectTimeoutSeconds,
        idleRemainingMs: idleTimeoutMs - idleElapsedMs,
        hardRemainingMs: hardTimeoutMs - hardElapsedMs,
      });
      const result = await appServer.collectTurnResult({
        workspaceRoot: rootDir,
        threadId,
        turnId,
        timeoutSeconds: requestTimeoutSeconds,
      });
      if (ensureExpectedTurn && !isExpectedTurn(result, turnId)) {
        lastMismatchedTurnId = result?.turnId ?? null;
        await waitBeforeRetry(pollIntervalMs);
        continue;
      }
      await onTurnCollect?.(result);
      const progressFingerprint = buildProgressFingerprint(result);
      if (progressFingerprint && progressFingerprint !== lastProgressFingerprint) {
        lastProgressFingerprint = progressFingerprint;
        lastProgressAt = Date.now();
      }
      if (result?.status === "completed") return result;
      if (!isNonTerminalTurnStatus(result?.status)) {
        throw codedError("appserver_turn_collect_failed", collectFailedMessage, {
          turnId,
          status: result?.status ?? null,
          attemptCount,
        });
      }
      if (Date.now() - lastProgressAt >= idleTimeoutMs) {
        throw codedError("appserver_turn_collect_timeout", collectTimeoutMessage, buildCollectTimeoutPayload({
          turnId,
          attemptCount,
          timeoutReason: "idle_timeout",
          idleTimeoutMs,
          hardTimeoutMs,
          elapsedMs: Date.now() - startedAt,
          idleElapsedMs: Date.now() - lastProgressAt,
          lastProgressAt,
          lastProgressFingerprint,
          ensureExpectedTurn,
          lastMismatchedTurnId,
          lastResult: result,
        }));
      }
      await waitBeforeRetry(pollIntervalMs);
    }
  }

  return {
    executeAnalyzeTurn,
    executeRepairTurn,
    collectTurnToCompletion,
  };
}

function buildCollectTimeoutPayload({
  turnId,
  attemptCount,
  timeoutReason,
  idleTimeoutMs,
  hardTimeoutMs,
  elapsedMs,
  idleElapsedMs,
  lastProgressAt,
  lastProgressFingerprint,
  ensureExpectedTurn,
  lastMismatchedTurnId,
  lastResult = null,
}) {
  return {
    turnId,
    attemptCount,
    timeoutReason,
    idleTimeoutMs,
    hardTimeoutMs,
    elapsedMs,
    idleElapsedMs,
    lastProgressAt: lastProgressAt ? new Date(lastProgressAt).toISOString() : null,
    lastProgressFingerprint,
    lastStatus: lastResult?.status ?? null,
    activeThreadMessagePreview: safePreview(lastResult?.activeThreadMessage),
    turnActivity: sanitizeTurnActivity(lastResult?.turnActivity),
    ...(ensureExpectedTurn ? { lastMismatchedTurnId } : {}),
  };
}

function buildProgressFingerprint(result) {
  if (!result || typeof result !== "object") return null;
  const activity = result.turnActivity && typeof result.turnActivity === "object" ? result.turnActivity : {};
  const tokenUsage = activity.tokenUsage && typeof activity.tokenUsage === "object" ? activity.tokenUsage : {};
  const parts = [
    result.status,
    safePreview(result.activeThreadMessage),
    activity.itemCount,
    activity.effectiveItemCount,
    activity.latestItemType,
    safePreview(activity.latestMessagePreview),
    activity.latestToolName,
    tokenUsage.inputTokens,
    tokenUsage.outputTokens,
    tokenUsage.totalTokens,
    tokenUsage.reasoningOutputTokens,
  ];
  const value = parts.map((part) => String(part ?? "")).join("|");
  return value.replace(/\|/g, "") ? value : null;
}

function sanitizeTurnActivity(activity) {
  if (!activity || typeof activity !== "object") return null;
  return {
    threadId: activity.threadId ?? null,
    turnId: activity.turnId ?? null,
    status: activity.status ?? null,
    itemCount: activity.itemCount ?? null,
    effectiveItemCount: activity.effectiveItemCount ?? null,
    latestItemType: activity.latestItemType ?? null,
    latestMessagePreview: safePreview(activity.latestMessagePreview),
    latestToolName: activity.latestToolName ?? null,
    tokenUsage: activity.tokenUsage ?? null,
  };
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, limit) : null;
}

function normalizePositiveMs(value, fallback) {
  const next = Number(value);
  if (Number.isFinite(next) && next > 0) return next;
  return fallback;
}

function collectRequestTimeoutSeconds({ collectTimeoutSeconds, idleRemainingMs, hardRemainingMs }) {
  const baseMs = normalizePositiveMs(collectTimeoutSeconds, 120) * 1000;
  const remainingMs = Math.max(1, Math.min(baseMs, idleRemainingMs, hardRemainingMs));
  return Math.max(1, Math.ceil(remainingMs / 1000));
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
