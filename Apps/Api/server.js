const http = require("http");
const fs = require("fs");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");
const { parseMultipartUpload } = require("./lib/multipart");
const { createJobStore } = require("./lib/job-store");
const { createSampleProcessingService } = require("./lib/sample-processing-service");
const { createArtifactIndex } = require("../../Infrastructure/ArtifactIndex/artifact-index");
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
const { createTraceContext } = require("../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../Infrastructure/Observability/trace");

const rootDir = path.resolve(__dirname, "../..");
const port = Number(process.env.PORT || 5177);
const store = createLocalStore(rootDir);
const logger = createStageLogger(store);
const jobStore = createJobStore({ filePath: path.join(store.runtimeRoot, "Jobs", "processing-jobs.json") });
const artifactIndex = createArtifactIndex({ store });
const service = createSampleProcessingService({ store, logger, jobStore, artifactIndex });
const threadPool = createThreadPoolProxy();
const appServer = createAppServerBridge();
const shotBoundaryService = createShotBoundaryService({ rootDir, store, logger, jobStore, artifactIndex, threadPool, appServer });
const subtitleRevisionService = createSubtitleRevisionService({ store, logger, artifactIndex });
const scriptSegmentService = createScriptSegmentService({ store, logger, jobStore, artifactIndex });
const staticWorkbench = createWorkbenchStaticHandler(rootDir);

store.ensureRuntimeDirs()
  .then(() => shotBoundaryService.recoverActiveAgentRuns())
  .catch(() => undefined);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return sendJson(res, 200, {});
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/capabilities") return handleCapabilities(res);
    if (req.method === "POST" && /^\/api\/workspaces\/[^/]+\/sample-videos$/.test(url.pathname)) return handleUpload(req, res, url);
    if (req.method === "GET" && /^\/api\/processing-jobs\/[^/]+$/.test(url.pathname)) return handleJob(res, url.pathname.split("/").at(-1));
    if (req.method === "POST" && /^\/api\/processing-jobs\/[^/]+\/cache-decision$/.test(url.pathname)) return handleJobCacheDecision(req, res, url.pathname.split("/").at(-2));
    if (req.method === "GET" && /^\/api\/sample-videos\/[^/]+\/artifact$/.test(url.pathname)) return handleArtifact(res, url.pathname.split("/").at(-2));
    if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/subtitles\/revisions$/.test(url.pathname)) return handleSubtitleRevision(req, res, decodeURIComponent(url.pathname.split("/").at(-3)));
    if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/shot-boundary$/.test(url.pathname)) return handleShotBoundary(req, res, decodeURIComponent(url.pathname.split("/").at(-2)));
    if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/script-segments$/.test(url.pathname)) return handleScriptSegments(req, res, decodeURIComponent(url.pathname.split("/").at(-2)));
    if (req.method === "GET" && url.pathname === "/api/threadpool/health") return handleThreadPoolRead(res, "health", () => threadPool.health());
    if (req.method === "GET" && url.pathname === "/api/threadpool/config") return handleThreadPoolRead(res, "config", () => threadPool.config());
    if (req.method === "GET" && url.pathname === "/api/threadpool/roles") return handleThreadPoolRead(res, "roles", () => threadPool.roles());
    if (req.method === "GET" && /^\/api\/threadpool\/roles\/[^/]+\/status$/.test(url.pathname)) return handleThreadPoolRead(res, "role-status", () => threadPool.roleStatus(decodeURIComponent(url.pathname.split("/").at(-2))));
    if (req.method === "GET" && /^\/api\/threadpool\/threads\/[^/]+\/conversation$/.test(url.pathname)) return handleThreadConversation(res, decodeURIComponent(url.pathname.split("/").at(-2)));
    if (req.method === "POST" && /^\/api\/threadpool\/threads\/[^/]+\/discard$/.test(url.pathname)) return handleThreadDiscard(req, res, decodeURIComponent(url.pathname.split("/").at(-2)));
    if (req.method === "POST" && url.pathname === "/api/threadpool/leases/release-owner") return handleOwnerLeaseRelease(req, res);
    if (req.method === "GET" && url.pathname === "/api/library/items") return handleLibraryItems(res);
    if (req.method === "GET" && /^\/api\/library\/items\/[^/]+$/.test(url.pathname)) return handleLibraryItem(res, decodeURIComponent(url.pathname.split("/").at(-1)));
    if (req.method === "POST" && /^\/api\/library\/items\/[^/]+\/load$/.test(url.pathname)) return handleLibraryLoad(res, decodeURIComponent(url.pathname.split("/").at(-2)));
    if (req.method === "DELETE" && /^\/api\/library\/items\/[^/]+\/cache$/.test(url.pathname)) return handleLibraryDeleteCache(res, decodeURIComponent(url.pathname.split("/").at(-2)));
    if (req.method === "POST" && url.pathname === "/api/debug/ui-events") return handleUiDebugEvent(req, res);
    if (req.method === "GET" && url.pathname === "/api/debug/traces") return handleDebugTraces(res);
    if (req.method === "GET" && /^\/api\/debug\/traces\/[^/]+$/.test(url.pathname)) return handleDebugTraceDetail(res, decodeURIComponent(url.pathname.split("/").at(-1)));
    if (req.method === "GET" && url.pathname.startsWith("/runtime/")) return sendRuntimeFile(req, res, store.runtimeRoot, url.pathname);
    if (req.method === "GET" && staticWorkbench.handle(req, res, url.pathname)) return undefined;
    return notFound(res);
  } catch (error) {
    await recordApiRequestFailure(logger, req, error).catch(() => undefined);
    if (error.statusCode) {
      return sendJson(res, error.statusCode, {
        error: error.code ?? (error.statusCode === 400 ? "bad_request" : "request_failed"),
        code: error.code ?? null,
        message: error.message,
        traceId: error.traceId ?? null,
        debugSnapshotUri: error.debugSnapshotUri ?? null,
        stageName: error.stageName ?? null,
        retryable: typeof error.retryable === "boolean" ? error.retryable : error.statusCode >= 500,
      });
    }
    return sendJson(res, 500, { error: "internal_error", code: "internal_error", message: "请求处理失败", retryable: true });
  }
});

