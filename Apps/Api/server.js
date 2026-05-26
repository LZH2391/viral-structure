const http = require("http");
const fs = require("fs");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");
const { parseMultipartUpload } = require("./lib/multipart");
const { createJobStore } = require("./lib/job-store");
const { createWorkflowRunStore } = require("./lib/workflow-run-store");
const { createSampleProcessingService } = require("./lib/sample-processing-service");
const { createArtifactIndex } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createArtifactCacheParamBuilders } = require("./lib/artifact-cache-param-builders");
const { sendJson, notFound } = require("./lib/http-utils");
const { createWorkbenchStaticHandler } = require("./lib/static-files");
const { sendRuntimeFile } = require("./lib/runtime-files");
const { readDebugTraces, readDebugTraceDetail } = require("./lib/debug-traces");
const { readJsonBody, ingestUiDebugEvent } = require("./lib/ui-debug-events");
const { recordApiRequestFailure } = require("./lib/api-request-debug");
const { readCapabilities } = require("./lib/capabilities");
const { createThreadPoolProxy } = require("./lib/threadpool-proxy");
const { createShotBoundaryService } = require("./lib/shot-boundary-service");
const { createAppServerBridge } = require("./lib/appserver-bridge");
const { summarizeThreadConversation } = require("./lib/thread-conversation");
const { createSubtitleRevisionService } = require("./lib/subtitle-revision-service");
const { createAnalysisRoleRegistry } = require("./lib/analysis-role-registry");
const { createFullAnalysisWorkflowService } = require("./lib/full-analysis-workflow-service");
const { loadCurrentSampleArtifact } = require("./lib/artifact-reader");
const { createTraceContext } = require("../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../Infrastructure/Observability/trace");

const rootDir = path.resolve(__dirname, "../..");
const port = Number(process.env.PORT || 5177);
const store = createLocalStore(rootDir);
const logger = createStageLogger(store);
const jobStore = createJobStore({ filePath: path.join(store.runtimeRoot, "Jobs", "processing-jobs.json") });
const workflowRunStore = createWorkflowRunStore({ filePath: path.join(store.runtimeRoot, "WorkflowRuns", "workflow-runs.json") });
const artifactIndex = createArtifactIndex({ store, cacheParamBuilders: createArtifactCacheParamBuilders() });
const service = createSampleProcessingService({ store, logger, jobStore, artifactIndex });
const appServer = createAppServerBridge();
const threadPool = createThreadPoolProxy({
  readThreadImpl: async (threadId) => appServer.readThread({ workspaceRoot: rootDir, threadId }),
});
const shotBoundaryService = createShotBoundaryService({ rootDir, store, logger, jobStore, artifactIndex, threadPool, appServer });
const subtitleRevisionService = createSubtitleRevisionService({ store, logger, artifactIndex });
const analysisRegistry = createAnalysisRoleRegistry({ store, logger, jobStore, artifactIndex });
const fullAnalysisWorkflowService = createFullAnalysisWorkflowService({ workflowRunStore, service, shotBoundaryService, analysisRegistry, jobStore, logger, store, artifactIndex });
const staticWorkbench = createWorkbenchStaticHandler(rootDir);

