const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const defaultContactSheetGenerator = require("../../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { createAppServerBridge } = require("./appserver-bridge");
const { createThreadPoolProxy } = require("./threadpool-proxy");
const {
  ROLE,
  SKILL_PATH,
  buildFailedArtifact,
  buildProcessedAnalysis,
  buildTurnInputs,
  cacheParams,
  codedError,
  prepareInput,
  resolveSkillHash,
  safeError,
  sanitizeDebugPayload,
} = require("./shot-boundary-analysis");

const STAGES = {
  inputPrepared: "shot.input_prepare",
  contactSheetPrepared: "shot.contact_sheet",
  cacheReuse: "shot.cache_reuse",
  threadAcquired: "shot.thread_acquire",
  turnStarted: "shot.boundary_analyze.submit",
  turnCollected: "shot.boundary_analyze.collect",
  resultWritten: "shot.boundary_merge",
};
const POLL_INTERVAL_MS = 2000;
const ORPHAN_TTL_MS = 30 * 60 * 1000;

function createShotBoundaryService({
  rootDir,
  store,
  logger,
  jobStore,
  artifactIndex,
  threadPool = createThreadPoolProxy(),
  appServer = createAppServerBridge(),
  contactSheetGenerator = defaultContactSheetGenerator,
  skillPath = SKILL_PATH,
  pollIntervalMs = POLL_INTERVAL_MS,
  orphanTtlMs = ORPHAN_TTL_MS,
} = {}) {
  const collectingJobs = new Set();

  async function enqueue({ sampleVideoId, analysisFps = 1 }) {
    await store.ensureRuntimeDirs();
    const sampleArtifact = await loadSampleArtifact(sampleVideoId);
    const traceContext = createTraceContext(createTraceIds());
    const artifactId = `artifact_${randomUUID()}`;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    runAnalysis({ sampleVideoId, analysisFps: Number(analysisFps || 1), sampleArtifact, traceContext, artifactId, job }).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  function scheduleCollect(jobId, delayMs = pollIntervalMs) {
    const timer = setTimeout(() => collectAgentRun(jobId).catch(() => undefined), delayMs);
    timer.unref?.();
  }

  async function runAnalysis(context) {
    let lease = null;
    try {
      context.skillPath = skillPath;
      context.skillHash = await resolveSkillHash(skillPath);
      const prepared = await runStage(context, STAGES.inputPrepared, 20, {
        artifactId: context.artifactId,
        parentArtifactId: context.sampleArtifact.sampleVideo.artifactId,
        inputSummary: { sampleVideoId: context.sampleVideoId, analysisFps: context.analysisFps },
        action: () => prepareInput(context.sampleArtifact, context.analysisFps, { runtimeRoot: store.runtimeRoot }),
        outputSummary: (input) => ({
          frameCount: input.frames.length,
          stride: input.analysisSampling.stride,
          analysisFps: input.analysisSampling.fps,
          extractFps: round(input.extractSampling.actualFrameCount / input.durationSeconds),
        }),
      });
      const contactSheets = await runStage(context, STAGES.contactSheetPrepared, 45, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: {
          frameCount: prepared.frames.length,
          frameWidth: prepared.frameDimensions.width,
          frameHeight: prepared.frameDimensions.height,
        },
        action: () => contactSheetGenerator.generateContactSheets({
          frames: prepared.frames,
          frameWidth: prepared.frameDimensions.width,
          frameHeight: prepared.frameDimensions.height,
          sampleDir: store.sampleDir(context.sampleVideoId),
          parentArtifactId: prepared.sourceArtifactId,
          store,
        }),
        outputSummary: (sheets) => ({
          sheetCount: sheets.length,
          frameCount: sheets.reduce((sum, sheet) => sum + sheet.frameCount, 0),
          layouts: sheets.map((sheet) => ({
            sheetId: sheet.sheetId,
            width: sheet.layout.width,
            height: sheet.layout.height,
            cellWidth: sheet.layout.cellWidth,
            cellHeight: sheet.layout.cellHeight,
          })),
        }),
      });
      const cached = await findCachedArtifact(context, prepared, contactSheets);
      if (cached) {
        await logCacheReuse(context, cached);
        await attachAnalysis(context.sampleVideoId, cached.analysis);
        jobStore.updateJob(context.job.jobId, { stage: SAMPLE_STATUS.processed, status: SAMPLE_STATUS.processed, progress: 100 });
        return;
      }
      lease = await runStage(context, STAGES.threadAcquired, 60, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { role: ROLE, frameCount: prepared.frames.length, sheetCount: contactSheets.length },
        action: async () => {
          const readiness = typeof threadPool.ensureRoleReady === "function" ? await threadPool.ensureRoleReady(ROLE) : await fallbackEnsureRoleReady(threadPool, ROLE);
          if (!readiness?.ok) throw threadPoolReadinessError(readiness);
          try {
            return await threadPool.acquireLease({ role: ROLE, ownerId: context.traceContext.traceId });
          } catch (error) {
            throw normalizeThreadPoolAcquireError(error, readiness?.status ?? null);
          }
        },
        outputSummary: (result) => ({ role: ROLE, leaseId: result.lease_id, threadId: result.thread_id }),
      });
      const turn = await runStage(context, STAGES.turnStarted, 80, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { role: ROLE, threadId: lease.thread_id, leaseId: lease.lease_id, frameCount: prepared.frames.length, sheetCount: contactSheets.length },
        action: () => appServer.startTurnWithInputs({
          workspaceRoot: rootDir,
          threadId: lease.thread_id,
          skillPath,
          inputs: buildTurnInputs({ prepared, contactSheets }),
          timeoutSeconds: 240,
        }),
        outputSummary: (result) => ({ role: ROLE, threadId: result.threadId, turnId: result.turnId, status: result.status }),
      });
      const agentRun = buildAgentRun({ context, lease, turn, prepared, contactSheets });
      jobStore.updateJob(context.job.jobId, {
        agentRun,
        stage: STAGES.turnStarted,
        status: SAMPLE_STATUS.processing,
        progress: 80,
      });
      lease = null;
      scheduleCollect(context.job.jobId, 0);
    } catch (error) {
      if (lease?.thread_id) {
        await cleanupLease(threadPool, lease, context.traceContext.traceId, "shot-boundary-analysis-failed");
      }
      await markFailed(context, error);
    }
  }

  async function collectAgentRun(jobId) {
    if (collectingJobs.has(jobId)) return { status: "collecting" };
    collectingJobs.add(jobId);
    try {
      const job = jobStore.getJob(jobId);
      const agentRun = job?.agentRun;
      if (job?.status === SAMPLE_STATUS.processed || job?.status === SAMPLE_STATUS.failed) return { status: job.status };
      if (!job || !agentRun || !agentRun.threadId || !agentRun.turnId) return null;
      const sampleArtifact = await loadSampleArtifact(agentRun.sampleVideoId);
      const context = createRecoveredContext({ job, agentRun, sampleArtifact });
      if (Date.now() - Date.parse(agentRun.startedAt) > orphanTtlMs) {
        const error = codedError("shot_boundary_turn_orphaned", "切镜 Agent 长时间未完成，已清理遗留 lease");
        await failAgentRun(context, error);
        return { status: SAMPLE_STATUS.failed };
      }
      try {
        jobStore.updateJob(job.jobId, {
          agentRun: { ...agentRun, status: "collecting", updatedAt: new Date().toISOString() },
          stage: STAGES.turnCollected,
          status: SAMPLE_STATUS.processing,
          progress: 88,
        });
        const turn = await runStage(context, STAGES.turnCollected, 88, {
          artifactId: agentRun.artifactId,
          parentArtifactId: agentRun.parentArtifactId,
          inputSummary: { role: ROLE, threadId: agentRun.threadId, turnId: agentRun.turnId, sheetCount: agentRun.contactSheets?.length ?? 0 },
          action: () => appServer.collectTurnResult({
            workspaceRoot: rootDir,
            threadId: agentRun.threadId,
            turnId: agentRun.turnId,
            timeoutSeconds: 60,
          }),
          outputSummary: (result) => ({ role: ROLE, threadId: result.threadId, turnId: result.turnId, status: result.status }),
        });
        if (turn.status !== "completed") {
          jobStore.updateJob(job.jobId, {
            agentRun: { ...agentRun, status: "collecting", updatedAt: new Date().toISOString() },
            stage: STAGES.turnCollected,
            status: SAMPLE_STATUS.processing,
            progress: 88,
            errorSummary: null,
          });
          scheduleCollect(job.jobId);
          return turn;
        }
        await writeCompletedAnalysis({ context, agentRun, turn });
        return turn;
      } catch (error) {
        if (isRetryableCollectError(error)) {
          await markRetryableCollectFailure(context, error);
          scheduleCollect(job.jobId);
          return { status: "retrying" };
        }
        await failAgentRun(context, error);
        return { status: SAMPLE_STATUS.failed };
      }
    } finally {
      collectingJobs.delete(jobId);
    }
  }

  async function writeCompletedAnalysis({ context, agentRun, turn }) {
    const prepared = prepareInput(context.sampleArtifact, agentRun.analysisFps, { runtimeRoot: store.runtimeRoot });
    const contactSheets = agentRun.contactSheets ?? [];
    await runStage(context, STAGES.resultWritten, 95, {
      artifactId: context.artifactId,
      parentArtifactId: prepared.sourceArtifactId ?? null,
      inputSummary: { turnId: turn.turnId, frameCount: prepared.frames.length, sheetCount: contactSheets.length },
      action: async () => {
        const lease = { thread_id: agentRun.threadId, lease_id: agentRun.leaseId };
        const analysis = buildProcessedAnalysis(turn.finalMessage, prepared, contactSheets, context, lease, turn);
        await attachAnalysis(context.sampleVideoId, analysis);
        await artifactIndex.registerSampleArtifact({
          artifact: await loadSampleArtifact(context.sampleVideoId),
          fileHash: await resolveExistingFileHash(context.sampleVideoId),
          traceId: context.traceContext.traceId,
        });
        await finalizeLease(threadPool, agentRun);
        return analysis;
      },
      outputSummary: (result) => ({
        status: result.status,
        sheetCount: result.contactSheets?.length ?? 0,
        boundaryCount: result.boundaries?.length ?? 0,
        shotCount: result.shots.length,
        artifactType: result.type,
      }),
    });
    jobStore.updateJob(context.job.jobId, {
      agentRun: { ...agentRun, status: "completed", updatedAt: new Date().toISOString() },
      stage: SAMPLE_STATUS.processed,
      status: SAMPLE_STATUS.processed,
      progress: 100,
      errorSummary: null,
    });
  }

  async function failAgentRun(context, error) {
    const agentRun = context.job.agentRun;
    if (agentRun?.threadId || agentRun?.traceId) {
      await cleanupLease(threadPool, agentRun ? { thread_id: agentRun.threadId, lease_id: agentRun.leaseId } : null, agentRun?.traceId ?? null, "shot-boundary-analysis-failed");
    }
    await markFailed(context, error);
  }

  async function recoverActiveAgentRuns() {
    const jobs = typeof jobStore.listActiveAgentRuns === "function" ? jobStore.listActiveAgentRuns({ role: ROLE }) : [];
    await Promise.all(jobs.map((job) => collectAgentRun(job.jobId).catch(() => undefined)));
    const interrupted = await failInterruptedPreAgentJobs();
    return { recovered: jobs.length, interrupted };
  }

  async function failInterruptedPreAgentJobs() {
    const jobs = typeof jobStore.listJobs === "function" ? jobStore.listJobs().filter(isInterruptedPreAgentJob) : [];
    await Promise.all(jobs.map((job) => failInterruptedPreAgentJob(job).catch(() => undefined)));
    return jobs.length;
  }

  async function failInterruptedPreAgentJob(job) {
    if (job.traceId && typeof threadPool.releaseOwnerLeases === "function") {
      await threadPool.releaseOwnerLeases(job.traceId).catch(() => undefined);
    }
    const sampleArtifact = await loadSampleArtifact(job.sampleVideoId);
    const artifactId = `artifact_${randomUUID()}`;
    const context = {
      sampleVideoId: job.sampleVideoId,
      analysisFps: 1,
      sampleArtifact,
      traceContext: {
        runId: job.traceId,
        traceId: job.traceId,
        stageId: `stage_recover_${Date.now()}`,
      },
      artifactId,
      job,
      activeStage: {
        stageName: isShotStage(job.stage) ? job.stage : STAGES.threadAcquired,
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
    jobStore.updateJob(context.job.jobId, { stage: stageName, status: SAMPLE_STATUS.processing, progress });
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
      stageName: agentRun ? STAGES.turnCollected : STAGES.turnStarted,
      artifactId: context.artifactId,
      parentArtifactId: agentRun?.parentArtifactId ?? context.sampleArtifact?.sampleVideo?.artifactId ?? null,
      inputSummary: null,
      outputSummary: null,
      startedAt: Date.now(),
    };
    const errorSummary = safeError(error, activeStage.stageName);
    const failedArtifact = buildFailedArtifact(context, errorSummary, agentRun?.contactSheets ?? []);
    await attachAnalysis(context.sampleVideoId, failedArtifact).catch(() => undefined);
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      reason: errorSummary.code,
      inputSummary: activeStage.inputSummary,
      outputSummary: activeStage.outputSummary,
      debugPayload: sanitizeDebugPayload(error),
    });
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      event: "stage.fail",
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      outputSummary: activeStage.outputSummary,
      durationMs: activeStage.startedAt ? Date.now() - activeStage.startedAt : null,
      errorSummary: { ...errorSummary, debugSnapshotUri: snapshot.uri },
    });
    jobStore.updateJob(context.job.jobId, {
      agentRun: context.job.agentRun ? { ...context.job.agentRun, status: "failed", updatedAt: new Date().toISOString() } : context.job.agentRun,
      stage: activeStage.stageName,
      status: SAMPLE_STATUS.failed,
      progress: 100,
      errorSummary: { ...errorSummary, debugSnapshotUri: snapshot.uri },
    });
    context.activeStage = null;
  }

  async function markRetryableCollectFailure(context, error) {
    const agentRun = context.job.agentRun;
    const errorSummary = {
      code: error?.code ?? "appserver_turn_collect_retryable",
      message: error instanceof Error ? error.message : "AppServer turn 补查暂时失败",
      stageName: STAGES.turnCollected,
      retryable: true,
    };
    jobStore.updateJob(context.job.jobId, {
      agentRun: agentRun ? { ...agentRun, status: "collecting", updatedAt: new Date().toISOString() } : agentRun,
      stage: STAGES.turnCollected,
      status: SAMPLE_STATUS.processing,
      progress: 88,
      errorSummary,
    });
  }

  async function loadSampleArtifact(sampleVideoId) {
    return store.readJson(path.join(store.sampleDir(sampleVideoId), "artifact.json"));
  }

  async function attachAnalysis(sampleVideoId, analysis) {
    const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
    const artifact = await store.readJson(artifactPath);
    artifact.shotBoundaryAnalysis = analysis;
    await store.writeJson(artifactPath, artifact);
    return artifact;
  }

  async function findCachedArtifact(context, prepared, contactSheets) {
    const fileHash = await resolveExistingFileHash(context.sampleVideoId);
    if (!fileHash) return null;
    const cache = await artifactIndex.findCacheEntry({
      fileHash,
      stageName: STAGES.resultWritten,
      params: cacheParams(prepared, contactSheets, { skillHash: context.skillHash }),
    });
    if (!cache?.sampleVideoId) return null;
    const artifact = await artifactIndex.loadItem(cache.sampleVideoId);
    const analysis = artifact?.shotBoundaryAnalysis ?? null;
    return analysis ? { cache, analysis } : null;
  }

  async function logCacheReuse(context, cached) {
    const analysis = cached.analysis;
    const startedAt = Date.now();
    context.traceContext = nextStage(context.traceContext);
    const outputSummary = {
      sourceSampleVideoId: cached.cache.sampleVideoId,
      cacheKey: cached.cache.cacheKey,
      sourceTurnId: analysis.agent?.turnId ?? null,
      boundaryCount: analysis.boundaries?.length ?? 0,
      shotCount: analysis.shots?.length ?? 0,
    };
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: STAGES.cacheReuse,
      event: "stage.start",
      artifactId: context.artifactId,
      parentArtifactId: analysis.parentArtifactId ?? context.sampleArtifact?.sampleVideo?.artifactId ?? null,
      inputSummary: {
        sampleVideoId: context.sampleVideoId,
        sourceSampleVideoId: cached.cache.sampleVideoId,
        cacheKey: cached.cache.cacheKey,
      },
    });
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: STAGES.cacheReuse,
      event: "stage.end",
      artifactId: context.artifactId,
      parentArtifactId: analysis.parentArtifactId ?? context.sampleArtifact?.sampleVideo?.artifactId ?? null,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
  }

  async function resolveExistingFileHash(sampleVideoId) {
    const detail = await artifactIndex.getItem(sampleVideoId);
    return detail?.fileHash ?? `sampleVideoId:${sampleVideoId}`;
  }

  return { enqueue, prepareInput, buildTurnInputs, collectAgentRun, recoverActiveAgentRuns };
}

