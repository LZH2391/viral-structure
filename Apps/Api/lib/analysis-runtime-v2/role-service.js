const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../../Infrastructure/Observability/trace");
const { createAnalysisRuntimeV2 } = require("./index");
const { createAnalysisPipelineRunner } = require("./pipeline-runner");
const { loadRoleProfileByRole } = require("../role-profile-loader");
const { createThreadPoolProxy } = require("../threadpool-proxy");
const { createAppServerBridge } = require("../appserver-bridge");

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_COLLECT_TIMEOUT_MS = 360000;
const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;

function createRoleAnalysisService({
  rootDir = path.resolve(__dirname, "..", "..", "..", ".."),
  store,
  logger,
  jobStore,
  artifactIndex,
  threadPool = createThreadPoolProxy(),
  appServer = createAppServerBridge(),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  collectTimeoutMs = DEFAULT_COLLECT_TIMEOUT_MS,
  maxCollectAttempts = Math.ceil(collectTimeoutMs / DEFAULT_POLL_INTERVAL_MS),
  maxRepairAttempts = DEFAULT_MAX_REPAIR_ATTEMPTS,
  role,
  skillPath,
  stages,
  safeError,
  sanitizeDebugPayload,
  buildFailedArtifact,
  attachFailedAnalysis,
  defaultFailedStageName,
  resolveDefaultParentArtifactId,
  createDescriptor,
  prepareInput,
  buildContentFingerprint,
  resolveSkillHash,
  cacheKind,
  cacheDecisionInvalidJobCode = "cache_decision_invalid_job",
  cacheDecisionInvalidJobMessage,
  cacheDecisionInvalidCode = "cache_decision_invalid",
  cacheDecisionInvalidMessage = "缓存选择无效，请选择复用或重新生成",
  assertFreshArtifact = () => undefined,
  buildContextPatch = () => ({}),
  readCacheContextPatch = () => ({}),
  codedError,
} = {}) {
  const runtime = createAnalysisRuntimeV2({
    logger,
    jobStore,
    sampleStatus: SAMPLE_STATUS,
    safeError,
    sanitizeDebugPayload,
    buildFailedArtifact,
    attachFailedAnalysis,
    defaultFailedStageName: defaultFailedStageName ?? stages?.analyzed,
    resolveDefaultParentArtifactId,
    artifactIndex,
    resolveExistingFileHash,
  });
  const descriptor = createDescriptor({ store, artifactIndex });
  const pipelineRunner = createAnalysisPipelineRunner({
    runtime,
    threadPool,
    appServer,
    rootDir,
    pollIntervalMs,
    maxCollectAttempts,
    maxRepairAttempts,
  });

  async function enqueue({ sampleVideoId, cacheDecision = "ask", ...options }) {
    await store.ensureRuntimeDirs();
    const artifact = await loadArtifact(sampleVideoId, store);
    assertFreshArtifact({ artifact, options });
    const traceContext = createTraceContext(createTraceIds());
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    const context = await buildFreshContext({
      sampleVideoId,
      cacheDecision,
      artifact,
      traceContext,
      job,
      options,
    });
    pipelineRunner.runAnalysisPipeline(context, descriptor).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function resolveCacheDecision({ jobId, decision }) {
    const job = jobStore.getJob(jobId);
    if (!job || job.status !== SAMPLE_STATUS.cacheWaiting || job.cachePrompt?.cacheKind !== cacheKind) {
      throw badRequestError(cacheDecisionInvalidJobCode, cacheDecisionInvalidJobMessage);
    }
    const artifact = await loadArtifact(job.sampleVideoId, store);
    const cacheOptions = readCacheContextPatch(job.cachePrompt);
    assertFreshArtifact({ artifact, options: cacheOptions });
    const roleProfile = await loadRoleProfileByRole(role);
    const analyzePromptTemplate = descriptor.buildAnalyzePromptTemplate(roleProfile);
    const input = prepareInput(artifact, { runtimeRoot: store.runtimeRoot });
    const context = await buildContext({
      sampleVideoId: job.sampleVideoId,
      cacheDecision: decision,
      artifact,
      traceContext: {
        runId: job.traceId,
        traceId: job.traceId,
        stageId: `stage_cache_decision_${Date.now()}`,
      },
      job,
      roleProfile,
      skillPath: job.cachePrompt.skillPath ?? skillPath,
      skillHash: job.cachePrompt.skillHash ?? await resolveSkillHash(skillPath),
      artifactId: job.cachePrompt.artifactId ?? `artifact_${randomUUID()}`,
      input,
      promptTemplate: {
        promptTemplateId: job.cachePrompt.promptTemplateId ?? analyzePromptTemplate.promptTemplateId,
        promptTemplateVersion: job.cachePrompt.promptTemplateVersion ?? analyzePromptTemplate.promptTemplateVersion,
        promptTemplateHash: job.cachePrompt.promptTemplateHash ?? analyzePromptTemplate.promptTemplateHash,
      },
      cacheKey: buildContentFingerprint(input),
      contextPatch: cacheOptions,
    });
    if (decision === "reuse") {
      try {
        await descriptor.reuseCachedAnalysis({ context, cachePrompt: job.cachePrompt, runtime });
        runtime.job.complete(context);
      } catch (error) {
        await runtime.markFailed(context, error);
      }
      return jobStore.getJob(jobId);
    }
    if (decision === "refresh") {
      runtime.job.resumeProcessing(jobId, stages.cacheLookup, descriptor.progress.cacheLookup);
      pipelineRunner.runAnalysisPipeline({ ...context, cacheDecision: "refresh" }, descriptor).catch(() => undefined);
      return jobStore.getJob(jobId);
    }
    throw badRequestError(cacheDecisionInvalidCode, cacheDecisionInvalidMessage);
  }

  async function buildFreshContext({ sampleVideoId, cacheDecision, artifact, traceContext, job, options }) {
    const roleProfile = await loadRoleProfileByRole(role);
    const input = prepareInput(artifact, { runtimeRoot: store.runtimeRoot });
    return buildContext({
      sampleVideoId,
      cacheDecision,
      artifact,
      traceContext,
      job,
      roleProfile,
      skillPath,
      skillHash: await resolveSkillHash(skillPath),
      artifactId: `artifact_${randomUUID()}`,
      input: null,
      promptTemplate: descriptor.buildAnalyzePromptTemplate(roleProfile),
      cacheKey: buildContentFingerprint(input),
      contextPatch: buildContextPatch(options),
    });
  }

  async function buildContext({
    sampleVideoId,
    cacheDecision,
    artifact,
    traceContext,
    job,
    roleProfile,
    skillPath: contextSkillPath,
    skillHash,
    artifactId,
    input,
    promptTemplate,
    cacheKey,
    contextPatch,
  }) {
    return {
      sampleVideoId,
      cacheDecision,
      artifact,
      traceContext,
      job,
      roleProfile,
      skillPath: contextSkillPath,
      skillHash,
      activeStage: null,
      artifactId,
      input,
      inputPackage: null,
      promptTemplate,
      agentRun: null,
      validationSummary: null,
      cacheKey,
      nextStage,
      ...contextPatch,
    };
  }

  function badRequestError(code, message, debugPayload = null) {
    const error = codedError(code, message, debugPayload, false);
    error.statusCode = 400;
    return error;
  }

  async function resolveExistingFileHash(sampleVideoId) {
    const item = await artifactIndex.getItem(sampleVideoId).catch(() => null);
    return item?.fileHash ?? null;
  }

  return { enqueue, resolveCacheDecision };
}

async function loadArtifact(sampleVideoId, store) {
  return store.readJson(path.join(store.sampleDir(sampleVideoId), "artifact.json"));
}

module.exports = {
  createRoleAnalysisService,
};
