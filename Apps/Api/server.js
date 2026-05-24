const http = require("http");
const fs = require("fs");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");
const { parseMultipartUpload } = require("./lib/multipart");
const { createJobStore } = require("./lib/job-store");
const { createSampleProcessingService } = require("./lib/sample-processing-service");
const { createArtifactIndex } = require("../../Infrastructure/ArtifactIndex/artifact-index");
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
const { createScriptSegmentService } = require("./lib/script-segment-service");
const { createRhythmStructureService } = require("./lib/rhythm-structure-service");
const { loadCurrentSampleArtifact } = require("./lib/artifact-reader");
const { createTraceContext } = require("../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../Infrastructure/Observability/trace");

const rootDir = path.resolve(__dirname, "../..");
const port = Number(process.env.PORT || 5177);
const store = createLocalStore(rootDir);
const logger = createStageLogger(store);
const jobStore = createJobStore({ filePath: path.join(store.runtimeRoot, "Jobs", "processing-jobs.json") });
const artifactIndex = createArtifactIndex({ store, cacheParamBuilders: createArtifactCacheParamBuilders() });
const service = createSampleProcessingService({ store, logger, jobStore, artifactIndex });
const threadPool = createThreadPoolProxy();
const appServer = createAppServerBridge();
const shotBoundaryService = createShotBoundaryService({ rootDir, store, logger, jobStore, artifactIndex, threadPool, appServer });
const subtitleRevisionService = createSubtitleRevisionService({ store, logger, artifactIndex });
const scriptSegmentService = createScriptSegmentService({ store, logger, jobStore, artifactIndex });
const rhythmStructureService = createRhythmStructureService({ store, logger, jobStore, artifactIndex });
const staticWorkbench = createWorkbenchStaticHandler(rootDir);

function createServer(deps = {}) {
  const handlers = {
    logger: deps.logger ?? logger,
    store: deps.store ?? store,
    jobStore: deps.jobStore ?? jobStore,
    artifactIndex: deps.artifactIndex ?? artifactIndex,
    service: deps.service ?? service,
    threadPool: deps.threadPool ?? threadPool,
    appServer: deps.appServer ?? appServer,
    shotBoundaryService: deps.shotBoundaryService ?? shotBoundaryService,
    subtitleRevisionService: deps.subtitleRevisionService ?? subtitleRevisionService,
    scriptSegmentService: deps.scriptSegmentService ?? scriptSegmentService,
    rhythmStructureService: deps.rhythmStructureService ?? rhythmStructureService,
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
      if (req.method === "GET" && url.pathname === "/api/capabilities") return handleCapabilities(res, handlers);
      if (req.method === "POST" && /^\/api\/workspaces\/[^/]+\/sample-videos$/.test(url.pathname)) return handleUpload(req, res, url, handlers);
      if (req.method === "GET" && /^\/api\/processing-jobs\/[^/]+$/.test(url.pathname)) return handleJob(res, url.pathname.split("/").at(-1), handlers);
      if (req.method === "POST" && /^\/api\/processing-jobs\/[^/]+\/cache-decision$/.test(url.pathname)) return handleJobCacheDecision(req, res, url.pathname.split("/").at(-2), handlers);
      if (req.method === "GET" && /^\/api\/sample-videos\/[^/]+\/artifact$/.test(url.pathname)) return handleArtifact(res, url.pathname.split("/").at(-2), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/subtitles\/revisions$/.test(url.pathname)) return handleSubtitleRevision(req, res, decodeURIComponent(url.pathname.split("/").at(-3)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/shot-boundary$/.test(url.pathname)) return handleShotBoundary(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/script-segments$/.test(url.pathname)) return handleScriptSegments(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/rhythm-structure$/.test(url.pathname)) return handleRhythmStructure(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "GET" && url.pathname === "/api/threadpool/health") return handleThreadPoolRead(res, "health", () => handlers.threadPool.health(), handlers);
      if (req.method === "GET" && url.pathname === "/api/threadpool/config") return handleThreadPoolRead(res, "config", () => handlers.threadPool.config(), handlers);
      if (req.method === "GET" && url.pathname === "/api/threadpool/roles") return handleThreadPoolRead(res, "roles", () => handlers.threadPool.roles(), handlers);
      if (req.method === "GET" && /^\/api\/threadpool\/roles\/[^/]+\/status$/.test(url.pathname)) return handleThreadPoolRead(res, "role-status", () => handlers.threadPool.roleStatus(decodeURIComponent(url.pathname.split("/").at(-2))), handlers);
      if (req.method === "GET" && /^\/api\/threadpool\/threads\/[^/]+\/conversation$/.test(url.pathname)) return handleThreadConversation(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/threadpool\/threads\/[^/]+\/discard$/.test(url.pathname)) return handleThreadDiscard(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && url.pathname === "/api/threadpool/leases/release-owner") return handleOwnerLeaseRelease(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/library/items") return handleLibraryItems(res, handlers);
      if (req.method === "GET" && /^\/api\/library\/items\/[^/]+$/.test(url.pathname)) return handleLibraryItem(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "POST" && /^\/api\/library\/items\/[^/]+\/load$/.test(url.pathname)) return handleLibraryLoad(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "DELETE" && /^\/api\/library\/items\/[^/]+\/cache$/.test(url.pathname)) return handleLibraryDeleteCache(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && url.pathname === "/api/debug/ui-events") return handleUiDebugEvent(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/debug/traces") return handleDebugTraces(res, handlers);
      if (req.method === "GET" && /^\/api\/debug\/traces\/[^/]+$/.test(url.pathname)) return handleDebugTraceDetail(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
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
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const result = await (handlers.scriptSegmentService ?? scriptSegmentService).enqueue({
    sampleVideoId,
    cacheDecision: body.cacheDecision ?? "ask",
    expectedShotBoundaryArtifactId: body.dependencies?.shotBoundaryArtifactId ?? body.expectedShotBoundaryArtifactId ?? null,
  });
  return sendJson(res, 202, result);
}

async function handleRhythmStructure(req, res, sampleVideoId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const result = await (handlers.rhythmStructureService ?? rhythmStructureService).enqueue({
    sampleVideoId,
    cacheDecision: body.cacheDecision ?? "ask",
    expectedShotBoundaryArtifactId: body.dependencies?.shotBoundaryArtifactId ?? body.expectedShotBoundaryArtifactId ?? null,
    expectedScriptSegmentArtifactId: body.dependencies?.scriptSegmentArtifactId ?? body.expectedScriptSegmentArtifactId ?? null,
  });
  return sendJson(res, 202, result);
}

async function handleJobCacheDecision(req, res, jobId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const activeJobStore = handlers.jobStore ?? jobStore;
  const job = activeJobStore.getJob(jobId);
  if (!job) return notFound(res);
  const cacheKind = job.cachePrompt?.cacheKind ?? null;
  const result = cacheKind === "script_segment"
    ? await (handlers.scriptSegmentService ?? scriptSegmentService).resolveCacheDecision({ jobId, decision: body.decision })
    : cacheKind === "rhythm_structure"
      ? await (handlers.rhythmStructureService ?? rhythmStructureService).resolveCacheDecision({ jobId, decision: body.decision })
      : await (handlers.shotBoundaryService ?? shotBoundaryService).resolveCacheDecision({ jobId, decision: body.decision });
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