async function handleUpload(req, res, url) {
  const workspaceId = url.pathname.split("/")[3];
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  const result = await service.enqueueUpload({ workspaceId, file, fields });
  sendJson(res, 202, result);
}

async function handleCapabilities(res) {
  return sendJson(res, 200, await readCapabilities());
}

function handleJob(res, jobId) {
  const job = jobStore.getJob(jobId);
  if (!job) return notFound(res);
  return sendJson(res, 200, job);
}

async function handleArtifact(res, sampleVideoId) {
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  if (!fs.existsSync(artifactPath)) return sendJson(res, 202, { sampleVideoId, status: "processing" });
  return sendJson(res, 200, await store.readJson(artifactPath));
}

async function handleShotBoundary(req, res, sampleVideoId) {
  const body = await readJsonBody(req);
  const result = await shotBoundaryService.enqueue({ sampleVideoId, analysisFps: body.analysisFps ?? 1, cacheDecision: body.cacheDecision ?? "ask" });
  return sendJson(res, 202, result);
}

async function handleSubtitleRevision(req, res, sampleVideoId) {
  const body = await readJsonBody(req);
  const result = await subtitleRevisionService.saveRevision({
    sampleVideoId,
    segments: body.segments,
    expectedSubtitleArtifactId: body.expectedSubtitleArtifactId ?? null,
    expectedRevisionIndex: body.expectedRevisionIndex ?? null,
  });
  return sendJson(res, 200, result);
}

async function handleScriptSegments(req, res, sampleVideoId) {
  const body = await readJsonBody(req).catch(() => ({}));
  const result = await scriptSegmentService.enqueue({ sampleVideoId, cacheDecision: body.cacheDecision ?? "ask" });
  return sendJson(res, 202, result);
}

async function handleJobCacheDecision(req, res, jobId) {
  const body = await readJsonBody(req);
  const job = jobStore.getJob(jobId);
  if (!job) return notFound(res);
  const cacheKind = job.cachePrompt?.cacheKind ?? null;
  const result = cacheKind === "script_segment"
    ? await scriptSegmentService.resolveCacheDecision({ jobId, decision: body.decision })
    : await shotBoundaryService.resolveCacheDecision({ jobId, decision: body.decision });
  return sendJson(res, 200, result);
}

