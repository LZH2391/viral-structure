const { parseMultipartUpload } = require("./multipart");
const { sendJson, notFound } = require("./utils");
const { readCapabilities } = require("./capabilities");
const { readJsonBody } = require("../observability/ui-debug-events");
const { loadCurrentSampleArtifact } = require("../stores/artifact-reader");
const { bindConversationDefaultMaterialPack } = require("../agent-chat/material-pack-binding");

async function handleUpload(req, res, url, handlers = {}) {
  const workspaceId = url.pathname.split("/")[3];
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  const result = await handlers.service.enqueueUpload({ workspaceId, file, fields });
  sendJson(res, 202, result);
}

async function handleCapabilities(res, handlers = {}) {
  return sendJson(res, 200, await (handlers.readCapabilitiesImpl ?? readCapabilities)());
}

async function handleAnalysisRoles(res, handlers = {}) {
  return sendJson(res, 200, { roles: handlers.analysisRegistry.list() });
}

async function handleModules(res, handlers = {}) {
  return sendJson(res, 200, { modules: handlers.moduleRegistry.list() });
}

function handleJob(res, jobId, handlers = {}) {
  const activeJobStore = handlers.jobStore;
  const job = activeJobStore.getJob(jobId) ?? activeJobStore.getArchivedJob?.(jobId) ?? null;
  if (!job) return notFound(res);
  return sendJson(res, 200, job);
}

async function handleArtifact(res, sampleVideoId, handlers = {}) {
  const artifact = await (handlers.loadCurrentSampleArtifactImpl ?? loadCurrentSampleArtifact)({
    sampleVideoId,
    store: handlers.store,
    artifactIndex: handlers.artifactIndex,
  });
  if (!artifact) return sendJson(res, 202, { sampleVideoId, status: "processing" });
  return sendJson(res, 200, artifact);
}

async function handleShotBoundary(req, res, sampleVideoId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const result = await handlers.moduleRegistry.startModule({ moduleId: "shot-boundary", sampleVideoId, body });
  return sendJson(res, 202, result);
}

async function handleSubtitleRevision(req, res, sampleVideoId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const result = await handlers.subtitleRevisionService.saveRevision({
    sampleVideoId,
    segments: body.segments,
    expectedSubtitleArtifactId: body.expectedSubtitleArtifactId ?? null,
    expectedRevisionIndex: body.expectedRevisionIndex ?? null,
  });
  return sendJson(res, 200, result);
}

async function handleScriptSegments(req, res, sampleVideoId, handlers = {}) {
  return handleLegacyAnalysis(req, res, sampleVideoId, "script-segments", handlers);
}

async function handleRhythmStructure(req, res, sampleVideoId, handlers = {}) {
  return handleLegacyAnalysis(req, res, sampleVideoId, "rhythm-structure", handlers);
}

async function handlePackagingStructure(req, res, sampleVideoId, handlers = {}) {
  return handleLegacyAnalysis(req, res, sampleVideoId, "packaging-structure", handlers);
}

async function handleAnalysis(req, res, sampleVideoId, analysisId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const result = await handlers.analysisRegistry.startAnalysis({
    analysisId,
    sampleVideoId,
    body,
  });
  return sendJson(res, 202, result);
}

async function handleLegacyAnalysis(req, res, sampleVideoId, legacyPathSegment, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const result = await handlers.analysisRegistry.startLegacyAnalysis({
    legacyPathSegment,
    sampleVideoId,
    body,
  });
  return sendJson(res, 202, result);
}

async function handleJobCacheDecision(req, res, jobId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const activeJobStore = handlers.jobStore;
  const job = activeJobStore.getJob(jobId);
  if (!job) return notFound(res);
  const cacheKind = job.cachePrompt?.cacheKind ?? inferCacheKindFromJob(job);
  const analysisResult = await handlers.moduleRegistry.resolveModuleCacheDecision({ cacheKind, jobId, decision: body.decision });
  const result = analysisResult ?? await handlers.shotBoundaryService.resolveCacheDecision({ jobId, decision: body.decision });
  await advanceWorkflowRunsForJob(handlers, jobId);
  return sendJson(res, 200, result);
}