function createServer(deps = {}) {
  const activeStore = deps.store ?? store;
  const activeLogger = deps.logger ?? logger;
  const activeJobStore = deps.jobStore ?? jobStore;
  const activeWorkflowRunStore = deps.workflowRunStore ?? workflowRunStore;
  const activeArtifactIndex = deps.artifactIndex ?? artifactIndex;
  const activeSampleService = deps.service ?? service;
  const activeShotBoundaryService = deps.shotBoundaryService ?? shotBoundaryService;
  const activeAnalysisRegistry = deps.analysisRegistry ?? createAnalysisRoleRegistry({
    rootDir: deps.rootDir ?? rootDir,
    store: activeStore,
    logger: activeLogger,
    jobStore: activeJobStore,
    artifactIndex: activeArtifactIndex,
    threadPool: deps.threadPool ?? threadPool,
    appServer: deps.appServer ?? appServer,
    serviceOverrides: {
      scriptSegmentService: deps.scriptSegmentService,
      rhythmStructureService: deps.rhythmStructureService,
      packagingStructureService: deps.packagingStructureService,
    },
  });
  const handlers = {
    logger: activeLogger,
    store: activeStore,
    jobStore: activeJobStore,
    workflowRunStore: activeWorkflowRunStore,
    artifactIndex: activeArtifactIndex,
    service: activeSampleService,
    threadPool: deps.threadPool ?? threadPool,
    appServer: deps.appServer ?? appServer,
    shotBoundaryService: activeShotBoundaryService,
    subtitleRevisionService: deps.subtitleRevisionService ?? subtitleRevisionService,
    analysisRegistry: activeAnalysisRegistry,
    fullAnalysisWorkflowService: deps.fullAnalysisWorkflowService ?? createFullAnalysisWorkflowService({
      workflowRunStore: activeWorkflowRunStore,
      service: activeSampleService,
      shotBoundaryService: activeShotBoundaryService,
      analysisRegistry: activeAnalysisRegistry,
      jobStore: activeJobStore,
      logger: activeLogger,
      store: activeStore,
      artifactIndex: activeArtifactIndex,
      loadSampleArtifact: deps.loadCurrentSampleArtifact ?? loadCurrentSampleArtifact,
    }),
    staticWorkbench: deps.staticWorkbench ?? staticWorkbench,
    rootDir: deps.rootDir ?? rootDir,
    sendRuntimeFileImpl: deps.sendRuntimeFile ?? sendRuntimeFile,
    readDebugTracesImpl: deps.readDebugTraces ?? readDebugTraces,
    readDebugTraceDetailImpl: deps.readDebugTraceDetail ?? readDebugTraceDetail,
    readJsonBodyImpl: deps.readJsonBody ?? readJsonBody,
    ingestUiDebugEventImpl: deps.ingestUiDebugEvent ?? ingestUiDebugEvent,
    recordApiRequestFailureImpl: deps.recordApiRequestFailure ?? recordApiRequestFailure,
    readCapabilitiesImpl: deps.readCapabilities ?? readCapabilities,
    loadCurrentSampleArtifactImpl: deps.loadCurrentSampleArtifact ?? loadCurrentSampleArtifact,
  };

  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return sendJson(res, 200, {});
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/api/capabilities") return await handleCapabilities(res, handlers);
      if (req.method === "GET" && url.pathname === "/api/analysis-roles") return await handleAnalysisRoles(res, handlers);
      if (req.method === "POST" && url.pathname === "/api/workflows/full-analysis/runs") return await handleFullAnalysisRun(req, res, handlers);
      if (req.method === "POST" && url.pathname === "/api/workflows/full-analysis/cache-check") return await handleFullAnalysisCacheCheck(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/workflows/full-analysis/latest") return await handleLatestFullAnalysisRun(res, handlers);
      if (req.method === "GET" && /^\/api\/workflows\/runs\/[^/]+$/.test(url.pathname)) return await handleWorkflowRun(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "POST" && /^\/api\/workflows\/runs\/[^/]+\/stages\/[^/]+\/rerun$/.test(url.pathname)) return await handleWorkflowStageRerun(res, decodeURIComponent(url.pathname.split("/").at(-4)), decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/workspaces\/[^/]+\/sample-videos$/.test(url.pathname)) return await handleUpload(req, res, url, handlers);
      if (req.method === "GET" && /^\/api\/processing-jobs\/[^/]+$/.test(url.pathname)) return handleJob(res, url.pathname.split("/").at(-1), handlers);
      if (req.method === "POST" && /^\/api\/processing-jobs\/[^/]+\/cache-decision$/.test(url.pathname)) return await handleJobCacheDecision(req, res, url.pathname.split("/").at(-2), handlers);
      if (req.method === "GET" && /^\/api\/sample-videos\/[^/]+\/artifact$/.test(url.pathname)) return await handleArtifact(res, url.pathname.split("/").at(-2), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/subtitles\/revisions$/.test(url.pathname)) return await handleSubtitleRevision(req, res, decodeURIComponent(url.pathname.split("/").at(-3)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/shot-boundary$/.test(url.pathname)) return await handleShotBoundary(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/analyses\/[^/]+$/.test(url.pathname)) return await handleAnalysis(req, res, decodeURIComponent(url.pathname.split("/").at(-3)), decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/script-segments$/.test(url.pathname)) return await handleScriptSegments(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/rhythm-structure$/.test(url.pathname)) return await handleRhythmStructure(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/packaging-structure$/.test(url.pathname)) return await handlePackagingStructure(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "GET" && url.pathname === "/api/threadpool/health") return await handleThreadPoolRead(res, "health", () => handlers.threadPool.health(), handlers);
      if (req.method === "GET" && url.pathname === "/api/threadpool/config") return await handleThreadPoolRead(res, "config", () => handlers.threadPool.config(), handlers);
      if (req.method === "GET" && url.pathname === "/api/threadpool/roles") return await handleThreadPoolRead(res, "roles", () => handlers.threadPool.roles(), handlers);
      if (req.method === "GET" && /^\/api\/threadpool\/roles\/[^/]+\/status$/.test(url.pathname)) return await handleThreadPoolRead(res, "role-status", () => handlers.threadPool.roleStatus(decodeURIComponent(url.pathname.split("/").at(-2))), handlers);
      if (req.method === "GET" && /^\/api\/threadpool\/threads\/[^/]+\/conversation$/.test(url.pathname)) return await handleThreadConversation(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/threadpool\/threads\/[^/]+\/discard$/.test(url.pathname)) return await handleThreadDiscard(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && url.pathname === "/api/threadpool/leases/release-owner") return await handleOwnerLeaseRelease(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/library/items") return await handleLibraryItems(res, handlers);
      if (req.method === "GET" && /^\/api\/library\/items\/[^/]+$/.test(url.pathname)) return await handleLibraryItem(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "POST" && /^\/api\/library\/items\/[^/]+\/load$/.test(url.pathname)) return await handleLibraryLoad(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "DELETE" && /^\/api\/library\/items\/[^/]+\/cache$/.test(url.pathname)) return await handleLibraryDeleteCache(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && url.pathname === "/api/debug/ui-events") return await handleUiDebugEvent(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/debug/traces") return await handleDebugTraces(res, handlers);
      if (req.method === "GET" && /^\/api\/debug\/traces\/[^/]+$/.test(url.pathname)) return await handleDebugTraceDetail(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "GET" && url.pathname.startsWith("/runtime/")) return handlers.sendRuntimeFileImpl(req, res, handlers.store.runtimeRoot, url.pathname);
      if (req.method === "GET" && handlers.staticWorkbench.handle(req, res, url.pathname)) return undefined;
      return notFound(res);
    } catch (error) {
      const failure = await handlers.recordApiRequestFailureImpl(handlers.logger, req, error).catch(() => null);
      if (error.statusCode) {
        return sendJson(res, error.statusCode, {
          error: error.code ?? (error.statusCode === 400 ? "bad_request" : "request_failed"),
          code: error.code ?? null,
          message: error.message,
          traceId: error.traceId ?? failure?.traceContext?.traceId ?? null,
          debugSnapshotUri: error.debugSnapshotUri ?? failure?.snapshot?.uri ?? null,
          stageName: error.stageName ?? failure?.errorSummary?.stageName ?? null,
          retryable: typeof error.retryable === "boolean" ? error.retryable : error.statusCode >= 500,
        });
      }
      return sendJson(res, 500, {
        error: "internal_error",
        code: "internal_error",
        message: "请求处理失败",
        traceId: failure?.traceContext?.traceId ?? null,
        debugSnapshotUri: failure?.snapshot?.uri ?? null,
        stageName: "api.request.handle",
        retryable: true,
      });
    }
  });
}

const server = createServer();

async function initializeServerRuntime(runtime = {}) {
  const activeStore = runtime.store ?? store;
  const activeShotBoundaryService = runtime.shotBoundaryService ?? shotBoundaryService;
  await activeStore.ensureRuntimeDirs();
  if (typeof activeShotBoundaryService.interruptActiveAgentRuns === "function") {
    await activeShotBoundaryService.interruptActiveAgentRuns("server-startup");
    return;
  }
  await activeShotBoundaryService.recoverActiveAgentRuns();
}

async function handleUpload(req, res, url, handlers = {}) {
  const workspaceId = url.pathname.split("/")[3];
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  const result = await (handlers.service ?? service).enqueueUpload({ workspaceId, file, fields });
  sendJson(res, 202, result);
}

async function handleCapabilities(res, handlers = {}) {
  return sendJson(res, 200, await (handlers.readCapabilitiesImpl ?? readCapabilities)());
}

async function handleAnalysisRoles(res, handlers = {}) {
  return sendJson(res, 200, { roles: (handlers.analysisRegistry ?? analysisRegistry).list() });
}

async function handleFullAnalysisRun(req, res, handlers = {}) {
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  const result = await (handlers.fullAnalysisWorkflowService ?? fullAnalysisWorkflowService).start({
    workspaceId: fields.workspaceId || "default-workspace",
    file,
    fields,
  });
  return sendJson(res, 202, result);
}

async function handleFullAnalysisCacheCheck(req, res, handlers = {}) {
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  if (fields.cacheDecision === "refresh") return sendJson(res, 200, { cacheHit: false });
  const cachedItem = await (handlers.artifactIndex ?? artifactIndex).findLatestByFileHash(hashBuffer(file.buffer));
  return sendJson(res, 200, cachedItem ? { cacheHit: true, cachedItem } : { cacheHit: false });
}

async function handleLatestFullAnalysisRun(res, handlers = {}) {
  const workflow = handlers.fullAnalysisWorkflowService ?? fullAnalysisWorkflowService;
  const latest = workflow.getLatest?.() ?? null;
  if (latest?.workflowRunId && typeof workflow.advance === "function") {
    await workflow.advance(latest.workflowRunId).catch(() => undefined);
  }
  const run = latest?.workflowRunId ? (workflow.get(latest.workflowRunId) ?? latest) : null;
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleWorkflowRun(res, workflowRunId, handlers = {}) {
  const workflow = handlers.fullAnalysisWorkflowService ?? fullAnalysisWorkflowService;
  if (typeof workflow.advance === "function") {
    await workflow.advance(workflowRunId).catch(() => undefined);
  }
  const run = workflow.get(workflowRunId);
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleWorkflowStageRerun(res, workflowRunId, stageKey, handlers = {}) {
  const run = await (handlers.fullAnalysisWorkflowService ?? fullAnalysisWorkflowService).rerunStage({ workflowRunId, stageKey });
  if (!run) return notFound(res);
  return sendJson(res, 202, run);
}

function handleJob(res, jobId, handlers = {}) {
  const job = (handlers.jobStore ?? jobStore).getJob(jobId);
  if (!job) return notFound(res);
  return sendJson(res, 200, job);
}

async function handleArtifact(res, sampleVideoId, handlers = {}) {
  const artifact = await (handlers.loadCurrentSampleArtifactImpl ?? loadCurrentSampleArtifact)({
    sampleVideoId,
    store: handlers.store ?? store,
    artifactIndex: handlers.artifactIndex ?? artifactIndex,
  });
  if (!artifact) return sendJson(res, 202, { sampleVideoId, status: "processing" });
  return sendJson(res, 200, artifact);
}

async function handleShotBoundary(req, res, sampleVideoId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const result = await (handlers.shotBoundaryService ?? shotBoundaryService).enqueue({ sampleVideoId, analysisFps: body.analysisFps ?? 10, cacheDecision: body.cacheDecision ?? "ask", enableReview: body.enableReview ?? true });
  return sendJson(res, 202, result);
}

async function handleSubtitleRevision(req, res, sampleVideoId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const result = await (handlers.subtitleRevisionService ?? subtitleRevisionService).saveRevision({
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
  const result = await (handlers.analysisRegistry ?? analysisRegistry).startAnalysis({
    analysisId,
    sampleVideoId,
    body,
  });
  return sendJson(res, 202, result);
}

async function handleLegacyAnalysis(req, res, sampleVideoId, legacyPathSegment, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const result = await (handlers.analysisRegistry ?? analysisRegistry).startLegacyAnalysis({
    legacyPathSegment,
    sampleVideoId,
    body,
  });
  return sendJson(res, 202, result);
}

async function handleJobCacheDecision(req, res, jobId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const activeJobStore = handlers.jobStore ?? jobStore;
  const job = activeJobStore.getJob(jobId);
  if (!job) return notFound(res);
  const cacheKind = job.cachePrompt?.cacheKind ?? null;
  const analysisResult = await (handlers.analysisRegistry ?? analysisRegistry).resolveAnalysisCacheDecision({ cacheKind, jobId, decision: body.decision });
  const result = analysisResult ?? await (handlers.shotBoundaryService ?? shotBoundaryService).resolveCacheDecision({ jobId, decision: body.decision });
  return sendJson(res, 200, result);
}

async function handleThreadPoolRead(res, scope, action, handlers = {}) {
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  const activeLogger = handlers.logger ?? logger;
  await activeLogger.writeStageLog({
    traceContext,
    stageName: "threadPool.status.read",
    event: "stage.start",
    inputSummary: { scope },
  });
  try {
    const result = await action();
    await activeLogger.writeStageLog({
      traceContext,
      stageName: "threadPool.status.read",
      event: "stage.end",
      outputSummary: summarizeThreadPoolRead(scope, result),
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, result?.ok === false && result.unavailable ? 503 : 200, result);
  } catch (error) {
    const snapshot = await activeLogger.writeDebugSnapshot({
      traceContext,
      stageName: "threadPool.status.read",
      reason: "threadpool_status_read_failed",
      inputSummary: { scope },
      debugPayload: { message: error instanceof Error ? error.message : "ThreadPool 读取失败" },
    });
    await activeLogger.writeStageLog({
      traceContext,
      stageName: "threadPool.status.read",
      event: "stage.fail",
      errorSummary: { code: "threadpool_status_read_failed", message: "ThreadPool 状态读取失败", retryable: true, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, 503, { ok: false, unavailable: true, error: "threadpool_status_read_failed", message: "ThreadPool 状态读取失败" });
  }
}

async function handleThreadDiscard(req, res, threadId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  return handleThreadPoolRead(res, "discard", () => (handlers.threadPool ?? threadPool).discardThread({ threadId, reason: body.reason || "manual-discard" }), handlers);
}

async function handleThreadConversation(res, threadId, handlers = {}) {
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  const activeLogger = handlers.logger ?? logger;
  const activeThreadPool = handlers.threadPool ?? threadPool;
  const activeAppServer = handlers.appServer ?? appServer;
  await activeLogger.writeStageLog({
    traceContext,
    stageName: "threadPool.conversation.read",
    event: "stage.start",
    inputSummary: { threadId },
  });
  try {
    const allowedThread = await activeThreadPool.findAllowedThread(threadId);
    if (!allowedThread?.ok) {
      await activeLogger.writeStageLog({
        traceContext,
        stageName: "threadPool.conversation.read",
        event: "stage.end",
        outputSummary: {
          threadId,
          allowed: false,
          statusCode: 403,
          error: allowedThread?.error ?? null,
          message: allowedThread?.message ?? null,
        },
        durationMs: Date.now() - startedAt,
      });
      return sendJson(res, 403, allowedThread);
    }
    const thread = await activeAppServer.readThread({ workspaceRoot: handlers.rootDir ?? rootDir, threadId });
    const conversation = summarizeThreadConversation(thread.thread ?? {});
    await activeLogger.writeStageLog({
      traceContext,
      stageName: "threadPool.conversation.read",
      event: "stage.end",
      outputSummary: {
        threadId: conversation.threadId,
        turnCount: conversation.turns.length,
        status: conversation.status ?? null,
      },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, 200, conversation);
  } catch (error) {
    const snapshot = await activeLogger.writeDebugSnapshot({
      traceContext,
      stageName: "threadPool.conversation.read",
      reason: "threadpool_conversation_read_failed",
      inputSummary: { threadId },
      debugPayload: { message: error instanceof Error ? error.message : "Thread conversation 读取失败" },
    });
    await activeLogger.writeStageLog({
      traceContext,
      stageName: "threadPool.conversation.read",
      event: "stage.fail",
      errorSummary: { code: "threadpool_conversation_read_failed", message: "Thread conversation 读取失败", retryable: true, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, 503, { ok: false, unavailable: true, error: "threadpool_conversation_read_failed", message: "Thread conversation 读取失败" });
  }
}

async function handleOwnerLeaseRelease(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  return handleThreadPoolRead(res, "release-owner", () => (handlers.threadPool ?? threadPool).releaseOwnerLeases(body.ownerId || body.owner_id), handlers);
}

async function handleLibraryItems(res, handlers = {}) {
  return sendJson(res, 200, { items: await (handlers.artifactIndex ?? artifactIndex).listItems() });
}

async function handleLibraryItem(res, sampleVideoId, handlers = {}) {
  const item = await (handlers.artifactIndex ?? artifactIndex).getItem(sampleVideoId);
  if (!item) return notFound(res);
  return sendJson(res, 200, item);
}

async function handleLibraryLoad(res, sampleVideoId, handlers = {}) {
  const artifact = await (handlers.artifactIndex ?? artifactIndex).loadItem(sampleVideoId);
  if (!artifact) return notFound(res);
  return sendJson(res, 200, { sampleArtifact: artifact });
}

async function handleLibraryDeleteCache(res, sampleVideoId, handlers = {}) {
  const activeArtifactIndex = handlers.artifactIndex ?? artifactIndex;
  const activeStore = handlers.store ?? store;
  const result = await activeArtifactIndex.deleteCacheForItem(sampleVideoId);
  if (!result) return notFound(res);
  for (const removedId of result.removedSampleVideoIds) {
    await fs.promises.rm(activeStore.sampleDir(removedId), { recursive: true, force: true }).catch(() => undefined);
  }
  return sendJson(res, 200, { ok: true, ...result });
}

async function handleDebugTraces(res, handlers = {}) {
  const activeStore = handlers.store ?? store;
  return sendJson(res, 200, await (handlers.readDebugTracesImpl ?? readDebugTraces)(activeStore.runtimeRoot));
}

async function handleUiDebugEvent(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  return sendJson(res, 200, await (handlers.ingestUiDebugEventImpl ?? ingestUiDebugEvent)(handlers.logger ?? logger, body));
}

async function handleDebugTraceDetail(res, traceId, handlers = {}) {
  const activeStore = handlers.store ?? store;
  const trace = await (handlers.readDebugTraceDetailImpl ?? readDebugTraceDetail)(activeStore.runtimeRoot, traceId);
  if (!trace) return notFound(res);
  return sendJson(res, 200, trace);
}

function summarizeThreadPoolRead(scope, result) {
  if (!result?.ok) return { scope, unavailable: Boolean(result?.unavailable), error: result?.error ?? null };
  if (scope === "roles") return { scope, roleCount: result.roles?.length ?? 0, warmingRoles: result.health?.warming_roles ?? [] };
  if (scope === "role-status") return { scope, role: result.role, idle: result.counts?.idle ?? 0, minIdle: result.minIdle ?? 0, leased: result.counts?.leased ?? 0 };
  return { scope, readyForLeases: result.ready_for_leases ?? result.readyForLeases ?? null, recovering: result.recovering ?? null };
}

if (require.main === module) {
  initializeServerRuntime()
    .catch(() => undefined)
    .finally(() => {
      server.listen(port, () => process.stdout.write(`API server listening on http://127.0.0.1:${port}\n`));
    });
}

module.exports = { server, createServer, initializeServerRuntime };
