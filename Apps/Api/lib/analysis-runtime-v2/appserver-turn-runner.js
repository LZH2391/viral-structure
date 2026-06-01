const { acquireLeaseWithRetry } = require("../shot-boundary/threadpool-runner");

const DEFAULT_MAX_INPUT_TOKEN_RATIO = 0.8;

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
    activeTurnRuntime,
    rootDir,
    pollIntervalMs,
    maxCollectAttempts,
    collectIdleTimeoutMs,
    collectHardTimeoutMs,
    onTurnStarted,
    onThreadAcquire,
    onTurnSubmit,
    onTurnCollectStart,
    onTurnCollect,
  }) {
    const leaseAcquisition = await acquireLeaseWithRetry(threadPool, {
      role,
      ownerId: context.traceContext.traceId,
      codedError,
      onAcquireUpdate: onThreadAcquire,
    });
    const lease = leaseAcquisition.lease;
    await onThreadAcquire?.({
      role,
      ownerId: context.traceContext.traceId,
      status: "acquired",
      attemptCount: leaseAcquisition.attemptCount,
      readinessDetail: leaseAcquisition.readinessDetail,
      lastRequestError: leaseAcquisition.lastRequestError,
      requestTimeoutMs: leaseAcquisition.requestTimeoutMs,
      leaseId: lease?.lease_id ?? null,
      threadId: lease?.thread_id ?? null,
    });
    const started = await startTurn({
      appServer,
      activeTurnRuntime,
      workspaceRoot: rootDir,
      threadId: lease.thread_id,
      inputs: turnInputs.inputs,
      timeoutSeconds: startTimeoutSeconds,
      binding: buildActiveTurnBinding({ context, lease, turnInputs, ownerType: "processing-job", attemptKind: "analyze" }),
    });
    await onTurnSubmit?.({ lease, started });
    await onTurnStarted?.({ lease, started });
    await onTurnCollectStart?.({ lease, started });
    const finalTurn = await collectTurnToCompletion({
      appServer,
      activeTurnRuntime,
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
    context,
    input,
    turnInputs,
    threadPool,
    appServer,
    activeTurnRuntime,
    rootDir,
    pollIntervalMs,
    maxCollectAttempts,
    collectIdleTimeoutMs,
    collectHardTimeoutMs,
    onTurnStarted,
    onTurnCollect,
    onLeaseReplaced,
  }) {
    agentRun = await ensureReusableAgentRun({
      agentRun,
      context,
      input,
      threadPool,
      appServer,
      rootDir,
      turnInputs,
      onLeaseReplaced,
      pollIntervalMs,
      maxCollectAttempts,
      collectIdleTimeoutMs,
      collectHardTimeoutMs,
    });
    const started = await startTurn({
      appServer,
      activeTurnRuntime,
      workspaceRoot: rootDir,
      threadId: agentRun.threadId,
      inputs: turnInputs.inputs,
      timeoutSeconds: startTimeoutSeconds,
      binding: buildActiveTurnBinding({ context, lease: normalizeAgentRunLease(agentRun), turnInputs, ownerType: "processing-job", attemptKind: "repair" }),
    });
    await onTurnStarted?.({ started });
    const finalTurn = await collectTurnToCompletion({
      appServer,
      activeTurnRuntime,
      rootDir,
      threadId: agentRun.threadId,
      turnId: started.turnId,
      pollIntervalMs,
      maxCollectAttempts,
      collectIdleTimeoutMs,
      collectHardTimeoutMs,
      onTurnCollect,
    });
    return { started, finalTurn, agentRun };
  }

  async function collectTurnToCompletion({
    appServer,
    activeTurnRuntime,
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
    const idleTimeoutMs = normalizePositiveMs(collectIdleTimeoutMs, maxCollectAttempts && pollIntervalMs ? maxCollectAttempts * pollIntervalMs : 15 * 60 * 1000);
    const hardTimeoutMs = normalizePositiveMs(collectHardTimeoutMs, 60 * 60 * 1000);
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
      const result = await collectTurn({
        appServer,
        activeTurnRuntime,
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

async function ensureReusableAgentRun({
  agentRun,
  context,
  input,
  threadPool,
  appServer,
  rootDir,
  turnInputs,
  onLeaseReplaced,
}) {
  if (!agentRun?.threadId || !agentRun?.leaseId || !threadPool) return agentRun;
  const decision = shouldRetireThreadForContext(agentRun.lastTokenUsage ?? agentRun.tokenUsage ?? null);
  if (!decision.retire) return agentRun;
  await threadPool.releaseLease?.({ leaseId: agentRun.leaseId, ownerId: agentRun.traceId }).catch(() => undefined);
  const leaseAcquisition = await acquireLeaseWithRetry(threadPool, {
    role: agentRun.role,
    ownerId: agentRun.traceId,
    codedError: context?.codedError ?? ((code, message, payload) => {
      const error = new Error(message);
      error.code = code;
      error.debugPayload = payload;
      return error;
    }),
  });
  const nextAgentRun = {
    ...agentRun,
    leaseId: leaseAcquisition.lease.lease_id,
    threadId: leaseAcquisition.lease.thread_id,
    turnId: null,
    contextReplacedAt: new Date().toISOString(),
    contextReplaceReason: decision.reason,
  };
  await onLeaseReplaced?.({ previousAgentRun: agentRun, agentRun: nextAgentRun, decision, lease: leaseAcquisition.lease, input, turnInputs, appServer, rootDir });
  return nextAgentRun;
}

function shouldRetireThreadForContext(tokenUsage, maxInputTokenRatio = DEFAULT_MAX_INPUT_TOKEN_RATIO) {
  const normalized = normalizeTokenUsage(tokenUsage);
  const inputTokens = normalized?.inputTokens;
  const modelContextWindow = normalized?.modelContextWindow;
  if (!Number.isFinite(inputTokens) || !Number.isFinite(modelContextWindow) || modelContextWindow <= 0) {
    return { retire: false, reason: "thread_context_usage_missing", inputTokens: inputTokens ?? null, modelContextWindow: modelContextWindow ?? null, ratio: null };
  }
  const ratio = inputTokens / modelContextWindow;
  return {
    retire: ratio >= maxInputTokenRatio,
    reason: ratio >= maxInputTokenRatio ? "thread_context_threshold_exceeded" : null,
    inputTokens,
    modelContextWindow,
    ratio,
  };
}

function normalizeTokenUsage(tokenUsage) {
  if (!tokenUsage || typeof tokenUsage !== "object") return null;
  const last = tokenUsage.last_token_usage ?? tokenUsage.lastTokenUsage ?? tokenUsage.token_usage ?? tokenUsage.tokenUsage ?? tokenUsage;
  return {
    inputTokens: nullableNumber(last.input_tokens ?? last.inputTokens),
    modelContextWindow: nullablePositiveNumber(tokenUsage.model_context_window ?? tokenUsage.modelContextWindow ?? last.model_context_window ?? last.modelContextWindow),
  };
}

function nullableNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function nullablePositiveNumber(value) {
  const next = nullableNumber(value);
  return next != null && next > 0 ? next : null;
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

async function startTurn({ appServer, activeTurnRuntime, workspaceRoot, threadId, inputs, timeoutSeconds, binding }) {
  if (typeof activeTurnRuntime?.start === "function") {
    return activeTurnRuntime.start({
      workspaceRoot,
      threadId,
      inputs,
      timeoutSeconds,
      binding,
    });
  }
  const result = await appServer.startTurnWithInputs({
    workspaceRoot,
    threadId,
    inputs,
    timeoutSeconds,
  });
  assertStartTurnResult(result);
  if (typeof activeTurnRuntime?.register === "function" && result?.turnId && binding) {
    await activeTurnRuntime.register({
      ...binding,
      threadId: result.threadId ?? threadId,
      turnId: result.turnId,
      currentAttemptId: binding.currentAttemptId ?? result.turnId,
      status: result.status ?? "submitted",
    }).catch(() => null);
  }
  return result;
}

function assertStartTurnResult(result) {
  const turnId = result?.turnId ?? result?.turn?.id ?? null;
  if (result?.ok !== false && turnId) return;
  const error = new Error(result?.message ?? "AppServer turn/start 未返回有效 turnId");
  error.code = result?.error ?? result?.code ?? "appserver_turn_start_failed";
  error.statusCode = result?.statusCode ?? 502;
  error.retryable = true;
  throw error;
}

async function collectTurn({ appServer, activeTurnRuntime, workspaceRoot, threadId, turnId, timeoutSeconds }) {
  if (typeof activeTurnRuntime?.collect === "function") {
    return activeTurnRuntime.collect({ workspaceRoot, threadId, turnId, timeoutSeconds });
  }
  const result = await appServer.collectTurnResult({ workspaceRoot, threadId, turnId, timeoutSeconds });
  await activeTurnRuntime?.markCollectResult?.({ turnId, result }).catch(() => null);
  return result;
}

function buildActiveTurnBinding({ context, lease, turnInputs, ownerType, attemptKind }) {
  const ownerId = context?.job?.jobId ?? context?.sampleVideoId ?? lease?.thread_id ?? null;
  if (!ownerId) return null;
  return {
    ownerType,
    ownerId,
    currentAttemptId: buildCurrentAttemptId(context, attemptKind),
    stageName: context?.activeStage?.stageName ?? null,
    traceId: context?.traceContext?.traceId ?? null,
    runId: context?.traceContext?.runId ?? null,
    stageId: context?.traceContext?.stageId ?? null,
    artifactId: context?.activeStage?.artifactId ?? context?.artifactId ?? null,
    parentArtifactId: context?.activeStage?.parentArtifactId ?? context?.parentArtifactId ?? null,
    leaseId: lease?.lease_id ?? null,
    threadPoolOwnerId: context?.traceContext?.traceId ?? null,
    replayRef: {
      type: "processing-job-input",
      refId: ownerId,
      sourceTurnId: context?.agentRun?.turnId ?? null,
      messageId: turnInputs?.promptTemplateId ?? null,
    },
  };
}

function buildCurrentAttemptId(context, attemptKind) {
  const jobId = context?.job?.jobId ?? context?.sampleVideoId ?? "unknown";
  const stageName = context?.activeStage?.stageName ?? "turn";
  const stageId = context?.traceContext?.stageId ?? Date.now();
  return `${jobId}:${stageName}:${attemptKind ?? "turn"}:${stageId}`;
}

function normalizeAgentRunLease(agentRun) {
  return {
    lease_id: agentRun?.leaseId ?? null,
    thread_id: agentRun?.threadId ?? null,
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
  shouldRetireThreadForContext,
};
