const { codedError } = require("../shot-boundary-analysis");

async function collectTurn({
  context,
  stageName,
  artifactId,
  parentArtifactId,
  threadId,
  turnId,
  appServer,
  activeTurnRuntime,
  rootDir,
  runStage,
  inputSummary,
  outputSummary,
  updateActiveThreadMessage,
  activeMessageOptions,
  maxAttempts = 1800,
  intervalMs = 2000,
  incompleteCode,
  incompleteMessage,
}) {
  let collected = null;
  const attempts = Math.max(1, Number(maxAttempts || 1));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await delay(intervalMs);
    collected = await runStage(context, stageName, 93, {
      artifactId,
      parentArtifactId,
      inputSummary: inputSummary(attempt),
      action: () => collectActiveTurn({
        appServer,
        activeTurnRuntime,
        workspaceRoot: rootDir,
        threadId,
        turnId,
        timeoutSeconds: 120,
        traceContext: context.traceContext,
      }),
      outputSummary: (result) => outputSummary(result, attempt),
    });
    await updateActiveThreadMessage?.(collected.threadId, collected.turnId, collected.activeThreadMessage ?? null, collected.status, activeMessageOptions);
    if (collected.status === "completed") return collected;
    if (!isPendingTurnStatus(collected.status)) break;
  }
  const error = codedError(incompleteCode, incompleteMessage, {
    turnId: collected?.turnId ?? turnId ?? null,
    status: collected?.status ?? null,
    finalMessagePreview: safePreview(collected?.finalMessage),
    activeThreadMessagePreview: safePreview(collected?.activeThreadMessage),
  }, true);
  context.activeStage = {
    stageName,
    artifactId,
    parentArtifactId,
    inputSummary: inputSummary(attempts),
    outputSummary: outputSummary(collected ?? {}, attempts),
    startedAt: Date.now(),
  };
  throw error;
}

async function startTurn({ appServer, activeTurnRuntime, workspaceRoot, threadId, inputs, timeoutSeconds, binding }) {
  if (typeof activeTurnRuntime?.start === "function") {
    return activeTurnRuntime.start({ workspaceRoot, threadId, inputs, timeoutSeconds, binding, enforceThreadId: false });
  }
  const result = await appServer.startTurnWithInputs({ workspaceRoot, threadId, inputs, timeoutSeconds });
  assertStartTurnResult(result);
  if (typeof activeTurnRuntime?.register === "function" && result?.turnId && binding) {
    await activeTurnRuntime.register({
      ...binding,
      workspaceRoot,
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

async function collectActiveTurn({ appServer, activeTurnRuntime, workspaceRoot, threadId, turnId, timeoutSeconds, traceContext }) {
  if (typeof activeTurnRuntime?.collect === "function") {
    return activeTurnRuntime.collect({ workspaceRoot, threadId, turnId, timeoutSeconds, traceContext });
  }
  const result = await appServer.collectTurnResult({ workspaceRoot, threadId, turnId, timeoutSeconds });
  assertExpectedCollectTurn(result, turnId);
  await activeTurnRuntime?.markCollectResult?.({ turnId, result, traceContext }).catch(() => null);
  return result;
}

function assertExpectedCollectTurn(result, expectedTurnId) {
  const actualTurnId = normalizeTurnId(result?.turnId ?? result?.turn?.id ?? null);
  const expected = normalizeTurnId(expectedTurnId);
  if (!actualTurnId || !expected || actualTurnId === expected) return;
  const error = new Error("AppServer turn/collect 返回了非目标 turn");
  error.code = "appserver_turn_collect_mismatch";
  error.statusCode = 502;
  error.retryable = true;
  error.debugPayload = {
    expectedTurnId: expected,
    actualTurnId,
    status: result?.status ?? null,
  };
  throw error;
}

function normalizeTurnId(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function buildActiveTurnBinding({ context, lease, stageName, role, prompt, sourceTurnId, attemptKind, parentArtifactId }) {
  const ownerId = context?.job?.jobId ?? context?.sampleVideoId ?? lease?.thread_id ?? null;
  if (!ownerId) return null;
  return {
    ownerType: "processing-job",
    ownerId,
    currentAttemptId: `${ownerId}:${stageName}:${attemptKind}:${context?.traceContext?.stageId ?? Date.now()}`,
    stageName,
    traceId: context?.traceContext?.traceId ?? null,
    runId: context?.traceContext?.runId ?? null,
    stageId: context?.traceContext?.stageId ?? null,
    artifactId: context?.artifactId ?? null,
    parentArtifactId: parentArtifactId ?? null,
    leaseId: lease?.lease_id ?? null,
    threadPoolOwnerId: `${context?.traceContext?.traceId ?? ownerId}:transform`,
    workspaceRoot: context?.roleProfile?.workspaceRoot ?? context?.rawWorkspaceRoot ?? null,
    replayRef: {
      type: "processing-job-input",
      refId: ownerId,
      messageId: prompt?.promptTemplateId ?? null,
      sourceTurnId: sourceTurnId ?? null,
    },
  };
}

function safePreview(value, maxLength = 200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function isPendingTurnStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress", "collecting"].includes(String(status ?? "").trim().toLowerCase());
}

function delay(ms) {
  const duration = Math.max(0, Number(ms || 0));
  return duration > 0 ? new Promise((resolve) => setTimeout(resolve, duration)) : Promise.resolve();
}
module.exports = {
  buildActiveTurnBinding,
  collectTurn,
  safePreview,
  startTurn,
};