function isInterruptedPreAgentJob(job) {
  if (!job || job.agentRun) return false;
  if (![SAMPLE_STATUS.pending, SAMPLE_STATUS.processing].includes(job.status)) return false;
  return isShotStage(job.stage);
}

function isShotStage(stageName) {
  return Object.values(STAGES).includes(stageName);
}

function buildAgentRun({ context, lease, turn, prepared, contactSheets }) {
  const now = new Date().toISOString();
  return {
    provider: "codex-appserver",
    role: ROLE,
    skillPath: context.skillPath ?? SKILL_PATH,
    skillHash: context.skillHash ?? null,
    leaseId: lease.lease_id,
    threadId: lease.thread_id,
    turnId: turn.turnId ?? null,
    traceId: context.traceContext.traceId,
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId ?? null,
    sampleVideoId: context.sampleVideoId,
    analysisFps: context.analysisFps,
    status: "turn_submitted",
    contactSheets,
    preparedInputSummary: {
      frameCount: prepared.frames.length,
      stride: prepared.analysisSampling.stride,
      analysisFps: prepared.analysisSampling.fps,
      sheetCount: contactSheets.length,
    },
    startedAt: now,
    updatedAt: now,
  };
}

function createRecoveredContext({ job, agentRun, sampleArtifact }) {
  return {
    sampleVideoId: agentRun.sampleVideoId,
    analysisFps: agentRun.analysisFps,
    sampleArtifact,
    traceContext: {
      runId: agentRun.traceId,
      traceId: agentRun.traceId,
      stageId: `stage_recover_${Date.now()}`,
    },
    artifactId: agentRun.artifactId,
    skillPath: agentRun.skillPath ?? SKILL_PATH,
    skillHash: agentRun.skillHash ?? null,
    job,
    activeStage: null,
  };
}

