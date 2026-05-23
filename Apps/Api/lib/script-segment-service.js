const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const { loadRoleProfileByRole } = require("./role-profile-loader");
const { createThreadPoolProxy } = require("./threadpool-proxy");
const { createAppServerBridge } = require("./appserver-bridge");
const { finalizeLease, cleanupLease } = require("./shot-boundary/threadpool-runner");
const { buildAgentRun, updateAgentRun } = require("./script-segment-analysis/agent-run");
const { prepareInput, prepareInputPackage, renderAnalyzeTurnInputs, renderRepairTurnInputs } = require("./script-segment-analysis/input");
const { executeAnalyzeTurn, executeRepairTurn } = require("./script-segment-analysis/runner");
const {
  buildProcessedAnalysis,
  buildFailedArtifact,
  buildCacheReuseAnalysis,
  evaluateCacheEligibility,
} = require("./script-segment-analysis/result-builder");
const { buildScriptSegmentContentFingerprint } = require("./script-segment-analysis/cache-params");
const { appendScriptSegmentHistory } = require("./script-segment/history");
const {
  findCachedArtifact,
  runCacheLookup,
  resolveCachedPrompt,
  markCacheWaiting,
  reuseCachedAnalysis,
} = require("./script-segment/cache");
const {
  ROLE,
  SKILL_PATH,
  STAGES,
  codedError,
  safeError,
  sanitizeDebugPayload,
  resolveSkillHash,
} = require("./script-segment-analysis/shared");

const DEFAULT_POLL_INTERVAL_MS = 1500;
const MAX_REPAIR_ATTEMPTS = 1;
const SCRIPT_SEGMENT_COLLECT_TIMEOUT_MS = 180000;
const MAX_COLLECT_ATTEMPTS = Math.ceil(SCRIPT_SEGMENT_COLLECT_TIMEOUT_MS / DEFAULT_POLL_INTERVAL_MS);