function inferCacheKindFromJob(job) {
  const stage = String(job?.stage ?? "");
  if (stage.startsWith("shot.") || stage.startsWith("shot_boundary") || job?.cachePrompt?.cachedItem?.tags?.includes("切镜")) return "shot_boundary";
  return null;
}

async function advanceWorkflowRunsForJob(handlers, jobId) {
  const runs = typeof handlers.workflowRunStore?.listRuns === "function" ? handlers.workflowRunStore.listRuns() : [];
  const matched = runs.filter((run) => runHasChildJob(run, jobId));
  for (const run of matched) {
    const service = run.workflowKey === "material-recognition"
      ? handlers.materialRecognitionWorkflowService
      : handlers.fullAnalysisWorkflowService;
    await service?.advance?.(run.workflowRunId)?.catch?.(() => undefined);
  }
}

function runHasChildJob(run, jobId) {
  if (!jobId || !Array.isArray(run?.stages)) return false;
  return run.stages.some((stage) => stage?.childJobId === jobId);
}

async function bindCompletedMaterialRecognitionItem({ agentConversationStore, logger, batch, item, context }) {
  const targetConversationId = normalizeServerText(context?.fields?.targetConversationId ?? batch?.fields?.targetConversationId);
  const shouldBind = normalizeServerBoolean(context?.fields?.bindMaterialToConversation ?? batch?.fields?.bindMaterialToConversation) || Boolean(targetConversationId);
  if (!targetConversationId || !shouldBind || !context?.artifact) return null;
  return bindConversationDefaultMaterialPack({
    handlers: { agentConversationStore },
    conversationId: targetConversationId,
    artifact: context.artifact,
    binding: {
      source: "material-recognition-batch",
      workflowKey: context.workflowKey ?? batch?.workflowKey ?? "material-recognition",
      workflowRunId: item?.workflowRunId ?? context.workflowRun?.workflowRunId ?? null,
      batchRunId: batch?.batchRunId ?? item?.batchRunId ?? null,
      queueItemId: item?.queueItemId ?? null,
      traceId: context.workflowRun?.traceId ?? null,
      runId: context.workflowRun?.runId ?? null,
      stageId: context.workflowRun?.stageId ?? null,
    },
    traceContext: {
      traceId: context.workflowRun?.traceId ?? batch?.batchRunId ?? "material-recognition-batch",
      runId: context.workflowRun?.runId ?? batch?.batchRunId ?? "material-recognition-batch",
      stageId: context.workflowRun?.stageId ?? item?.queueItemId ?? "material-recognition-batch-item",
    },
  }).catch(async (error) => {
    await logger?.writeDebugSnapshot?.({
      traceContext: {
        traceId: context.workflowRun?.traceId ?? batch?.batchRunId ?? "material-recognition-batch",
        runId: context.workflowRun?.runId ?? batch?.batchRunId ?? "material-recognition-batch",
        stageId: context.workflowRun?.stageId ?? item?.queueItemId ?? "material-recognition-batch-item",
      },
      stageName: "agentChat.materialPack.bindDefault",
      reason: error?.code ?? "material_pack_default_bind_failed",
      inputSummary: {
        conversationId: targetConversationId,
        sampleVideoId: item?.sampleVideoId ?? context.artifact?.sampleVideoId ?? null,
        workflowRunId: item?.workflowRunId ?? null,
        batchRunId: batch?.batchRunId ?? null,
        queueItemId: item?.queueItemId ?? null,
      },
      debugPayload: {
        message: error instanceof Error ? error.message : "素材包默认绑定失败",
      },
    }).catch(() => undefined);
    return null;
  });
}

function normalizeServerText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeServerBoolean(value) {
  return value === true || String(value ?? "").trim().toLowerCase() === "true";
}

module.exports = {
  bindCompletedMaterialRecognitionItem,
  handleAnalysis,
  handleAnalysisRoles,
  handleArtifact,
  handleCapabilities,
  handleJob,
  handleJobCacheDecision,
  handleLegacyAnalysis,
  handleModules,
  handlePackagingStructure,
  handleRhythmStructure,
  handleScriptSegments,
  handleShotBoundary,
  handleSubtitleRevision,
  handleUpload,
};
