const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const { createAnalysisRuntime, assertExpectedArtifact } = require("./analysis-service-shared");
const { loadRoleProfileByRole } = require("./role-profile-loader");
const { createThreadPoolProxy } = require("./threadpool-proxy");
const { createAppServerBridge } = require("./appserver-bridge");
const { finalizeLease, cleanupLease } = require("./shot-boundary/threadpool-runner");
const { buildAgentRun, updateAgentRun } = require("./rhythm-structure-analysis/agent-run");
const { prepareInput, prepareInputPackage, renderAnalyzeTurnInputs, renderRepairTurnInputs } = require("./rhythm-structure-analysis/input");
const { executeAnalyzeTurn, executeRepairTurn } = require("./rhythm-structure-analysis/runner");
const {
  buildProcessedAnalysis,
  buildFailedArtifact,
  buildCacheReuseAnalysis,
  evaluateCacheEligibility,
} = require("./rhythm-structure-analysis/result-builder");
const { buildRhythmStructureContentFingerprint } = require("./rhythm-structure-analysis/cache-params");
const { appendRhythmStructureHistory } = require("./rhythm-structure/history");
const {
  findCachedArtifact,
  runCacheLookup,
  resolveCachedPrompt,
  markCacheWaiting,
  reuseCachedAnalysis,
} = require("./rhythm-structure/cache");
const {
  ROLE,
  SKILL_PATH,
  STAGES,
  codedError,
  safeError,
  sanitizeDebugPayload,
  resolveSkillHash,
} = require("./rhythm-structure-analysis/shared");

const DEFAULT_POLL_INTERVAL_MS = 1500;
const MAX_REPAIR_ATTEMPTS = 1;
const RHYTHM_STRUCTURE_COLLECT_TIMEOUT_MS = 180000;
const MAX_COLLECT_ATTEMPTS = Math.ceil(RHYTHM_STRUCTURE_COLLECT_TIMEOUT_MS / DEFAULT_POLL_INTERVAL_MS);

