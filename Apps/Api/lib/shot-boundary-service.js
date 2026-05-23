const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const defaultContactSheetGenerator = require("../../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { createAppServerBridge } = require("./appserver-bridge");
const { createThreadPoolProxy } = require("./threadpool-proxy");
const { loadRoleProfileByRole } = require("./role-profile-loader");
const { appendShotBoundaryHistory } = require("./shot-boundary/history");
const {
  finalizeLease,
  cleanupLease,
  acquireLeaseWithRetry,
} = require("./shot-boundary/threadpool-runner");
const {
  isShotStage: isShotStageImpl,
  isInterruptedPreAgentJob: isInterruptedPreAgentJobImpl,
  buildAgentRun: buildAgentRunImpl,
  createRecoveredContext: createRecoveredContextImpl,
  isRetryableCollectError,
} = require("./shot-boundary/agent-run");
const {
  findCachedArtifact: findCachedArtifactImpl,
  runCacheLookup: runCacheLookupImpl,
  resolveCachedPrompt: resolveCachedPromptImpl,
  markCacheWaiting: markCacheWaitingImpl,
  resolveExistingFileHash: resolveExistingFileHashImpl,
  reuseCachedAnalysis: reuseCachedAnalysisImpl,
} = require("./shot-boundary/cache");
const { writeCompletedAnalysis } = require("./shot-boundary/result-writer");
const {
  ROLE,
  MAX_REPAIR_ATTEMPTS,
  SKILL_PATH,
  buildCacheReuseAnalysis,
  buildFailedArtifact,
  buildProcessedAnalysis,
  buildTurnInputs,
  renderAnalyzeTurnInputs,
  cacheParams,
  legacyCacheParams,
  codedError,
  evaluateCacheEligibility,
  prepareInput,
  renderRepairTurnInputs,
  renderSummaryTurnInputs,
  resolveSkillHash,
  safeError,
  sanitizeDebugPayload,
  contentHash,
  validateCommerceBriefOutput,
} = require("./shot-boundary-analysis");

const STAGES = {
  inputPrepared: "shot.input_prepare",
  contactSheetPrepared: "shot.contact_sheet",
  cacheLookup: "shot.cache_lookup",
  cacheReuse: "shot.cache_reuse",
  threadAcquired: "shot.thread_acquire",
  turnStarted: "shot.boundary_analyze.submit",
  turnCollected: "shot.boundary_analyze.collect",
  turnValidated: "shot.boundary_validate",
  summaryStarted: "shot.summary.submit",
  summaryCollected: "shot.summary.collect",
  summaryValidated: "shot.summary_validate",
  turnRepaired: "shot.boundary_repair.submit",
  repairCollected: "shot.boundary_repair.collect",
  resultWritten: "shot.boundary_merge",
};
const POLL_INTERVAL_MS = 2000;
const ORPHAN_TTL_MS = 30 * 60 * 1000;
const THREADPOOL_ACQUIRE_MAX_ATTEMPTS = 3;
const THREADPOOL_ACQUIRE_BACKOFF_MS = [500, 1000];
cacheParams.legacy = legacyCacheParams;

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
  const collectingJobs = new Map();

  async function enqueue({ sampleVideoId, analysisFps = 1, cacheDecision = "ask" }) {
    await store.ensureRuntimeDirs();
    const sampleArtifact = await loadSampleArtifact(sampleVideoId);
    const traceContext = createTraceContext(createTraceIds());
    const artifactId = `artifact_${randomUUID()}`;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    const context = {
      sampleVideoId,
      analysisFps: Number(analysisFps || 1),
      cacheDecision,
      sampleArtifact,
      traceContext,
      artifactId,
      skillPath,
      skillHash: await resolveSkillHash(skillPath),
      roleProfile: await loadRoleProfileByRole(ROLE),
      initFingerprint: null,
      promptTemplate: null,
      job,
    };
    context.initFingerprint = buildInitFingerprint(context);
    runAnalysis(context).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function resolveCacheDecision({ jobId, decision }) {
    const job = jobStore.getJob(jobId);
    if (!job || job.status !== SAMPLE_STATUS.cacheWaiting || !job.cachePrompt) {
      throw badRequestError("cache_decision_invalid_job", "只能对等待缓存选择的切镜任务执行该操作");
    }
    const sampleArtifact = await loadSampleArtifact(job.sampleVideoId);
    const context = {
      sampleVideoId: job.sampleVideoId,
      analysisFps: Number(job.cachePrompt.analysisFps ?? 1),
      cacheDecision: decision,
      sampleArtifact,
      traceContext: {
        runId: job.traceId,
        traceId: job.traceId,
        stageId: `stage_cache_decision_${Date.now()}`,
      },
      artifactId: job.cachePrompt.artifactId ?? `artifact_${randomUUID()}`,
      skillPath: job.cachePrompt.skillPath ?? skillPath,
      skillHash: job.cachePrompt.skillHash ?? await resolveSkillHash(skillPath),
      roleProfile: await loadRoleProfileByRole(ROLE),
      initFingerprint: job.cachePrompt.initFingerprint ?? null,
      promptTemplate: {
        promptTemplateId: job.cachePrompt.promptTemplateId ?? null,
        promptTemplateVersion: job.cachePrompt.promptTemplateVersion ?? null,
        promptTemplateHash: job.cachePrompt.promptTemplateHash ?? null,
      },
      job,
    };
    if (decision === "reuse") {
      try {
        await reuseCachedAnalysis(context, job.cachePrompt);
      } catch (error) {
        await markFailed(context, error);
      }
      return jobStore.getJob(jobId);
    }
    if (decision === "refresh") {
      jobStore.updateJob(jobId, { cachePrompt: null, errorSummary: null, status: SAMPLE_STATUS.processing, stage: STAGES.cacheLookup, progress: 56 });
      runAnalysis({ ...context, cacheDecision: "refresh" }).catch(() => undefined);
      return jobStore.getJob(jobId);
    }
    throw badRequestError("cache_decision_invalid", "缓存选择无效，请选择复用或重新分析");
  }

  function scheduleCollect(jobId, delayMs = pollIntervalMs) {
    const timer = setTimeout(() => collectAgentRun(jobId).catch(() => undefined), delayMs);
    timer.unref?.();
  }

  async function runAnalysis(context) {
    let lease = null;
    try {
      const prepared = await runStage(context, STAGES.inputPrepared, 20, {
        artifactId: context.artifactId,
        parentArtifactId: context.sampleArtifact.sampleVideo.artifactId,
        inputSummary: { sampleVideoId: context.sampleVideoId, analysisFps: context.analysisFps },
        action: () => context.prepared ?? prepareInput(context.sampleArtifact, context.analysisFps, { runtimeRoot: store.runtimeRoot }),
        outputSummary: (input) => ({
          frameCount: input.frames.length,
          requestedFps: input.analysisSampling.requestedFps,
          selectedFrameCount: input.analysisSampling.selectedFrameCount,
          effectiveFps: input.analysisSampling.effectiveFps,
          selectionPolicy: input.analysisSampling.selectionPolicy,
          extractFps: round(input.extractSampling.actualFrameCount / input.durationSeconds),
          subtitleSegmentCount: input.subtitleContextSummary?.subtitleSegmentCount ?? 0,
          subtitleTextHash: input.subtitleContextSummary?.subtitleTextHash ?? null,
          subtitleTruncated: Boolean(input.subtitleContextSummary?.truncated),
        }),
      });
      context.prepared = prepared;
      const contactSheets = await runStage(context, STAGES.contactSheetPrepared, 45, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: {
          frameCount: prepared.frames.length,
          frameWidth: prepared.frameDimensions.width,
          frameHeight: prepared.frameDimensions.height,
        },
        action: () => context.contactSheets ?? contactSheetGenerator.generateContactSheets({
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
        }),
      });
      context.contactSheets = contactSheets;
      const analyzeTurn = renderAnalyzeTurnInputs({ prepared, contactSheets, roleProfile: context.roleProfile });
      context.promptTemplate = {
        promptTemplateId: analyzeTurn.promptTemplateId,
        promptTemplateVersion: analyzeTurn.promptTemplateVersion,
        promptTemplateHash: analyzeTurn.promptTemplateHash,
      };
      const cached = await runCacheLookup(context, prepared, contactSheets);
      if (cached && context.cacheDecision === "ask") {
        markCacheWaiting(context, cached);
        return;
      }
      if (cached && context.cacheDecision === "reuse") {
        await reuseCachedAnalysis(context, buildCachePrompt(context, cached));
        return;
      }
      const leaseAcquisition = await runStage(context, STAGES.threadAcquired, 60, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { role: ROLE, frameCount: prepared.frames.length, sheetCount: contactSheets.length },
        action: () => acquireLeaseWithRetry(threadPool, {
          role: ROLE,
          ownerId: context.traceContext.traceId,
          maxAttempts: THREADPOOL_ACQUIRE_MAX_ATTEMPTS,
          backoffMs: THREADPOOL_ACQUIRE_BACKOFF_MS,
          codedError,
        }),
        outputSummary: (result) => ({
          role: ROLE,
          leaseId: result.lease.lease_id,
          threadId: result.lease.thread_id,
          attemptCount: result.attemptCount,
          requestTimeoutMs: result.requestTimeoutMs ?? null,
        }),
      });
      lease = leaseAcquisition.lease;
      const turn = await runStage(context, STAGES.turnStarted, 80, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { role: ROLE, threadId: lease.thread_id, leaseId: lease.lease_id, frameCount: prepared.frames.length, sheetCount: contactSheets.length },
        action: () => appServer.startTurnWithInputs({
          workspaceRoot: rootDir,
          threadId: lease.thread_id,
          inputs: analyzeTurn.inputs,
          timeoutSeconds: 240,
        }),
        outputSummary: (result) => ({
          role: ROLE,
          threadId: result.threadId,
          turnId: result.turnId,
          status: result.status,
          profileVersion: context.roleProfile?.profileVersion ?? null,
          promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
          promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
          promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
        }),
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
    if (collectingJobs.has(jobId)) return collectingJobs.get(jobId);
    const task = (async () => {
      const job = jobStore.getJob(jobId);
      const agentRun = job?.agentRun;
      if (job?.status === SAMPLE_STATUS.processed || job?.status === SAMPLE_STATUS.failed) return { status: job.status };
      if (!job || !agentRun || !agentRun.threadId || !agentRun.turnId) return null;
      const sampleArtifact = await loadSampleArtifact(agentRun.sampleVideoId);
      const context = createRecoveredContext({ job, agentRun, sampleArtifact, skillPath: SKILL_PATH });
      if (!context.roleProfile?.turnTemplates) {
        context.roleProfile = await loadRoleProfileByRole(ROLE);
      }
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
          outputSummary: (result) => ({
            role: ROLE,
            threadId: result.threadId,
            turnId: result.turnId,
            status: result.status,
            profileVersion: context.roleProfile?.profileVersion ?? null,
            promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
            promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
            promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
          }),
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
        await writeCompletedAnalysis({
          context,
          agentRun,
          turn,
          runStage,
          stages: STAGES,
          prepareInput,
          store,
          buildProcessedAnalysis,
          attachAnalysis,
          artifactIndex,
          resolveExistingFileHash: (sampleVideoId) => resolveExistingFileHashImpl(sampleVideoId, artifactIndex),
          loadSampleArtifact,
          finalizeLease,
          threadPool,
          maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
          appServer,
          rootDir,
          renderRepairTurnInputs,
          renderSummaryTurnInputs,
          validateCommerceBriefOutput,
          codedError,
          role: ROLE,
          jobStore,
          sampleStatus: SAMPLE_STATUS,
        });
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
    })();
    collectingJobs.set(jobId, task);
    try {
      return await task;
    } finally {
      collectingJobs.delete(jobId);
    }
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
    const isPreAgentFailure = !agentRun?.turnId && isPreAgentStage(activeStage.stageName);
    const errorSummary = {
      ...safeError(error, activeStage.stageName),
      debugSnapshotUri: snapshot.uri,
      preAgentFailure: isPreAgentFailure,
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
      status: SAMPLE_STATUS.failed,
      progress: 100,
      errorSummary,
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

  async function attachAnalysis(sampleVideoId, analysis, traceMeta = {}) {
    const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
    const artifact = await store.readJson(artifactPath);
    artifact.shotBoundaryAnalysis = analysis;
    artifact.shotBoundaryAnalysisHistory = appendShotBoundaryHistory(artifact.shotBoundaryAnalysisHistory, analysis, {
      traceId: traceMeta.traceId ?? artifact.trace?.traceId ?? null,
      sourceTraceId: traceMeta.sourceTraceId ?? artifact.trace?.traceId ?? null,
    });
    await store.writeJson(artifactPath, artifact);
    return artifact;
  }

  async function runCacheLookupLocal(context, prepared, contactSheets) {
    return runCacheLookupImpl({
      context,
      prepared,
      contactSheets,
      runStage,
      stageName: STAGES.cacheLookup,
      findCached: () => findCachedArtifactImpl({
        context,
        prepared,
        contactSheets,
        artifactIndex,
        stageName: STAGES.resultWritten,
        cacheParams,
        evaluateCacheEligibility,
        resolveExistingFileHash: (sampleVideoId) => resolveExistingFileHashImpl(sampleVideoId, artifactIndex),
      }),
    });
  }

  async function reuseCachedAnalysisLocal(context, cachePrompt) {
    await reuseCachedAnalysisImpl({
      context,
      cachePrompt,
      runStage,
      stageName: STAGES.cacheReuse,
      resolvePrompt: () => resolveCachedPromptImpl({ cachePrompt, artifactIndex, evaluateCacheEligibility, codedError }),
      buildCacheReuseAnalysis,
      attachAnalysis,
    });
    jobStore.updateJob(context.job.jobId, { stage: SAMPLE_STATUS.processed, status: SAMPLE_STATUS.processed, progress: 100, cachePrompt: null, errorSummary: null });
  }

  function buildCachePrompt(context, cached) {
    const item = buildCachedItem(context, cached);
    return {
      cachedItem: item,
      sourceSampleVideoId: cached.cache.sampleVideoId,
      sourceTurnId: cached.analysis.agent?.turnId ?? null,
      sourceCreatedAt: cached.analysis.createdAt ?? null,
      analysisFps: cached.analysis.analysisSampling?.fps ?? context.analysisFps,
      cacheKey: cached.cache.cacheKey ?? null,
      artifactId: context.artifactId,
      skillPath: context.skillPath,
      skillHash: context.skillHash,
    };
  }

  function buildCachedItem(context, cached) {
    return {
      sampleVideoId: cached.cache.sampleVideoId,
      filename: context.sampleArtifact.sampleVideo?.original?.summary ?? "样例视频",
      durationSeconds: context.sampleArtifact.metadata?.durationSeconds ?? null,
      width: context.sampleArtifact.metadata?.width ?? null,
      height: context.sampleArtifact.metadata?.height ?? null,
      updatedAt: cached.cache.updatedAt ?? null,
      tags: ["切镜"],
      cacheAvailable: true,
      traceId: cached.analysis.agent?.turnId ?? null,
      sourceSampleVideoId: cached.cache.sampleVideoId,
      sourceTurnId: cached.analysis.agent?.turnId ?? null,
      sourceCreatedAt: cached.analysis.createdAt ?? null,
      boundaryCount: cached.analysis.boundaries?.length ?? 0,
      shotCount: cached.analysis.shots?.length ?? 0,
      analysisFps: cached.analysis.analysisSampling?.fps ?? context.analysisFps,
    };
  }

  function cacheLookupSummary(context, details) {
    return {
      analysisFps: context.analysisFps,
      skillHash: context.skillHash,
      ...details,
    };
  }

  async function runCacheLookup(context, prepared, contactSheets) {
    return runCacheLookupLocal(context, prepared, contactSheets);
  }

  async function reuseCachedAnalysis(context, cachePrompt) {
    return reuseCachedAnalysisLocal(context, cachePrompt);
  }

  function markCacheWaiting(context, cached) {
    return markCacheWaitingImpl({ context, cached, jobStore, sampleStatus: SAMPLE_STATUS, stageName: STAGES.cacheLookup });
  }

  function buildAgentRun(args) {
    return buildAgentRunImpl({ ...args, role: ROLE, skillPath: SKILL_PATH });
  }

  function createRecoveredContext(args) {
    return createRecoveredContextImpl(args);
  }

  function isInterruptedPreAgentJob(job) {
    return isInterruptedPreAgentJobImpl(job, SAMPLE_STATUS, STAGES);
  }

  function isShotStage(stageName) {
    return isShotStageImpl(stageName, STAGES);
  }

  return { enqueue, resolveCacheDecision, prepareInput, buildTurnInputs, collectAgentRun, recoverActiveAgentRuns };
}

function badRequestError(code, message) {
  const error = codedError(code, message, null, false);
  error.statusCode = 400;
  return error;
}

function buildInitFingerprint(context) {
  return contentHash(JSON.stringify({
    profileVersion: context.roleProfile?.profileVersion ?? null,
    initTemplateHash: context.roleProfile?.init?.templateHash ?? null,
    skillHash: context.skillHash ?? null,
    readyText: context.roleProfile?.init?.readyText ?? null,
  }));
}

function isPreAgentStage(stageName) {
  return [STAGES.inputPrepared, STAGES.contactSheetPrepared, STAGES.cacheLookup, STAGES.threadAcquired].includes(stageName);
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

module.exports = { ROLE, SKILL_PATH, STAGES, createShotBoundaryService, prepareInput, buildTurnInputs, renderAnalyzeTurnInputs };
