function createAnalysisRuntime({
  logger,
  jobStore,
  sampleStatus,
  safeError,
  sanitizeDebugPayload,
  buildFailedArtifact,
  attachFailedAnalysis,
  defaultFailedStageName,
  resolveDefaultParentArtifactId,
}) {
  async function runStage(context, stageName, progress, options) {
    context.traceContext = context.nextStage(context.traceContext);
    const startedAt = Date.now();
    context.activeStage = {
      stageName,
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.inputSummary ?? null,
      outputSummary: null,
      startedAt,
    };
    jobStore.updateJob(context.job.jobId, {
      stage: stageName,
      status: sampleStatus.processing,
      progress,
      errorSummary: null,
    });
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.start",
      artifactId: context.activeStage.artifactId,
      parentArtifactId: context.activeStage.parentArtifactId,
      inputSummary: context.activeStage.inputSummary,
    });
    const result = await options.action();
    const outputSummary = options.outputSummary ? options.outputSummary(result) : null;
    context.activeStage.outputSummary = outputSummary;
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.end",
      artifactId: context.activeStage.artifactId,
      parentArtifactId: context.activeStage.parentArtifactId,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    context.activeStage = null;
    return result;
  }

  async function markFailed(context, error) {
    const activeStage = context.activeStage ?? {
      stageName: defaultFailedStageName,
      artifactId: context.artifactId,
      parentArtifactId: resolveDefaultParentArtifactId(context),
      inputSummary: {
        sampleVideoId: context.sampleVideoId,
      },
      outputSummary: null,
      startedAt: Date.now(),
    };
    const safe = safeError(error, activeStage.stageName);
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      reason: safe.code,
      inputSummary: activeStage.inputSummary,
      outputSummary: activeStage.outputSummary,
      debugPayload: sanitizeDebugPayload(error),
    });
    const errorSummary = { ...safe, debugSnapshotUri: snapshot.uri };
    const failedArtifact = buildFailedArtifact(context, errorSummary, snapshot.uri);
    await attachFailedAnalysis(context.sampleVideoId, failedArtifact).catch(() => undefined);
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      event: "stage.fail",
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      outputSummary: activeStage.outputSummary,
      durationMs: activeStage.startedAt ? Date.now() - activeStage.startedAt : null,
      errorSummary,
    });
    jobStore.updateJob(context.job.jobId, {
      agentRun: context.agentRun
        ? { ...context.agentRun, status: "failed", updatedAt: new Date().toISOString() }
        : context.agentRun,
      stage: activeStage.stageName,
      status: sampleStatus.failed,
      progress: 100,
      errorSummary,
      activeThreadMessage: null,
    });
    context.activeStage = null;
  }

  function updateActiveThreadMessage(context, turn) {
    const activeThreadMessage = buildActiveThreadMessage(
      turn?.threadId,
      turn?.turnId,
      turn?.activeThreadMessage,
      turn?.status,
    );
    jobStore.updateJob(context.job.jobId, { activeThreadMessage });
    return activeThreadMessage;
  }

  return {
    runStage,
    markFailed,
    updateActiveThreadMessage,
  };
}

function assertExpectedArtifact({
  expectedArtifactId,
  actualArtifactId,
  conflictError,
  code,
  message,
  expectedKey,
  actualKey,
}) {
  const expected = String(expectedArtifactId ?? "").trim();
  if (!expected) return;
  const actual = String(actualArtifactId ?? "").trim();
  if (actual === expected) return;
  throw conflictError(code, message, {
    [expectedKey]: expected,
    [actualKey]: actual || null,
  });
}

function buildActiveThreadMessage(threadId, turnId, message, status) {
  const text = String(message ?? "").trim();
  if (!text || !isPendingTurnStatus(status)) return null;
  return {
    threadId: threadId ?? null,
    turnId: turnId ?? null,
    role: "thread",
    text: text.length <= 1200 ? text : `${text.slice(0, 1200)}...`,
    createdAt: new Date().toISOString(),
  };
}

function isPendingTurnStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress", "collecting"].includes(
    String(status ?? "").trim().toLowerCase(),
  );
}

module.exports = {
  createAnalysisRuntime,
  assertExpectedArtifact,
  buildActiveThreadMessage,
  isPendingTurnStatus,
};