function isRetryableCollectError(error) {
  const code = String(error?.code ?? "");
  return ["appserver_bridge_failed", "appserver_bridge_timeout", "appserver_turn_collect_failed"].includes(code);
}

async function finalizeLease(threadPool, agentRun) {
  const config = typeof threadPool.config === "function" ? await threadPool.config().catch(() => null) : null;
  if (config?.ok && config.discardOnRelease && agentRun?.threadId) {
    await threadPool.discardThread({ threadId: agentRun.threadId, reason: "graceful-successful-release" });
    if (typeof threadPool.releaseOwnerLeases === "function" && agentRun?.traceId) {
      await threadPool.releaseOwnerLeases(agentRun.traceId).catch(() => undefined);
    }
    return { mode: "graceful-discard" };
  }
  await threadPool.releaseLease({ leaseId: agentRun.leaseId, ownerId: agentRun.traceId });
  return { mode: "lease-release" };
}

async function cleanupLease(threadPool, lease, ownerId, reason) {
  if (lease?.thread_id) {
    await threadPool.discardThread({ threadId: lease.thread_id, reason }).catch(() => undefined);
  }
  if (ownerId && typeof threadPool.releaseOwnerLeases === "function") {
    await threadPool.releaseOwnerLeases(ownerId).catch(() => undefined);
  }
}

