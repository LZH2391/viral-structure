function createStageRuntime({
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

  return { runStage, markFailed };
}

module.exports = {
  createStageRuntime,
};
