const { hashBuffer } = require("../../../../Infrastructure/ArtifactIndex/artifact-index");
const { parseMultipartUpload, parseMultipartUploads } = require("./multipart");
const { sendJson, notFound } = require("./utils");

async function handleWorkflowRoute(req, res, url, handlers = {}) {
  if (req.method === "POST" && url.pathname === "/api/workflows/full-analysis/runs") { await handleFullAnalysisRun(req, res, handlers); return true; }
  if (req.method === "POST" && url.pathname === "/api/workflows/full-analysis/batch-runs") { await handleFullAnalysisBatchRun(req, res, handlers); return true; }
  if (req.method === "GET" && url.pathname === "/api/workflows/full-analysis/batch-runs/latest") { await handleFullAnalysisBatchLatest(res, handlers, url); return true; }
  if (req.method === "GET" && /^\/api\/workflows\/full-analysis\/batch-runs\/[^/]+$/.test(url.pathname)) { await handleFullAnalysisBatchRead(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers); return true; }
  if (req.method === "POST" && /^\/api\/workflows\/full-analysis\/batch-runs\/[^/]+\/items\/[^/]+\/retry$/.test(url.pathname)) { await handleFullAnalysisBatchItemRetry(res, decodeURIComponent(url.pathname.split("/").at(-4)), decodeURIComponent(url.pathname.split("/").at(-2)), handlers); return true; }
  if (req.method === "POST" && url.pathname === "/api/workflows/full-analysis/cache-check") { await handleFullAnalysisCacheCheck(req, res, handlers); return true; }
  if (req.method === "GET" && url.pathname === "/api/workflows/full-analysis/latest") { await handleLatestFullAnalysisRun(res, handlers); return true; }
  if (req.method === "GET" && /^\/api\/sample-videos\/[^/]+\/workflows\/full-analysis\/latest$/.test(url.pathname)) { await handleLatestFullAnalysisRunForSample(res, decodeURIComponent(url.pathname.split("/").at(-4)), handlers); return true; }
  if (req.method === "POST" && url.pathname === "/api/workflows/material-recognition/runs") { await handleMaterialRecognitionRun(req, res, handlers); return true; }
  if (req.method === "POST" && url.pathname === "/api/workflows/material-recognition/batch-runs") { await handleMaterialRecognitionBatchRun(req, res, handlers); return true; }
  if (req.method === "GET" && url.pathname === "/api/workflows/material-recognition/batch-runs/latest") { await handleMaterialRecognitionBatchLatest(res, handlers, url); return true; }
  if (req.method === "GET" && /^\/api\/workflows\/material-recognition\/batch-runs\/[^/]+$/.test(url.pathname)) { await handleMaterialRecognitionBatchRead(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers); return true; }
  if (req.method === "POST" && /^\/api\/workflows\/material-recognition\/batch-runs\/[^/]+\/items\/[^/]+\/retry$/.test(url.pathname)) { await handleMaterialRecognitionBatchItemRetry(res, decodeURIComponent(url.pathname.split("/").at(-4)), decodeURIComponent(url.pathname.split("/").at(-2)), handlers); return true; }
  if (req.method === "POST" && url.pathname === "/api/workflows/material-recognition/cache-check") { await handleFullAnalysisCacheCheck(req, res, handlers); return true; }
  if (req.method === "GET" && url.pathname === "/api/workflows/material-recognition/latest") { await handleLatestMaterialRecognitionRun(res, handlers); return true; }
  if (req.method === "GET" && /^\/api\/sample-videos\/[^/]+\/workflows\/material-recognition\/latest$/.test(url.pathname)) { await handleLatestMaterialRecognitionRunForSample(res, decodeURIComponent(url.pathname.split("/").at(-4)), handlers); return true; }
  if (req.method === "GET" && /^\/api\/workflows\/runs\/[^/]+$/.test(url.pathname)) { await handleWorkflowRun(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers); return true; }
  if (req.method === "POST" && /^\/api\/workflows\/runs\/[^/]+\/stages\/[^/]+\/rerun$/.test(url.pathname)) { await handleWorkflowStageRerun(res, decodeURIComponent(url.pathname.split("/").at(-4)), decodeURIComponent(url.pathname.split("/").at(-2)), handlers); return true; }
  return false;
}