async function handleThreadPoolRead(res, scope, action) {
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  await logger.writeStageLog({
    traceContext,
    stageName: "threadPool.status.read",
    event: "stage.start",
    inputSummary: { scope },
  });
  try {
    const result = await action();
    await logger.writeStageLog({
      traceContext,
      stageName: "threadPool.status.read",
      event: "stage.end",
      outputSummary: summarizeThreadPoolRead(scope, result),
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, result?.ok === false && result.unavailable ? 503 : 200, result);
  } catch (error) {
    const snapshot = await logger.writeDebugSnapshot({
      traceContext,
      stageName: "threadPool.status.read",
      reason: "threadpool_status_read_failed",
      inputSummary: { scope },
      debugPayload: { message: error instanceof Error ? error.message : "ThreadPool 读取失败" },
    });
    await logger.writeStageLog({
      traceContext,
      stageName: "threadPool.status.read",
      event: "stage.fail",
      errorSummary: { code: "threadpool_status_read_failed", message: "ThreadPool 状态读取失败", retryable: true, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, 503, { ok: false, unavailable: true, error: "threadpool_status_read_failed", message: "ThreadPool 状态读取失败" });
  }
}

async function handleThreadDiscard(req, res, threadId) {
  const body = await readJsonBody(req);
  return handleThreadPoolRead(res, "discard", () => threadPool.discardThread({ threadId, reason: body.reason || "manual-discard" }));
}

async function handleThreadConversation(res, threadId) {
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  await logger.writeStageLog({
    traceContext,
    stageName: "threadPool.conversation.read",
    event: "stage.start",
    inputSummary: { threadId },
  });
  try {
    const allowedThread = await threadPool.findAllowedThread(threadId);
    if (!allowedThread?.ok) {
      return sendJson(res, 403, allowedThread);
    }
    const thread = await appServer.readThread({ workspaceRoot: rootDir, threadId });
    const conversation = summarizeThreadConversation(thread.thread ?? {});
    await logger.writeStageLog({
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
    const snapshot = await logger.writeDebugSnapshot({
      traceContext,
      stageName: "threadPool.conversation.read",
      reason: "threadpool_conversation_read_failed",
      inputSummary: { threadId },
      debugPayload: { message: error instanceof Error ? error.message : "Thread conversation 读取失败" },
    });
    await logger.writeStageLog({
      traceContext,
      stageName: "threadPool.conversation.read",
      event: "stage.fail",
      errorSummary: { code: "threadpool_conversation_read_failed", message: "Thread conversation 读取失败", retryable: true, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, 503, { ok: false, unavailable: true, error: "threadpool_conversation_read_failed", message: "Thread conversation 读取失败" });
  }
}

async function handleOwnerLeaseRelease(req, res) {
  const body = await readJsonBody(req);
  return handleThreadPoolRead(res, "release-owner", () => threadPool.releaseOwnerLeases(body.ownerId || body.owner_id));
}

async function handleLibraryItems(res) {
  return sendJson(res, 200, { items: await artifactIndex.listItems() });
}

async function handleLibraryItem(res, sampleVideoId) {
  const item = await artifactIndex.getItem(sampleVideoId);
  if (!item) return notFound(res);
  return sendJson(res, 200, item);
}

async function handleLibraryLoad(res, sampleVideoId) {
  const artifact = await artifactIndex.loadItem(sampleVideoId);
  if (!artifact) return notFound(res);
  return sendJson(res, 200, { sampleArtifact: artifact });
}

async function handleLibraryDeleteCache(res, sampleVideoId) {
  const result = await artifactIndex.deleteCacheForItem(sampleVideoId);
  if (!result) return notFound(res);
  for (const removedId of result.removedSampleVideoIds) {
    await fs.promises.rm(store.sampleDir(removedId), { recursive: true, force: true }).catch(() => undefined);
  }
  return sendJson(res, 200, { ok: true, ...result });
}

async function handleDebugTraces(res) {
  return sendJson(res, 200, await readDebugTraces(store.runtimeRoot));
}

async function handleUiDebugEvent(req, res) {
  const body = await readJsonBody(req);
  return sendJson(res, 200, await ingestUiDebugEvent(logger, body));
}

async function handleDebugTraceDetail(res, traceId) {
  const trace = await readDebugTraceDetail(store.runtimeRoot, traceId);
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
  server.listen(port, () => process.stdout.write(`API server listening on http://127.0.0.1:${port}\n`));
}

module.exports = { server };
