const { randomUUID } = require("crypto");
const { cleanupLease } = require("./threadpool-runner");

function createShotBoundaryServiceRuntime({
  logger,
  jobStore,
  threadPool,
  sampleStatus,
  appServer,
  rawWorkspaceRoot,
  stages,
  nextStage,
  safeError,
  sanitizeDebugPayload,
  buildFailedArtifact,
  attachAnalysis,
  isShotStage,
  isInterruptedPreAgentJob,
  codedError,
}) {
  async function runStage(context, stageName, progress, options) {
    context.traceContext = nextStage(context.traceContext);
    const startedAt = Date.now();
    context.activeStage = {
      stageName,
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.inputSummary ?? null,
      outputSummary: null,
      startedAt,
    };
    jobStore.updateJob(context.job.jobId, { stage: stageName, status: sampleStatus.processing, progress });
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.start",
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.inputSummary ?? null,
    });
    const result = await options.action();
    const outputSummary = options.outputSummary ? options.outputSummary(result) : null;
    context.activeStage.outputSummary = outputSummary;
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.end",
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    context.activeStage = null;
    return result;
  }

  async function markFailed(context, error) {
    const agentRun = context.job?.agentRun ?? null;
    const activeStage = context.activeStage ?? {
      stageName: agentRun ? stages.turnCollected : stages.turnStarted,
      artifactId: context.artifactId,
      parentArtifactId: agentRun?.parentArtifactId ?? context.sampleArtifact?.sampleVideo?.artifactId ?? null,
      inputSummary: null,
      outputSummary: null,
      startedAt: Date.now(),
    };
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      reason: error?.code ?? "shot_boundary_failed",
      inputSummary: activeStage.inputSummary,
      outputSummary: activeStage.outputSummary,
      debugPayload: sanitizeDebugPayload(error),
    });
    const preAgentFailure = !agentRun?.turnId && isPreAgentStage(activeStage.stageName);
    const errorSummary = {
      ...safeError(error, activeStage.stageName),
      debugSnapshotUri: snapshot.uri,
      preAgentFailure,
      turnSubmitted: Boolean(agentRun?.turnId),
    };
    const failedArtifact = buildFailedArtifact({ ...context, validationSummary: context.validationSummary }, errorSummary, agentRun?.contactSheets ?? []);
    await attachAnalysis(context.sampleVideoId, failedArtifact, {
      traceId: context.traceContext.traceId,
      sourceTraceId: context.sampleArtifact?.trace?.traceId ?? null,
    }).catch(() => undefined);
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
      agentRun: context.job.agentRun ? { ...context.job.agentRun, status: "failed", updatedAt: new Date().toISOString() } : context.job.agentRun,
      stage: activeStage.stageName,
      status: sampleStatus.failed,
      progress: 100,
      errorSummary,
      activeThreadMessage: null,
    });
    context.activeStage = null;
  }

  function updateActiveThreadMessage(context, threadId, turnId, message, status, options = {}) {
    const normalized = buildActiveThreadMessage(threadId, turnId, message, status, options);
    if (normalized || !isPendingTurnStatus(status)) {
      jobStore.updateJob(context.job.jobId, { activeThreadMessage: normalized });
    }
    return normalized;
  }

  async function failAgentRun(context, error) {
    const agentRun = context.job.agentRun;
    if (agentRun?.leaseId && (agentRun?.threadId || agentRun?.traceId)) {
      await cleanupLease(
        threadPool,
        agentRun ? { thread_id: agentRun.threadId, lease_id: agentRun.leaseId } : null,
        agentRun?.traceId ?? null,
        "shot-boundary-analysis-failed",
      );
    }
    await markFailed(context, error);
  }

  async function recoverActiveAgentRuns({ role, collectAgentRun, loadSampleArtifact }) {
    const jobs = typeof jobStore.listActiveAgentRuns === "function" ? jobStore.listActiveAgentRuns({ role }) : [];
    await Promise.all(jobs.map((job) => collectAgentRun(job.jobId).catch(() => undefined)));
    const interrupted = await failInterruptedPreAgentJobs(loadSampleArtifact);
    return { recovered: jobs.length, interrupted };
  }

  async function interruptActiveAgentRuns({ role, loadSampleArtifact, reason = "server-startup" }) {
    const activeAgentJobs = typeof jobStore.listActiveAgentRuns === "function" ? jobStore.listActiveAgentRuns({ role }) : [];
    await Promise.all(activeAgentJobs.map((job) => failActiveAgentJob(job, loadSampleArtifact, reason).catch(() => undefined)));
    const interrupted = await failInterruptedPreAgentJobs(loadSampleArtifact);
    return { interruptedAgentRuns: activeAgentJobs.length, interrupted };
  }

  async function failInterruptedPreAgentJobs(loadSampleArtifact) {
    const jobs = typeof jobStore.listJobs === "function" ? jobStore.listJobs().filter(isInterruptedPreAgentJob) : [];
    await Promise.all(jobs.map((job) => failInterruptedPreAgentJob(job, loadSampleArtifact).catch(() => undefined)));
    return jobs.length;
  }

  async function failActiveAgentJob(job, loadSampleArtifact, reason) {
    const agentRun = job.agentRun;
    if (!agentRun) return;
    if (agentRun.traceId && typeof threadPool.releaseOwnerLeases === "function") {
      await threadPool.releaseOwnerLeases(agentRun.traceId).catch(() => undefined);
    }
    if (agentRun.threadId && agentRun.turnId && typeof appServer?.cancelTurn === "function") {
      await appServer.cancelTurn({
        workspaceRoot: rawWorkspaceRoot,
        threadId: agentRun.threadId,
        turnId: agentRun.turnId,
        timeoutSeconds: 30,
      }).catch(() => undefined);
    }
    if (agentRun.threadId && typeof threadPool.discardThread === "function") {
      await threadPool.discardThread({ threadId: agentRun.threadId, reason: `shot-boundary-interrupted-${reason}` }).catch(() => undefined);
    }
    const sampleArtifact = await loadSampleArtifact(job.sampleVideoId);
    const context = {
      sampleVideoId: job.sampleVideoId,
      analysisFps: agentRun.analysisFps ?? 10,
      sampleArtifact,
      traceContext: {
        runId: agentRun.traceId ?? job.traceId,
        traceId: agentRun.traceId ?? job.traceId,
        stageId: `stage_recover_${Date.now()}`,
      },
      artifactId: agentRun.artifactId ?? `artifact_${randomUUID()}`,
      job,
      activeStage: {
        stageName: stages.turnCollected,
        artifactId: agentRun.artifactId ?? null,
        parentArtifactId: agentRun.parentArtifactId ?? sampleArtifact?.sampleVideo?.artifactId ?? null,
        inputSummary: { jobId: job.jobId, previousStage: job.stage, previousProgress: job.progress, threadId: agentRun.threadId ?? null, turnId: agentRun.turnId ?? null },
        outputSummary: null,
        startedAt: Date.now(),
      },
    };
    const error = codedError(
      "shot_boundary_job_interrupted",
      "切镜任务因服务重启已清理为失败状态，请重新运行",
      { previousStage: job.stage, previousProgress: job.progress, reason, retryable: true },
      true,
    );
    await markFailed(context, error);
  }

  async function failInterruptedPreAgentJob(job, loadSampleArtifact) {
    if (job.traceId && typeof threadPool.releaseOwnerLeases === "function") {
      await threadPool.releaseOwnerLeases(job.traceId).catch(() => undefined);
    }
    const sampleArtifact = await loadSampleArtifact(job.sampleVideoId);
    const artifactId = `artifact_${randomUUID()}`;
    const context = {
      sampleVideoId: job.sampleVideoId,
      analysisFps: 10,
      sampleArtifact,
      traceContext: {
        runId: job.traceId,
        traceId: job.traceId,
        stageId: `stage_recover_${Date.now()}`,
      },
      artifactId,
      job,
      activeStage: {
        stageName: isShotStage(job.stage) ? job.stage : stages.threadAcquired,
        artifactId,
        parentArtifactId: sampleArtifact?.sampleVideo?.artifactId ?? null,
        inputSummary: { jobId: job.jobId, previousStage: job.stage, previousProgress: job.progress },
        outputSummary: null,
        startedAt: Date.now(),
      },
    };
    const error = codedError(
      "shot_boundary_job_interrupted",
      "切镜任务在提交 Agent 前被中断，已清理为失败状态，请重新运行",
      { previousStage: job.stage, previousProgress: job.progress, retryable: true },
      true,
    );
    await markFailed(context, error);
  }

  async function markRetryableCollectFailure(context, error) {
    const agentRun = context.job.agentRun;
    const errorSummary = {
      code: error?.code ?? "appserver_turn_collect_retryable",
      message: error instanceof Error ? error.message : "AppServer turn 补查暂时失败",
      stageName: stages.turnCollected,
      retryable: true,
    };
    jobStore.updateJob(context.job.jobId, {
      agentRun: agentRun ? { ...agentRun, status: "collecting", updatedAt: new Date().toISOString() } : agentRun,
      stage: stages.turnCollected,
      status: sampleStatus.processing,
      progress: 88,
      errorSummary,
    });
  }

  return {
    runStage,
    markFailed,
    updateActiveThreadMessage,
    failAgentRun,
    recoverActiveAgentRuns,
    interruptActiveAgentRuns,
    markRetryableCollectFailure,
  };
}

function isPreAgentStage(stageName) {
  return ["shot.input_prepare", "shot.cache_lookup", "shot.raw_video_analyze.thread_start"].includes(stageName);
}

function buildActiveThreadMessage(threadId, turnId, message, status, options = {}) {
  const text = String(message ?? "").trim() || String(options.fallbackMessage ?? "").trim();
  if (!text || !isPendingTurnStatus(status)) return null;
  return {
    threadId: threadId ?? null,
    turnId: turnId ?? null,
    role: options.role ?? "thread",
    text: text.length <= 1200 ? text : `${text.slice(0, 1200)}...`,
    createdAt: new Date().toISOString(),
  };
}

function isPendingTurnStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress", "collecting"].includes(String(status ?? "").trim().toLowerCase());
}

module.exports = {
  createShotBoundaryServiceRuntime,
};