async function handleFullAnalysisRun(req, res, handlers = {}) {
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  const result = await (handlers.fullAnalysisWorkflowService).start({
    workspaceId: fields.workspaceId || "default-workspace",
    file,
    fields,
  });
  return sendJson(res, 202, result);
}

async function handleMaterialRecognitionRun(req, res, handlers = {}) {
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  const result = await (handlers.materialRecognitionWorkflowService).start({
    workspaceId: fields.workspaceId || "default-workspace",
    file,
    fields,
  });
  return sendJson(res, 202, result);
}

async function handleFullAnalysisBatchRun(req, res, handlers = {}) {
  const { files, fields } = await parseMultipartUploads(req, req.headers["content-type"]);
  const queue = resolveBatchQueue("full-analysis", handlers);
  const result = queue.createBatch({
    workspaceId: fields.workspaceId || "default-workspace",
    files,
    fields,
  });
  return sendJson(res, 202, result);
}

async function handleFullAnalysisBatchRead(res, batchRunId, handlers = {}) {
  const queue = resolveBatchQueue("full-analysis", handlers);
  await queue.advance?.(batchRunId).catch(() => undefined);
  const batch = queue.getBatch(batchRunId);
  if (!batch) return notFound(res);
  return sendJson(res, 200, batch);
}

async function handleFullAnalysisBatchLatest(res, handlers = {}, url = null) {
  const queue = resolveBatchQueue("full-analysis", handlers);
  const activeOnly = url?.searchParams?.get("active") === "true";
  const batch = activeOnly ? queue.getLatestActiveBatch?.() : queue.getLatestBatch?.();
  if (!batch) return notFound(res);
  await queue.advance?.(batch.batchRunId).catch(() => undefined);
  const updated = queue.getBatch?.(batch.batchRunId) ?? batch;
  return sendJson(res, 200, updated);
}

async function handleFullAnalysisBatchItemRetry(res, batchRunId, queueItemId, handlers = {}) {
  const queue = resolveBatchQueue("full-analysis", handlers);
  const batch = queue.retryItem?.(batchRunId, queueItemId);
  if (!batch) return notFound(res);
  return sendJson(res, 202, batch);
}

async function handleMaterialRecognitionBatchRun(req, res, handlers = {}) {
  const { files, fields } = await parseMultipartUploads(req, req.headers["content-type"]);
  const queue = resolveBatchQueue("material-recognition", handlers);
  const result = queue.createBatch({
    workspaceId: fields.workspaceId || "default-workspace",
    files,
    fields,
  });
  return sendJson(res, 202, result);
}

async function handleMaterialRecognitionBatchRead(res, batchRunId, handlers = {}) {
  const queue = resolveBatchQueue("material-recognition", handlers);
  await queue.advance?.(batchRunId).catch(() => undefined);
  const batch = queue.getBatch(batchRunId);
  if (!batch) return notFound(res);
  return sendJson(res, 200, batch);
}

async function handleMaterialRecognitionBatchLatest(res, handlers = {}, url = null) {
  const queue = resolveBatchQueue("material-recognition", handlers);
  const activeOnly = url?.searchParams?.get("active") === "true";
  const batch = activeOnly ? queue.getLatestActiveBatch?.() : queue.getLatestBatch?.();
  if (!batch) return notFound(res);
  await queue.advance?.(batch.batchRunId).catch(() => undefined);
  const updated = queue.getBatch?.(batch.batchRunId) ?? batch;
  return sendJson(res, 200, updated);
}