async function fallbackEnsureRoleReady(threadPool, role) {
  const status = await threadPool.roleStatus(role);
  if (!status?.ok) return status;
  if (status.warming) {
    return {
      ok: false,
      error: "threadpool_warming",
      message: "ThreadPool 正在 warming，请稍后再试",
      retryable: true,
      detail: {
        role: status.role,
        readyForLeases: Boolean(status.readyForLeases),
        canAcquire: Boolean(status.canAcquire),
        warming: Boolean(status.warming),
        warmupDetail: status.warmupDetail ?? null,
        warmupError: status.warmupError ?? null,
        startupError: status.startupError ?? null,
      },
    };
  }
  if (status.startupError || status.warmupError || !status.readyForLeases || !status.canAcquire) {
    return {
      ok: false,
      error: "threadpool_acquire_failed",
      message: String(status.startupError || status.warmupError || (!status.readyForLeases ? "ThreadPool 当前未 ready，请稍后再试" : "ThreadPool 当前不可获取 lease，请稍后再试")).slice(0, 240),
      retryable: true,
      detail: {
        role: status.role,
        readyForLeases: Boolean(status.readyForLeases),
        canAcquire: Boolean(status.canAcquire),
        warming: Boolean(status.warming),
        warmupDetail: status.warmupDetail ?? null,
        warmupError: status.warmupError ?? null,
        startupError: status.startupError ?? null,
      },
    };
  }
  return { ok: true, role, status };
}

