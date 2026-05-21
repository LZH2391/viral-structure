const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const defaultContactSheetGenerator = require("../../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { createAppServerBridge } = require("./appserver-bridge");
const { createThreadPoolProxy } = require("./threadpool-proxy");
const {
  ROLE,
  MAX_REPAIR_ATTEMPTS,
  SKILL_PATH,
  buildCacheReuseAnalysis,
  buildFailedArtifact,
  buildProcessedAnalysis,
  buildRepairTurnInputs,
  buildTurnInputs,
  cacheParams,
  codedError,
  evaluateCacheEligibility,
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
  turnValidated: "shot.boundary_validate",
  turnRepaired: "shot.boundary_repair.submit",
  repairCollected: "shot.boundary_repair.collect",
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

  async function enqueue({ sampleVideoId, analysisFps = 1, cacheDecision = "ask" }) {
    await store.ensureRuntimeDirs();
    const sampleArtifact = await loadSampleArtifact(sampleVideoId);
    const traceContext = createTraceContext(createTraceIds());
    const artifactId = `artifact_${randomUUID()}`;
    const context = {
      sampleVideoId,
      analysisFps: Number(analysisFps || 1),
      cacheDecision,
      sampleArtifact,
      traceContext,
      artifactId,
      skillPath,
      skillHash: await resolveSkillHash(skillPath),
    };
    const prepared = prepareInput(sampleArtifact, context.analysisFps, { runtimeRoot: store.runtimeRoot });
    const contactSheets = await contactSheetGenerator.generateContactSheets({
      frames: prepared.frames,
      frameWidth: prepared.frameDimensions.width,
      frameHeight: prepared.frameDimensions.height,
      sampleDir: store.sampleDir(sampleVideoId),
      parentArtifactId: prepared.sourceArtifactId,
      store,
    });
    const cached = await findCachedArtifact(context, prepared, contactSheets);
    if (cacheDecision === "ask" && cached) {
      return {
        cacheHit: true,
        cachedItem: {
          sampleVideoId: cached.cache.sampleVideoId,
          filename: sampleArtifact.sampleVideo?.original?.summary ?? "样例视频",
          durationSeconds: sampleArtifact.metadata?.durationSeconds ?? null,
          width: sampleArtifact.metadata?.width ?? null,
          height: sampleArtifact.metadata?.height ?? null,
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
        },
      };
    }
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    runAnalysis({ ...context, prepared, contactSheets, job }).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
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
      const cached = await findCachedArtifact(context, prepared, contactSheets);
      if (cached && context.cacheDecision === "reuse") {
        await logCacheReuse(context, cached);
        await attachAnalysis(context.sampleVideoId, buildCacheReuseAnalysis(cached.analysis));
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
    const resolved = await resolveFinalAnalysis({ context, agentRun, turn, prepared, contactSheets });
    await runStage(context, STAGES.resultWritten, 95, {
      artifactId: context.artifactId,
      parentArtifactId: prepared.sourceArtifactId ?? null,
      inputSummary: { turnId: resolved.finalTurn.turnId, frameCount: prepared.frames.length, sheetCount: contactSheets.length, resultOrigin: resolved.resultOrigin, repairAttemptCount: resolved.repairAttemptCount },
      action: async () => {
        const lease = { thread_id: agentRun.threadId, lease_id: agentRun.leaseId };
        const analysis = buildProcessedAnalysis(resolved.finalTurn.finalMessage, prepared, contactSheets, { ...context, validationSummary: resolved.validationSummary }, lease, resolved.finalTurn, {
          resultOrigin: resolved.resultOrigin,
          repairAttemptCount: resolved.repairAttemptCount,
        });
        await attachAnalysis(context.sampleVideoId, analysis);
        await artifactIndex.registerSampleArtifact({
          artifact: await loadSampleArtifact(context.sampleVideoId),
          fileHash: await resolveExistingFileHash(context.sampleVideoId),
          traceId: context.traceContext.traceId,
        });
        await finalizeLease(threadPool, agentRun, { shouldDiscard: false });
        return analysis;
      },
      outputSummary: (result) => ({
        status: result.status,
        sheetCount: result.contactSheets?.length ?? 0,
        boundaryCount: result.boundaries?.length ?? 0,
        shotCount: result.shots.length,
        artifactType: result.type,
        resultOrigin: result.resultOrigin,
        repairAttemptCount: result.validation?.repairAttemptCount ?? 0,
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

  async function resolveFinalAnalysis({ context, agentRun, turn, prepared, contactSheets }) {
    let repairAttemptCount = 0;
    let finalTurn = turn;
    let resultOrigin = "new_turn";
    while (repairAttemptCount <= MAX_REPAIR_ATTEMPTS) {
      try {
        await runStage(context, STAGES.turnValidated, 90, {
          artifactId: context.artifactId,
          parentArtifactId: prepared.sourceArtifactId,
          inputSummary: { turnId: finalTurn.turnId, repairAttemptCount },
          action: async () => {
            const lease = { thread_id: agentRun.threadId, lease_id: agentRun.leaseId };
            return buildProcessedAnalysis(finalTurn.finalMessage, prepared, contactSheets, context, lease, finalTurn, {
              resultOrigin,
              repairAttemptCount,
            });
          },
          outputSummary: (result) => ({
            turnId: finalTurn.turnId,
            resultOrigin,
            boundaryCount: result.boundaries?.length ?? 0,
            shotCount: result.shots?.length ?? 0,
            repairAttemptCount,
          }),
        });
        return {
          finalTurn,
          repairAttemptCount,
          resultOrigin,
          validationSummary: {
            status: "passed",
            rawBoundaryCount: null,
            normalizedBoundaryCount: null,
            repairAttemptCount,
            validatorCode: null,
          },
        };
      } catch (error) {
        if (error?.code !== "shot_boundary_validation_failed" || repairAttemptCount >= MAX_REPAIR_ATTEMPTS) {
          context.validationSummary = {
            ...(error?.debugPayload?.validation ?? {}),
            status: "failed",
            repairAttemptCount,
            validatorCode: error?.debugPayload?.validation?.validatorCode ?? error?.code ?? null,
          };
          error.debugPayload = {
            ...(error.debugPayload ?? {}),
            repairAttemptCount,
            validation: context.validationSummary,
            turnId: finalTurn?.turnId ?? null,
            resultOrigin,
          };
          throw error;
        }
        repairAttemptCount += 1;
        context.validationSummary = {
          ...(error?.debugPayload?.validation ?? {}),
          status: "failed",
          repairAttemptCount,
          validatorCode: error?.debugPayload?.validation?.validatorCode ?? error?.code ?? null,
        };
        error.debugPayload = {
          ...(error.debugPayload ?? {}),
          repairAttemptCount,
          validation: context.validationSummary,
          turnId: finalTurn?.turnId ?? null,
          resultOrigin,
        };
        finalTurn = await submitRepairTurn({ context, agentRun, prepared, contactSheets, validationError: error, priorTurn: finalTurn, repairAttemptCount });
        resultOrigin = "repaired_turn";
      }
    }
    throw codedError("shot_boundary_validation_failed", "切镜结果校验失败", { repairAttemptCount: MAX_REPAIR_ATTEMPTS }, false);
  }

  async function submitRepairTurn({ context, agentRun, prepared, contactSheets, validationError, priorTurn, repairAttemptCount }) {
    const started = await runStage(context, STAGES.turnRepaired, 91, {
      artifactId: context.artifactId,
      parentArtifactId: prepared.sourceArtifactId,
      inputSummary: { threadId: agentRun.threadId, previousTurnId: priorTurn.turnId, repairAttemptCount, validatorCode: validationError.debugPayload?.validation?.validatorCode ?? validationError.code },
      action: () => appServer.startTurnWithInputs({
        workspaceRoot: rootDir,
        threadId: agentRun.threadId,
        inputs: buildRepairTurnInputs({
          prepared,
          contactSheets,
          validationError,
          priorTurnOutput: priorTurn.finalMessage,
          repairAttemptCount,
        }),
        timeoutSeconds: 240,
      }),
      outputSummary: (result) => ({ role: ROLE, threadId: result.threadId, turnId: result.turnId, status: result.status, repairAttemptCount }),
    });
    return runStage(context, STAGES.repairCollected, 93, {
      artifactId: context.artifactId,
      parentArtifactId: prepared.sourceArtifactId,
      inputSummary: { threadId: agentRun.threadId, turnId: started.turnId, repairAttemptCount },
      action: () => appServer.collectTurnResult({
        workspaceRoot: rootDir,
        threadId: agentRun.threadId,
        turnId: started.turnId,
        timeoutSeconds: 120,
      }),
      outputSummary: (result) => ({ role: ROLE, threadId: result.threadId, turnId: result.turnId, status: result.status, repairAttemptCount }),
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
    const errorSummary = { ...safeError(error, activeStage.stageName), debugSnapshotUri: snapshot.uri };
    const failedArtifact = buildFailedArtifact({ ...context, validationSummary: context.validationSummary }, errorSummary, agentRun?.contactSheets ?? []);
    await attachAnalysis(context.sampleVideoId, failedArtifact).catch(() => undefined);
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

  async function attachAnalysis(sampleVideoId, analysis) {
    const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
    const artifact = await store.readJson(artifactPath);
    artifact.shotBoundaryAnalysis = analysis;
    artifact.shotBoundaryAnalysisHistory = appendShotBoundaryHistory(artifact.shotBoundaryAnalysisHistory, analysis, artifact.trace?.traceId ?? null);
    await store.writeJson(artifactPath, artifact);
    return artifact;
  }

  async function findCachedArtifact(context, prepared, contactSheets) {
    if (context.cacheDecision === "refresh") return null;
    const fileHash = await resolveExistingFileHash(context.sampleVideoId);
    if (!fileHash) {
      await logCacheLookup(context, {
        cacheLookup: "miss",
        reason: "file_hash_missing",
        analysisFps: context.analysisFps,
        skillHash: context.skillHash,
      });
      return null;
    }
    const params = cacheParams(prepared, contactSheets, { skillHash: context.skillHash });
    const cache = await artifactIndex.findCacheEntry({
      fileHash,
      stageName: STAGES.resultWritten,
      params,
    });
    if (!cache?.sampleVideoId) {
      await logCacheLookup(context, {
        cacheLookup: "miss",
        reason: "key_miss",
        analysisFps: context.analysisFps,
        skillHash: context.skillHash,
      });
      return null;
    }
    const artifact = await artifactIndex.loadItem(cache.sampleVideoId);
    const analysis = artifact?.shotBoundaryAnalysis ?? null;
    const cacheEligibility = evaluateCacheEligibility(analysis);
    if (!cacheEligibility.eligible) {
      await logCacheLookup(context, {
        cacheLookup: "miss",
        reason: "eligibility_rejected",
        analysisFps: context.analysisFps,
        skillHash: context.skillHash,
        sourceSampleVideoId: cache.sampleVideoId,
        eligibility: cacheEligibility,
      });
      return null;
    }
    return { cache, analysis, cacheEligibility };
  }

  async function logCacheLookup(context, summary) {
    context.traceContext = nextStage(context.traceContext);
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: STAGES.cacheReuse,
      event: "stage.end",
      artifactId: context.artifactId,
      parentArtifactId: context.sampleArtifact?.sampleVideo?.artifactId ?? null,
      outputSummary: summary,
      durationMs: 0,
    });
  }

  async function logCacheReuse(context, cached) {
    const analysis = cached.analysis;
    const startedAt = Date.now();
    context.traceContext = nextStage(context.traceContext);
    const outputSummary = {
      sourceSampleVideoId: cached.cache.sampleVideoId,
      cacheKey: cached.cache.cacheKey,
      sourceTurnId: analysis.agent?.turnId ?? null,
      sourceCreatedAt: analysis.createdAt ?? null,
      analysisFps: analysis.analysisSampling?.fps ?? context.analysisFps,
      boundaryCount: analysis.boundaries?.length ?? 0,
      shotCount: analysis.shots?.length ?? 0,
      cacheEligibility: cached.cacheEligibility ?? null,
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

function appendShotBoundaryHistory(history, analysis, traceId) {
  const entries = Array.isArray(history) ? history : [];
  const next = {
    artifactId: analysis?.artifactId ?? null,
    status: analysis?.status ?? "failed",
    resultOrigin: analysis?.resultOrigin ?? "new_turn",
    analysisFps: analysis?.analysisSampling?.fps ?? null,
    boundaryCount: analysis?.boundaries?.length ?? 0,
    shotCount: analysis?.shots?.length ?? 0,
    turnId: analysis?.agent?.turnId ?? null,
    traceId: traceId ?? null,
    createdAt: analysis?.createdAt ?? new Date().toISOString(),
    validatorCode: analysis?.validation?.validatorCode ?? null,
  };
  return [...entries, next];
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
      requestedFps: prepared.analysisSampling.requestedFps,
      selectedFrameCount: prepared.analysisSampling.selectedFrameCount,
      effectiveFps: prepared.analysisSampling.effectiveFps,
      selectionPolicy: prepared.analysisSampling.selectionPolicy,
      sheetCount: contactSheets.length,
      subtitleSegmentCount: prepared.subtitleContextSummary?.subtitleSegmentCount ?? 0,
      subtitleTextHash: prepared.subtitleContextSummary?.subtitleTextHash ?? null,
      subtitleTruncated: Boolean(prepared.subtitleContextSummary?.truncated),
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
    cacheDecision: "refresh",
    job,
    activeStage: null,
  };
}

function isRetryableCollectError(error) {
  const code = String(error?.code ?? "");
  return ["appserver_bridge_failed", "appserver_bridge_timeout", "appserver_turn_collect_failed"].includes(code);
}

async function finalizeLease(threadPool, agentRun, options = {}) {
  if (options.shouldDiscard && agentRun?.threadId) {
    await threadPool.discardThread({ threadId: agentRun.threadId, reason: options.reason || "shot-boundary-analysis-failed" });
    if (typeof threadPool.releaseOwnerLeases === "function" && agentRun?.traceId) {
      await threadPool.releaseOwnerLeases(agentRun.traceId).catch(() => undefined);
    }
    return { mode: "discard" };
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
