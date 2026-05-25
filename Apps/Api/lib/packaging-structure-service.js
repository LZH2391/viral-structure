const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const { createAnalysisRuntime, assertExpectedArtifact } = require("./analysis-service-shared");
const { createAnalysisPipelineRunner } = require("./analysis-runtime-v2/pipeline-runner");
const { loadRoleProfileByRole } = require("./role-profile-loader");
const { createThreadPoolProxy } = require("./threadpool-proxy");
const { createAppServerBridge } = require("./appserver-bridge");
const { createPackagingStructurePipelineDescriptor } = require("./packaging-structure/pipeline-descriptor");
const { buildPackagingStructureContentFingerprint } = require("./packaging-structure-analysis/cache-params");
const { prepareInput } = require("./packaging-structure-analysis/input");
const { buildFailedArtifact } = require("./packaging-structure-analysis/result-builder");
const { codedError, safeError, sanitizeDebugPayload, ROLE, SKILL_PATH, STAGES, resolveSkillHash } = require("./packaging-structure-analysis/shared");
const { attachPackagingStructureAnalysis } = require("./packaging-structure/artifact-writer");

const DEFAULT_POLL_INTERVAL_MS = 1500;
const MAX_REPAIR_ATTEMPTS = 1;
const PACKAGING_STRUCTURE_COLLECT_TIMEOUT_MS = 180000;
const MAX_COLLECT_ATTEMPTS = Math.ceil(PACKAGING_STRUCTURE_COLLECT_TIMEOUT_MS / DEFAULT_POLL_INTERVAL_MS);

function createPackagingStructureService({
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
    attachFailedAnalysis: (sampleVideoId, failedArtifact) => attachPackagingStructures(sampleVideoId, failedArtifact, store),
    defaultFailedStageName: STAGES.analyzed,
    resolveDefaultParentArtifactId: (context) => (
      context.input?.parentArtifactId
      ?? context.artifact?.shotBoundaryAnalysis?.artifactId
      ?? context.artifact?.sampleVideo?.artifactId
      ?? null
    ),
    artifactIndex,
    resolveExistingFileHash,
  });
  const descriptor = createPackagingStructurePipelineDescriptor({ store, artifactIndex });
  const pipelineRunner = createAnalysisPipelineRunner({
    runtime,
    threadPool,
    appServer,
    rootDir,
    pollIntervalMs,
    maxCollectAttempts: MAX_COLLECT_ATTEMPTS,
    maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
  });

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
      promptTemplate: buildAnalyzePromptTemplate(roleProfile),
      agentRun: null,
      validationSummary: null,
      cacheKey: buildPackagingStructureContentFingerprint(prepareInput(artifact, { runtimeRoot: store.runtimeRoot })),
      nextStage,
    };
    pipelineRunner.runAnalysisPipeline(context, descriptor).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function resolveCacheDecision({ jobId, decision }) {
    const job = jobStore.getJob(jobId);
    if (!job || job.status !== SAMPLE_STATUS.cacheWaiting || job.cachePrompt?.cacheKind !== "packaging_structure") {
      throw badRequestError("cache_decision_invalid_job", "只能对等待缓存选择的包装结构任务执行该操作");
    }
    const artifact = await loadArtifact(job.sampleVideoId, store);
    assertExpectedShotBoundaryArtifact(artifact, job.cachePrompt.expectedShotBoundaryArtifactId ?? null);
    const roleProfile = await loadRoleProfileByRole(ROLE);
    const analyzePromptTemplate = buildAnalyzePromptTemplate(roleProfile);
    const input = prepareInput(artifact, { runtimeRoot: store.runtimeRoot });
    const cacheKey = buildPackagingStructureContentFingerprint(input);
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
      inputPackage: null,
      promptTemplate: {
        promptTemplateId: job.cachePrompt.promptTemplateId ?? analyzePromptTemplate.promptTemplateId,
        promptTemplateVersion: job.cachePrompt.promptTemplateVersion ?? analyzePromptTemplate.promptTemplateVersion,
        promptTemplateHash: job.cachePrompt.promptTemplateHash ?? analyzePromptTemplate.promptTemplateHash,
      },
      agentRun: null,
      validationSummary: null,
      cacheKey,
      nextStage,
    };
    if (decision === "reuse") {
      try {
        await descriptor.reuseCachedAnalysis({
          context,
          cachePrompt: job.cachePrompt,
          runtime,
        });
        runtime.job.complete(context);
      } catch (error) {
        await runtime.markFailed(context, error);
      }
      return jobStore.getJob(jobId);
    }
    if (decision === "refresh") {
      runtime.job.resumeProcessing(jobId, STAGES.cacheLookup, 28);
      pipelineRunner.runAnalysisPipeline({ ...context, cacheDecision: "refresh" }, descriptor).catch(() => undefined);
      return jobStore.getJob(jobId);
    }
    throw badRequestError("cache_decision_invalid", "缓存选择无效，请选择复用或重新生成");
  }

  return { enqueue, resolveCacheDecision };
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
    code: "packaging_structure_shot_boundary_stale",
    message: "切镜结果已更新，请刷新后再运行包装结构分析",
    expectedKey: "expectedShotBoundaryArtifactId",
    actualKey: "actualShotBoundaryArtifactId",
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

async function attachPackagingStructures(sampleVideoId, packagingStructureAnalysis, store, traceMeta = {}) {
  return attachPackagingStructureAnalysis(sampleVideoId, packagingStructureAnalysis, store, traceMeta);
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
  createPackagingStructureService,
  prepareInput,
};