function createScriptSegmentService({
  rootDir = path.resolve(__dirname, "../..", ".."),
  store,
  logger,
  jobStore,
  artifactIndex,
  threadPool = createThreadPoolProxy(),
  appServer = createAppServerBridge(),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
} = {}) {
  async function enqueue({ sampleVideoId, cacheDecision = "ask", expectedShotBoundaryArtifactId = null }) {
    await store.ensureRuntimeDirs();
    const artifact = await loadArtifact(sampleVideoId, store);
    assertExpectedShotBoundaryArtifact(artifact, expectedShotBoundaryArtifactId);
    const traceContext = createTraceContext(createTraceIds());
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    const roleProfile = await loadRoleProfileByRole(ROLE);
    const context = {
      sampleVideoId,
      cacheDecision,
      artifact,
      expectedShotBoundaryArtifactId,
      traceContext,
      job,
      roleProfile,
      skillPath: SKILL_PATH,
      skillHash: await resolveSkillHash(SKILL_PATH),
      activeStage: null,
      artifactId: `artifact_${randomUUID()}`,
      input: null,
      inputPackage: null,
      promptTemplate: null,
      agentRun: null,
      validationSummary: null,
      cacheKey: null,
    };
    run(context).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function resolveCacheDecision({ jobId, decision }) {
    const job = jobStore.getJob(jobId);
    if (!job || job.status !== SAMPLE_STATUS.cacheWaiting || job.cachePrompt?.cacheKind !== "script_segment") {
      throw badRequestError("cache_decision_invalid_job", "只能对等待缓存选择的脚本段落任务执行该操作");
    }
    const artifact = await loadArtifact(job.sampleVideoId, store);
    assertExpectedShotBoundaryArtifact(artifact, job.cachePrompt.expectedShotBoundaryArtifactId ?? null);
    const roleProfile = await loadRoleProfileByRole(ROLE);
    const input = prepareInput(artifact, { runtimeRoot: store.runtimeRoot });
    const inputPackage = await prepareInputPackage({
      input,
      sampleDir: store.sampleDir(job.sampleVideoId),
      store,
    });
    const cacheKey = buildScriptSegmentContentFingerprint(input, inputPackage);
    const context = {
      sampleVideoId: job.sampleVideoId,
      cacheDecision: decision,
      artifact,
      expectedShotBoundaryArtifactId: job.cachePrompt.expectedShotBoundaryArtifactId ?? null,
      traceContext: {
        runId: job.traceId,
        traceId: job.traceId,
        stageId: `stage_cache_decision_${Date.now()}`,
      },
      job,
      roleProfile,
      skillPath: job.cachePrompt.skillPath ?? SKILL_PATH,
      skillHash: job.cachePrompt.skillHash ?? await resolveSkillHash(SKILL_PATH),
      activeStage: null,
      artifactId: job.cachePrompt.artifactId ?? `artifact_${randomUUID()}`,
      input,
      inputPackage,
      promptTemplate: {
        promptTemplateId: null,
        promptTemplateVersion: null,
        promptTemplateHash: null,
      },
      agentRun: null,
      validationSummary: null,
      cacheKey,
    };
    if (decision === "reuse") {
      try {
        await reuseCachedAnalysisLocal(context, job.cachePrompt);
      } catch (error) {
        await markFailed(context, error, store);
      }
      return jobStore.getJob(jobId);
    }
    if (decision === "refresh") {
      jobStore.updateJob(jobId, { cachePrompt: null, errorSummary: null, status: SAMPLE_STATUS.processing, stage: STAGES.cacheLookup, progress: 28 });
      run({ ...context, cacheDecision: "refresh" }).catch(() => undefined);
      return jobStore.getJob(jobId);
    }
    throw badRequestError("cache_decision_invalid", "缓存选择无效，请选择复用或重新生成");
  }

  async function run(context) {
    let lease = null;
    try {
      const input = await runStage(context, STAGES.inputPrepared, 18, {
        artifactId: context.artifactId,
        parentArtifactId: context.artifact.shotBoundaryAnalysis?.artifactId ?? context.artifact.sampleVideo?.artifactId ?? null,
        inputSummary: {
          sampleVideoId: context.sampleVideoId,
          sourceShotBoundaryArtifactId: context.artifact.shotBoundaryAnalysis?.artifactId ?? null,
          shotCount: context.artifact.shotBoundaryAnalysis?.shots?.length ?? 0,
          hasCommerceBrief: Boolean(context.artifact.shotBoundaryAnalysis?.commerceBrief),
        },
        action: () => prepareInput(context.artifact, { runtimeRoot: store.runtimeRoot }),
        outputSummary: (result) => ({
          shotCount: result.shots.length,
          hasCommerceBrief: Boolean(result.commerceBrief),
          parentArtifactId: result.parentArtifactId,
        }),
      });
      context.input = input;

      const inputPackage = await runStage(context, STAGES.inputPackaged, 24, {
        artifactId: context.artifactId,
        parentArtifactId: input.parentArtifactId,
        inputSummary: {
          sampleVideoId: context.sampleVideoId,
          sourceShotBoundaryArtifactId: input.parentArtifactId,
          shotCount: input.shots.length,
          frameCount: input.frames?.length ?? 0,
        },
        action: () => prepareInputPackage({
          input,
          sampleDir: store.sampleDir(context.sampleVideoId),
          store,
        }),
        outputSummary: (result) => ({
          shotCount: result.manifest.shotCount,
          sheetCount: result.sheetCount,
          emptyShotCount: result.emptyShotCount,
          manifestHash: result.hashes.manifestHash,
          visualManifestHash: result.hashes.visualManifestHash,
        }),
      });
      context.inputPackage = inputPackage;
      context.cacheKey = buildScriptSegmentContentFingerprint(input, inputPackage);

      const analyzeTurn = renderAnalyzeTurnInputs({ input, inputPackage, roleProfile: context.roleProfile });
      context.promptTemplate = {
        promptTemplateId: analyzeTurn.promptTemplateId,
        promptTemplateVersion: analyzeTurn.promptTemplateVersion,
        promptTemplateHash: analyzeTurn.promptTemplateHash,
      };
      const cached = await runCacheLookupLocal(context, input);
      if (cached && context.cacheDecision === "ask") {
        markCacheWaitingLocal(context, cached);
        return null;
      }
      if (cached && context.cacheDecision === "reuse") {
        await reuseCachedAnalysisLocal(context, buildScriptSegmentCachePrompt(context, cached));
        return null;
      }

      const analyzed = await runStage(context, STAGES.analyzed, 56, {
        artifactId: context.artifactId,
        parentArtifactId: input.parentArtifactId,
        inputSummary: {
          role: ROLE,
          shotCount: input.shots.length,
          sheetCount: inputPackage.sheetCount,
          emptyShotCount: inputPackage.emptyShotCount,
          promptTemplateVersion: context.promptTemplate.promptTemplateVersion,
        },
        action: async () => {
          const executed = await executeAnalyzeTurn({
            context,
            input,
            turnInputs: analyzeTurn,
            threadPool,
            appServer,
            rootDir,
            pollIntervalMs,
            maxCollectAttempts: MAX_COLLECT_ATTEMPTS,
            onTurnCollect: (turn) => updateActiveThreadMessage(context, turn),
          });
          lease = executed.lease;
          context.agentRun = buildAgentRun({ context, lease: executed.lease, turn: executed.started, input });
          jobStore.updateJob(context.job.jobId, {
            agentRun: context.agentRun,
            stage: STAGES.analyzed,
            status: SAMPLE_STATUS.processing,
            progress: 56,
            errorSummary: null,
            activeThreadMessage: null,
          });
          const analysis = buildProcessedAnalysis(executed.finalTurn.finalMessage, input, context, context.agentRun, executed.finalTurn, {
            repairAttemptCount: 0,
          });
          context.agentRun = updateAgentRun(context.agentRun, context, executed.finalTurn);
          return { analysis, finalTurn: executed.finalTurn };
        },
        outputSummary: (result) => ({
          role: ROLE,
          threadId: context.agentRun?.threadId ?? null,
          leaseId: context.agentRun?.leaseId ?? null,
          turnId: result.finalTurn?.turnId ?? null,
          status: result.analysis.status,
          segmentCount: result.analysis.segments.length,
          promptTemplateVersion: result.analysis.agent?.promptTemplateVersion ?? null,
        }),
      });

      let analysis = analyzed.analysis;
      let finalTurn = analyzed.finalTurn;

      const validated = await runStage(context, STAGES.validated, 74, {
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        inputSummary: {
          segmentCount: analysis.segments.length,
          turnId: finalTurn?.turnId ?? null,
        },
        action: () => analysis,
        outputSummary: (result) => ({
          status: result.validation?.status ?? null,
          segmentCount: result.segments.length,
          validatorCode: result.validation?.validatorCode ?? null,
          repairAttemptCount: result.validation?.repairAttemptCount ?? 0,
        }),
      });

      analysis = validated;

      if (analysis.validation?.status !== "passed") {
        throw codedError("script_segment_validation_failed", "脚本段落输出未通过校验", {
          validation: analysis.validation,
          turnId: finalTurn?.turnId ?? null,
        }, false);
      }

      const materializedArtifact = await runStage(context, STAGES.materialized, 96, {
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        inputSummary: {
          segmentCount: analysis.segments.length,
          threadId: analysis.agent?.threadId ?? null,
          turnId: analysis.agent?.turnId ?? null,
        },
        action: async () => {
          assertExpectedShotBoundaryArtifact(await loadArtifact(context.sampleVideoId, store), context.input.parentArtifactId);
          const nextArtifact = await attachScriptSegments(context.sampleVideoId, analysis, store);
          await artifactIndex.registerSampleArtifact({
            artifact: nextArtifact,
            fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
            traceId: context.traceContext.traceId,
          });
          return nextArtifact;
        },
        outputSummary: (artifact) => ({
          segmentCount: artifact.scriptSegmentAnalysis?.segments?.length ?? 0,
          scriptArtifactId: artifact.scriptSegmentAnalysis?.artifactId ?? null,
        }),
      });

      if (context.agentRun?.leaseId) {
        await finalizeLease(threadPool, {
          leaseId: context.agentRun.leaseId,
          threadId: context.agentRun.threadId,
          traceId: context.traceContext.traceId,
        }, { shouldDiscard: false });
        lease = null;
      }

      jobStore.updateJob(context.job.jobId, {
        agentRun: context.agentRun ? { ...context.agentRun, status: "completed", updatedAt: new Date().toISOString() } : context.agentRun,
        stage: SAMPLE_STATUS.processed,
        status: SAMPLE_STATUS.processed,
        progress: 100,
        errorSummary: null,
        activeThreadMessage: null,
      });
      return materializedArtifact;
    } catch (error) {
      if (error?.code === "script_segment_validation_failed" && context.agentRun?.threadId && context.input) {
        try {
          const repaired = await runRepair(context, error, appServer, rootDir, pollIntervalMs);
          if (repaired) {
            if (context.agentRun?.leaseId) {
              await finalizeLease(threadPool, {
                leaseId: context.agentRun.leaseId,
                threadId: context.agentRun.threadId,
                traceId: context.traceContext.traceId,
              }, { shouldDiscard: false });
              lease = null;
            }
            return repaired;
          }
        } catch (repairError) {
          error = repairError;
        }
      }
      if (lease?.thread_id) {
        await cleanupLease(threadPool, lease, context.traceContext.traceId, "script-segment-analysis-failed");
      } else if (context.agentRun?.threadId) {
        await cleanupLease(threadPool, { thread_id: context.agentRun.threadId, lease_id: context.agentRun.leaseId }, context.traceContext.traceId, "script-segment-analysis-failed");
      }
      await markFailed(context, error, store);
      return null;
    }
  }

  async function runRepair(context, validationError, appServer, rootDir, pollIntervalMs) {
    for (let repairAttemptCount = 1; repairAttemptCount <= MAX_REPAIR_ATTEMPTS; repairAttemptCount += 1) {
      const repairTurn = renderRepairTurnInputs({
        input: context.input,
        inputPackage: context.inputPackage,
        validationError,
        priorTurnOutput: validationError?.debugPayload?.outputSummary?.messagePreview ?? "",
        repairAttemptCount,
        roleProfile: context.roleProfile,
      });
      context.promptTemplate = {
        promptTemplateId: repairTurn.promptTemplateId,
        promptTemplateVersion: repairTurn.promptTemplateVersion,
        promptTemplateHash: repairTurn.promptTemplateHash,
      };
      const repaired = await runStage(context, STAGES.repaired, 88, {
        artifactId: context.artifactId,
        parentArtifactId: context.input.parentArtifactId,
        inputSummary: {
          role: ROLE,
          threadId: context.agentRun?.threadId ?? null,
          leaseId: context.agentRun?.leaseId ?? null,
          repairAttemptCount,
          validatorCode: validationError?.debugPayload?.validation?.validatorCode ?? validationError?.code ?? null,
          sheetCount: context.inputPackage?.sheetCount ?? 0,
        },
        action: async () => {
          const executed = await executeRepairTurn({
            agentRun: context.agentRun,
            turnInputs: repairTurn,
            appServer,
            rootDir,
            pollIntervalMs,
            maxCollectAttempts: MAX_COLLECT_ATTEMPTS,
            onTurnCollect: (turn) => updateActiveThreadMessage(context, turn),
          });
          const analysis = buildProcessedAnalysis(executed.finalTurn.finalMessage, context.input, context, context.agentRun, executed.finalTurn, {
            repairAttemptCount,
          });
          context.agentRun = updateAgentRun(context.agentRun, context, executed.finalTurn);
          return { analysis, finalTurn: executed.finalTurn, repairAttemptCount };
        },
        outputSummary: (result) => ({
          role: ROLE,
          threadId: context.agentRun?.threadId ?? null,
          turnId: result.finalTurn?.turnId ?? null,
          status: result.analysis.status,
          segmentCount: result.analysis.segments.length,
          repairAttemptCount: result.repairAttemptCount,
        }),
      });

      const analysis = repaired.analysis;
      const materializedArtifact = await runStage(context, STAGES.materialized, 96, {
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        inputSummary: {
          segmentCount: analysis.segments.length,
          threadId: analysis.agent?.threadId ?? null,
          turnId: analysis.agent?.turnId ?? null,
          repairAttemptCount: analysis.validation?.repairAttemptCount ?? 0,
        },
        action: async () => {
          assertExpectedShotBoundaryArtifact(await loadArtifact(context.sampleVideoId, store), context.input.parentArtifactId);
          const nextArtifact = await attachScriptSegments(context.sampleVideoId, analysis, store);
          await artifactIndex.registerSampleArtifact({
            artifact: nextArtifact,
            fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
            traceId: context.traceContext.traceId,
          });
          return nextArtifact;
        },
        outputSummary: (artifact) => ({
          segmentCount: artifact.scriptSegmentAnalysis?.segments?.length ?? 0,
          scriptArtifactId: artifact.scriptSegmentAnalysis?.artifactId ?? null,
        }),
      });

      jobStore.updateJob(context.job.jobId, {
        agentRun: context.agentRun ? { ...context.agentRun, status: "completed", updatedAt: new Date().toISOString() } : context.agentRun,
        stage: SAMPLE_STATUS.processed,
        status: SAMPLE_STATUS.processed,
        progress: 100,
        errorSummary: null,
        activeThreadMessage: null,
      });
      return materializedArtifact;
    }
    return null;
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
    jobStore.updateJob(context.job.jobId, { stage: stageName, status: SAMPLE_STATUS.processing, progress, errorSummary: null });
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

  async function markFailed(context, error, store) {
    const activeStage = context.activeStage ?? {
      stageName: STAGES.analyzed,
      artifactId: context.artifactId,
      parentArtifactId: context.input?.parentArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? context.artifact?.sampleVideo?.artifactId ?? null,
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
    await attachScriptSegments(context.sampleVideoId, failedArtifact, store).catch(() => undefined);
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
      agentRun: context.agentRun ? { ...context.agentRun, status: "failed", updatedAt: new Date().toISOString() } : context.agentRun,
      stage: activeStage.stageName,
      status: SAMPLE_STATUS.failed,
      progress: 100,
      errorSummary,
      activeThreadMessage: null,
    });
    context.activeStage = null;
  }

  function updateActiveThreadMessage(context, turn) {
    const activeThreadMessage = buildActiveThreadMessage(turn?.threadId, turn?.turnId, turn?.activeThreadMessage, turn?.status);
    jobStore.updateJob(context.job.jobId, { activeThreadMessage });
    return activeThreadMessage;
  }

  return { enqueue, resolveCacheDecision };

  async function runCacheLookupLocal(context, input) {
    return runCacheLookup({
      context,
      input,
      runStage,
      stageName: STAGES.cacheLookup,
      findCached: () => findCachedArtifact({
        context,
        input,
        artifactIndex,
        stageName: STAGES.materialized,
        evaluateCacheEligibility,
        resolveExistingFileHash: (sampleVideoId) => resolveExistingFileHash(sampleVideoId, artifactIndex),
      }),
    });
  }

  function markCacheWaitingLocal(context, cached) {
    return markCacheWaiting({
      context,
      cached,
      jobStore,
      sampleStatus: SAMPLE_STATUS,
      stageName: STAGES.cacheLookup,
    });
  }

  async function reuseCachedAnalysisLocal(context, cachePrompt) {
    await reuseCachedAnalysis({
      context,
      cachePrompt,
      runStage,
      stageName: STAGES.cacheReuse,
      resolvePrompt: () => resolveCachedPrompt({
        cachePrompt,
        artifactIndex,
        evaluateCacheEligibility,
        codedError,
        expectedCacheKey: context.cacheKey ?? null,
      }),
      buildCacheReuseAnalysis,
      attachAnalysis: (sampleVideoId, analysis, traceMeta) => attachScriptSegments(sampleVideoId, analysis, store, traceMeta),
      registerArtifact: async (artifact) => {
        await artifactIndex.registerSampleArtifact({
          artifact,
          fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
          traceId: context.traceContext.traceId,
        });
      },
    });
    jobStore.updateJob(context.job.jobId, {
      stage: SAMPLE_STATUS.processed,
      status: SAMPLE_STATUS.processed,
      progress: 100,
      cachePrompt: null,
      errorSummary: null,
      activeThreadMessage: null,
    });
  }

  function buildScriptSegmentCachePrompt(context, cached) {
    return {
      cacheKind: "script_segment",
      cachedItem: {
        sampleVideoId: cached.cache.sampleVideoId,
        filename: context.artifact.sampleVideo?.original?.summary ?? "样例视频",
        durationSeconds: context.artifact.metadata?.durationSeconds ?? null,
        width: context.artifact.metadata?.width ?? null,
        height: context.artifact.metadata?.height ?? null,
        updatedAt: cached.cache.updatedAt ?? null,
        tags: ["脚本段落"],
        cacheAvailable: true,
        cacheKind: "script_segment",
        traceId: cached.analysis?.agent?.turnId ?? null,
        sourceSampleVideoId: cached.cache.sampleVideoId,
        sourceTurnId: cached.analysis?.agent?.turnId ?? null,
        sourceCreatedAt: cached.analysis?.createdAt ?? null,
        cacheKey: context.cacheKey ?? cached.cache.cacheKey ?? null,
        segmentCount: cached.analysis?.segments?.length ?? 0,
      },
      sourceSampleVideoId: cached.cache.sampleVideoId,
      sourceTurnId: cached.analysis?.agent?.turnId ?? null,
      sourceCreatedAt: cached.analysis?.createdAt ?? null,
      cacheKey: context.cacheKey ?? cached.cache.cacheKey ?? null,
      artifactId: context.artifactId,
      skillPath: context.skillPath,
      skillHash: context.skillHash,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      expectedShotBoundaryArtifactId: context.input?.parentArtifactId ?? context.expectedShotBoundaryArtifactId ?? null,
    };
  }
}

function assertExpectedShotBoundaryArtifact(artifact, expectedShotBoundaryArtifactId) {
  const expected = String(expectedShotBoundaryArtifactId ?? "").trim();
  if (!expected) return;
  const actual = String(artifact?.shotBoundaryAnalysis?.artifactId ?? "").trim();
  if (actual === expected) return;
  throw conflictError("script_segment_shot_boundary_stale", "切镜结果已更新，请刷新后再运行脚本段落分析", {
    expectedShotBoundaryArtifactId: expected,
    actualShotBoundaryArtifactId: actual || null,
  });
}

function badRequestError(code, message, debugPayload = null) {
  const error = codedError(code, message, debugPayload, false);
  error.statusCode = 400;
  return error;
}

function conflictError(code, message, debugPayload = null) {
  const error = codedError(code, message, debugPayload, false);
  error.statusCode = 409;
  return error;
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
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress", "collecting"].includes(String(status ?? "").trim().toLowerCase());
}

async function attachScriptSegments(sampleVideoId, scriptSegmentAnalysis, store, traceMeta = {}) {
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  const artifact = await store.readJson(artifactPath);
  artifact.scriptSegmentAnalysis = scriptSegmentAnalysis;
  artifact.scriptSegmentAnalysisHistory = appendScriptSegmentHistory(artifact.scriptSegmentAnalysisHistory, scriptSegmentAnalysis, {
    traceId: traceMeta.traceId ?? artifact.trace?.traceId ?? null,
    sourceTraceId: traceMeta.sourceTraceId ?? artifact.trace?.traceId ?? null,
  });
  await store.writeJson(artifactPath, artifact);
  return artifact;
}

async function loadArtifact(sampleVideoId, store) {
  return store.readJson(path.join(store.sampleDir(sampleVideoId), "artifact.json"));
}

async function resolveExistingFileHash(sampleVideoId, artifactIndex) {
  const item = await artifactIndex.getItem(sampleVideoId).catch(() => null);
  return item?.fileHash ?? null;
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  createScriptSegmentService,
  prepareInput,
};