function threadPoolReadinessError(readiness) {
  return codedError(
    readiness?.error ?? "threadpool_acquire_failed",
    readiness?.message ?? "ThreadPool 当前不可用，请稍后再试",
    {
      threadPool: readiness?.detail ?? null,
      readinessError: readiness?.error ?? null,
      retryable: readiness?.retryable ?? true,
    },
    readiness?.retryable ?? true,
  );
}

function normalizeThreadPoolAcquireError(error, status) {
  if (error?.code === "threadpool_timeout" || error?.code === "threadpool_request_failed") {
    return codedError(
      "threadpool_unavailable",
      "ThreadPool 当前不可用，请稍后再试",
      {
        threadPool: status
          ? {
            role: status.role,
            readyForLeases: Boolean(status.readyForLeases),
            canAcquire: Boolean(status.canAcquire),
            warming: Boolean(status.warming),
            warmupError: status.warmupError ?? null,
            startupError: status.startupError ?? null,
          }
          : null,
        requestError: error instanceof Error ? error.message : String(error ?? "unknown"),
      },
      true,
    );
  }
  return codedError(
    "threadpool_acquire_failed",
    error instanceof Error ? error.message : "ThreadPool 获取 lease 失败",
    {
      threadPool: status
        ? {
          role: status.role,
          readyForLeases: Boolean(status.readyForLeases),
          canAcquire: Boolean(status.canAcquire),
          warming: Boolean(status.warming),
          warmupError: status.warmupError ?? null,
          startupError: status.startupError ?? null,
        }
        : null,
        requestError: error instanceof Error ? error.message : String(error ?? "unknown"),
    },
    true,
  );
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

module.exports = { ROLE, SKILL_PATH, STAGES, createShotBoundaryService, prepareInput, buildTurnInputs };