async function handleMaterialRecognitionBatchItemRetry(res, batchRunId, queueItemId, handlers = {}) {
  const queue = resolveBatchQueue("material-recognition", handlers);
  const batch = queue.retryItem?.(batchRunId, queueItemId);
  if (!batch) return notFound(res);
  return sendJson(res, 202, batch);
}

async function handleFullAnalysisCacheCheck(req, res, handlers = {}) {
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  if (fields.cacheDecision === "refresh") return sendJson(res, 200, { cacheHit: false });
  const cachedItem = await (handlers.artifactIndex).findLatestByFileHash(hashBuffer(file.buffer));
  return sendJson(res, 200, cachedItem ? { cacheHit: true, cachedItem } : { cacheHit: false });
}

async function handleLatestFullAnalysisRun(res, handlers = {}) {
  const workflow = handlers.fullAnalysisWorkflowService;
  const latest = workflow.getLatest?.() ?? null;
  if (latest?.workflowRunId && typeof workflow.advance === "function") {
    await workflow.advance(latest.workflowRunId).catch(() => undefined);
  }
  const run = latest?.workflowRunId ? (workflow.get(latest.workflowRunId) ?? latest) : null;
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleLatestFullAnalysisRunForSample(res, sampleVideoId, handlers = {}) {
  const workflow = handlers.fullAnalysisWorkflowService;
  const latest = workflow.getLatestBySampleVideoId?.(sampleVideoId) ?? null;
  if (latest?.workflowRunId && typeof workflow.advance === "function") {
    await workflow.advance(latest.workflowRunId).catch(() => undefined);
  }
  const run = latest?.workflowRunId ? (workflow.get(latest.workflowRunId) ?? latest) : null;
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleLatestMaterialRecognitionRun(res, handlers = {}) {
  const workflow = handlers.materialRecognitionWorkflowService;
  const latest = workflow.getLatest?.() ?? null;
  if (latest?.workflowRunId && typeof workflow.advance === "function") {
    await workflow.advance(latest.workflowRunId).catch(() => undefined);
  }
  const run = latest?.workflowRunId ? (workflow.get(latest.workflowRunId) ?? latest) : null;
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleLatestMaterialRecognitionRunForSample(res, sampleVideoId, handlers = {}) {
  const workflow = handlers.materialRecognitionWorkflowService;
  const latest = workflow.getLatestBySampleVideoId?.(sampleVideoId) ?? null;
  if (latest?.workflowRunId && typeof workflow.advance === "function") {
    await workflow.advance(latest.workflowRunId).catch(() => undefined);
  }
  const run = latest?.workflowRunId ? (workflow.get(latest.workflowRunId) ?? latest) : null;
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleWorkflowRun(res, workflowRunId, handlers = {}) {
  const workflow = resolveWorkflowService(workflowRunId, handlers);
  if (typeof workflow.advance === "function") {
    await workflow.advance(workflowRunId).catch(() => undefined);
  }
  const run = workflow.get(workflowRunId);
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleWorkflowStageRerun(res, workflowRunId, stageKey, handlers = {}) {
  const run = await resolveWorkflowService(workflowRunId, handlers).rerunStage({ workflowRunId, stageKey });
  if (!run) return notFound(res);
  return sendJson(res, 202, run);
}

function resolveWorkflowService(workflowRunId, handlers = {}) {
  const storedRun = (handlers.workflowRunStore).getRun?.(workflowRunId);
  if (storedRun?.workflowKey === "material-recognition") {
    return handlers.materialRecognitionWorkflowService;
  }
  return handlers.fullAnalysisWorkflowService;
}

function resolveBatchQueue(workflowKey, handlers = {}) {
  return workflowKey === "material-recognition"
    ? handlers.materialRecognitionBatchQueue
    : handlers.fullAnalysisBatchQueue;
}


module.exports = { handleWorkflowRoute };