function createRhythmStructureService({
  rootDir = path.resolve(__dirname, "../..", ".."),
  store,
  logger,
  jobStore,
  artifactIndex,
  threadPool = createThreadPoolProxy(),
  appServer = createAppServerBridge(),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
} = {}) {
  const runtime = createAnalysisRuntime({
    logger,
    jobStore,
    sampleStatus: SAMPLE_STATUS,
    safeError,
    sanitizeDebugPayload,
    buildFailedArtifact,
    attachFailedAnalysis: (sampleVideoId, failedArtifact) => attachRhythmStructures(sampleVideoId, failedArtifact, store),
    defaultFailedStageName: STAGES.analyzed,
    resolveDefaultParentArtifactId: (context) => (
      context.input?.parentArtifactId
      ?? context.artifact?.shotBoundaryAnalysis?.artifactId
      ?? context.artifact?.sampleVideo?.artifactId
      ?? null
    ),
  });

  async function enqueue({ sampleVideoId, cacheDecision = "ask", expectedShotBoundaryArtifactId = null, expectedScriptSegmentArtifactId = null }) {
    await store.ensureRuntimeDirs();
    const artifact = await loadArtifact(sampleVideoId, store);
    assertExpectedShotBoundaryArtifact(artifact, expectedShotBoundaryArtifactId);
    assertExpectedScriptSegmentArtifact(artifact, expectedScriptSegmentArtifactId);
    const traceContext = createTraceContext(createTraceIds());
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    const roleProfile = await loadRoleProfileByRole(ROLE);
    const context = {
      sampleVideoId,
      cacheDecision,
      artifact,
      expectedShotBoundaryArtifactId,
      expectedScriptSegmentArtifactId,
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
      nextStage,
    };
    context.promptTemplate = buildAnalyzePromptTemplate(roleProfile);
    context.cacheKey = buildRhythmStructureContentFingerprint(prepareInput(artifact, { runtimeRoot: store.runtimeRoot }));
    run(context).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function resolveCacheDecision({ jobId, decision }) {
    const job = jobStore.getJob(jobId);
    if (!job || job.status !== SAMPLE_STATUS.cacheWaiting || job.cachePrompt?.cacheKind !== "rhythm_structure") {
      throw badRequestError("cache_decision_invalid_job", "只能对等待缓存选择的节奏结构任务执行该操作");
    }
    const artifact = await loadArtifact(job.sampleVideoId, store);
    assertExpectedShotBoundaryArtifact(artifact, job.cachePrompt.expectedShotBoundaryArtifactId ?? null);
    assertExpectedScriptSegmentArtifact(artifact, job.cachePrompt.expectedScriptSegmentArtifactId ?? null);
    const roleProfile = await loadRoleProfileByRole(ROLE);
    const input = prepareInput(artifact, { runtimeRoot: store.runtimeRoot });
    const cacheKey = buildRhythmStructureContentFingerprint(input);
    const cachedPromptTemplate = {
      promptTemplateId: job.cachePrompt.promptTemplateId ?? null,
      promptTemplateVersion: job.cachePrompt.promptTemplateVersion ?? null,
      promptTemplateHash: job.cachePrompt.promptTemplateHash ?? null,
    };
    const context = {
      sampleVideoId: job.sampleVideoId,
      cacheDecision: decision,
      artifact,
      expectedShotBoundaryArtifactId: job.cachePrompt.expectedShotBoundaryArtifactId ?? null,
      expectedScriptSegmentArtifactId: job.cachePrompt.expectedScriptSegmentArtifactId ?? null,
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
      inputPackage: null,
      promptTemplate: {
        promptTemplateId: cachedPromptTemplate.promptTemplateId ?? buildAnalyzePromptTemplate(roleProfile).promptTemplateId,
        promptTemplateVersion: cachedPromptTemplate.promptTemplateVersion ?? buildAnalyzePromptTemplate(roleProfile).promptTemplateVersion,
        promptTemplateHash: cachedPromptTemplate.promptTemplateHash ?? buildAnalyzePromptTemplate(roleProfile).promptTemplateHash,
      },
      agentRun: null,
      validationSummary: null,
      cacheKey,
      nextStage,
    };
    if (decision === "reuse") {
      try {
        await reuseCachedAnalysisLocal(context, job.cachePrompt);
      } catch (error) {
        await runtime.markFailed(context, error);
      }
      return jobStore.getJob(jobId);
    }
    if (decision === "refresh") {
      runtime.job.resumeProcessing(jobId, STAGES.cacheLookup, 28);
      run({ ...context, cacheDecision: "refresh" }).catch(() => undefined);
      return jobStore.getJob(jobId);
    }
    throw badRequestError("cache_decision_invalid", "缓存选择无效，请选择复用或重新生成");
  }

  async function run(context) {
    let lease = null;
    try {
      const input = await runtime.runStage(context, STAGES.inputPrepared, 18, {
        artifactId: context.artifactId,
        parentArtifactId: context.artifact.shotBoundaryAnalysis?.artifactId ?? context.artifact.sampleVideo?.artifactId ?? null,
        inputSummary: {
          sampleVideoId: context.sampleVideoId,
          sourceShotBoundaryArtifactId: context.artifact.shotBoundaryAnalysis?.artifactId ?? null,
          shotCount: context.artifact.shotBoundaryAnalysis?.shots?.length ?? 0,
          sourceScriptSegmentArtifactId: context.artifact.scriptSegmentAnalysis?.artifactId ?? null,
          scriptSegmentCount: context.artifact.scriptSegmentAnalysis?.segments?.length ?? 0,
        },
        action: () => prepareInput(context.artifact, { runtimeRoot: store.runtimeRoot }),
        outputSummary: (result) => ({
          shotCount: result.shots.length,
          scriptSegmentCount: result.scriptSegments.length,
          parentArtifactId: result.parentArtifactId,
        }),
      });
      context.input = input;
      if (!context.cacheKey) context.cacheKey = buildRhythmStructureContentFingerprint(input);
      if (!context.promptTemplate) context.promptTemplate = buildAnalyzePromptTemplate(context.roleProfile);

      const cached = await runCacheLookupLocal(context, input);
      if (cached && context.cacheDecision === "ask") {
        markCacheWaitingLocal(context, cached);
        return null;
      }
      if (cached && context.cacheDecision === "reuse") {
        await reuseCachedAnalysisLocal(context, buildRhythmStructureCachePrompt(context, cached));
        return null;
      }

      const inputPackage = await runtime.runStage(context, STAGES.inputPackaged, 24, {
        artifactId: context.artifactId,
        parentArtifactId: input.parentArtifactId,
        inputSummary: {
          sampleVideoId: context.sampleVideoId,
          sourceShotBoundaryArtifactId: input.parentArtifactId,
          shotCount: input.shots.length,
          scriptSegmentCount: input.scriptSegments.length,
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

      const analyzeTurn = renderAnalyzeTurnInputs({ input, inputPackage, roleProfile: context.roleProfile });

      const analyzed = await runtime.runStage(context, STAGES.analyzed, 56, {
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
            onTurnCollect: (turn) => runtime.updateActiveThreadMessage(context, turn),
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
          cardCount: result.analysis.cards.length,
          promptTemplateVersion: result.analysis.agent?.promptTemplateVersion ?? null,
        }),
      });

      let analysis = analyzed.analysis;
      let finalTurn = analyzed.finalTurn;

      const validated = await runtime.runStage(context, STAGES.validated, 74, {
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        inputSummary: {
          cardCount: analysis.cards.length,
          turnId: finalTurn?.turnId ?? null,
        },
        action: () => analysis,
        outputSummary: (result) => ({
          status: result.validation?.status ?? null,
          cardCount: result.cards.length,
          validatorCode: result.validation?.validatorCode ?? null,
          repairAttemptCount: result.validation?.repairAttemptCount ?? 0,
        }),
      });

      analysis = validated;

      if (analysis.validation?.status !== "passed") {
        throw codedError("rhythm_structure_validation_failed", "节奏结构输出未通过校验", {
          validation: analysis.validation,
          turnId: finalTurn?.turnId ?? null,
        }, false);
      }

      const materializedArtifact = await runtime.runStage(context, STAGES.materialized, 96, {
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        inputSummary: {
          cardCount: analysis.cards.length,
          threadId: analysis.agent?.threadId ?? null,
          turnId: analysis.agent?.turnId ?? null,
        },
        action: async () => {
          const latestArtifact = await loadArtifact(context.sampleVideoId, store);
          assertExpectedShotBoundaryArtifact(latestArtifact, context.input.parentArtifactId);
          assertExpectedScriptSegmentArtifact(latestArtifact, context.input.sourceScriptSegmentArtifactId ?? context.expectedScriptSegmentArtifactId ?? null);
          const nextArtifact = await attachRhythmStructures(context.sampleVideoId, analysis, store);
          await artifactIndex.registerSampleArtifact({
            artifact: nextArtifact,
            fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
            traceId: context.traceContext.traceId,
          });
          return nextArtifact;
        },
        outputSummary: (artifact) => ({
          cardCount: artifact.rhythmStructureAnalysis?.cards?.length ?? 0,
          rhythmArtifactId: artifact.rhythmStructureAnalysis?.artifactId ?? null,
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

      runtime.job.complete(context);
      return materializedArtifact;
    } catch (error) {
      if (error?.code === "rhythm_structure_validation_failed" && context.agentRun?.threadId && context.input) {
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
        await cleanupLease(threadPool, lease, context.traceContext.traceId, "rhythm-structure-analysis-failed");
      } else if (context.agentRun?.threadId) {
        await cleanupLease(threadPool, { thread_id: context.agentRun.threadId, lease_id: context.agentRun.leaseId }, context.traceContext.traceId, "rhythm-structure-analysis-failed");
      }
      await runtime.markFailed(context, error);
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
      const repaired = await runtime.runStage(context, STAGES.repaired, 88, {
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
            onTurnCollect: (turn) => runtime.updateActiveThreadMessage(context, turn),
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
          cardCount: result.analysis.cards.length,
          repairAttemptCount: result.repairAttemptCount,
        }),
      });

      const analysis = repaired.analysis;
      const materializedArtifact = await runtime.runStage(context, STAGES.materialized, 96, {
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        inputSummary: {
          cardCount: analysis.cards.length,
          threadId: analysis.agent?.threadId ?? null,
          turnId: analysis.agent?.turnId ?? null,
          repairAttemptCount: analysis.validation?.repairAttemptCount ?? 0,
        },
        action: async () => {
          const latestArtifact = await loadArtifact(context.sampleVideoId, store);
          assertExpectedShotBoundaryArtifact(latestArtifact, context.input.parentArtifactId);
          assertExpectedScriptSegmentArtifact(latestArtifact, context.input.sourceScriptSegmentArtifactId ?? context.expectedScriptSegmentArtifactId ?? null);
          const nextArtifact = await attachRhythmStructures(context.sampleVideoId, analysis, store);
          await artifactIndex.registerSampleArtifact({
            artifact: nextArtifact,
            fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
            traceId: context.traceContext.traceId,
          });
          return nextArtifact;
        },
        outputSummary: (artifact) => ({
          cardCount: artifact.rhythmStructureAnalysis?.cards?.length ?? 0,
          rhythmArtifactId: artifact.rhythmStructureAnalysis?.artifactId ?? null,
        }),
      });

      runtime.job.complete(context);
      return materializedArtifact;
    }
    return null;
  }

  return { enqueue, resolveCacheDecision };

  async function runCacheLookupLocal(context, input) {
    return runCacheLookup({
      context,
      input,
      runStage: runtime.runStage,
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
      runStage: runtime.runStage,
      stageName: STAGES.cacheReuse,
      resolvePrompt: () => resolveCachedPrompt({
        cachePrompt,
        artifactIndex,
        evaluateCacheEligibility,
        codedError,
        expectedCacheKey: context.cacheKey ?? null,
      }),
      buildCacheReuseAnalysis,
      attachAnalysis: (sampleVideoId, analysis, traceMeta) => attachRhythmStructures(sampleVideoId, analysis, store, traceMeta),
      registerArtifact: async (artifact) => {
        await artifactIndex.registerSampleArtifact({
          artifact,
          fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
          traceId: context.traceContext.traceId,
        });
      },
    });
    runtime.job.complete(context);
  }

  function buildRhythmStructureCachePrompt(context, cached) {
    return {
      cacheKind: "rhythm_structure",
      cachedItem: {
        sampleVideoId: cached.cache.sampleVideoId,
        filename: context.artifact.sampleVideo?.original?.summary ?? "样例视频",
        durationSeconds: context.artifact.metadata?.durationSeconds ?? null,
        width: context.artifact.metadata?.width ?? null,
        height: context.artifact.metadata?.height ?? null,
        updatedAt: cached.cache.updatedAt ?? null,
        tags: ["节奏结构"],
        cacheAvailable: true,
        cacheKind: "rhythm_structure",
        traceId: cached.analysis?.agent?.turnId ?? null,
        sourceSampleVideoId: cached.cache.sampleVideoId,
        sourceTurnId: cached.analysis?.agent?.turnId ?? null,
        sourceCreatedAt: cached.analysis?.createdAt ?? null,
        cacheKey: context.cacheKey ?? cached.cache.cacheKey ?? null,
        cardCount: cached.analysis?.cards?.length ?? 0,
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
      expectedScriptSegmentArtifactId: context.input?.sourceScriptSegmentArtifactId ?? context.expectedScriptSegmentArtifactId ?? null,
      dependencies: {
        shotBoundaryArtifactId: context.input?.parentArtifactId ?? context.expectedShotBoundaryArtifactId ?? null,
        scriptSegmentArtifactId: context.input?.sourceScriptSegmentArtifactId ?? context.expectedScriptSegmentArtifactId ?? null,
      },
      analysisOptions: {},
    };
  }
}

function buildAnalyzePromptTemplate(roleProfile) {
  const prompt = roleProfile?.turnTemplates?.analyze ?? {};
  return {
    promptTemplateId: "analyze",
    promptTemplateVersion: prompt.templateVersion ?? null,
    promptTemplateHash: prompt.templateHash ?? null,
  };
}

function assertExpectedShotBoundaryArtifact(artifact, expectedShotBoundaryArtifactId) {
  return assertExpectedArtifact({
    expectedArtifactId: expectedShotBoundaryArtifactId,
    actualArtifactId: artifact?.shotBoundaryAnalysis?.artifactId ?? null,
    conflictError,
    code: "rhythm_structure_shot_boundary_stale",
    message: "切镜结果已更新，请刷新后再运行节奏结构分析",
    expectedKey: "expectedShotBoundaryArtifactId",
    actualKey: "actualShotBoundaryArtifactId",
  });
}

function assertExpectedScriptSegmentArtifact(artifact, expectedScriptSegmentArtifactId) {
  return assertExpectedArtifact({
    expectedArtifactId: expectedScriptSegmentArtifactId,
    actualArtifactId: artifact?.scriptSegmentAnalysis?.artifactId ?? null,
    conflictError,
    code: "rhythm_structure_script_segment_stale",
    message: "脚本段落结果已更新，请刷新后再运行节奏结构分析",
    expectedKey: "expectedScriptSegmentArtifactId",
    actualKey: "actualScriptSegmentArtifactId",
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

async function attachRhythmStructures(sampleVideoId, rhythmStructureAnalysis, store, traceMeta = {}) {
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  const artifact = await store.readJson(artifactPath);
  artifact.rhythmStructureAnalysis = rhythmStructureAnalysis;
  artifact.rhythmStructureAnalysisHistory = appendRhythmStructureHistory(artifact.rhythmStructureAnalysisHistory, rhythmStructureAnalysis, {
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
  createRhythmStructureService,
  prepareInput,
};

