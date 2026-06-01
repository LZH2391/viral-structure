const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const DEFAULT_MAX_CONCURRENT_RUNS = 2;
const TERMINAL_WORKFLOW_STATUSES = new Set(["processed", "partial_failed", "failed"]);
const CACHE_WAITING_STATUS = "cache_waiting";

function createFullAnalysisBatchQueue({
  workflowService,
  runtimeRoot,
  filePath = path.join(runtimeRoot, "WorkflowRuns", "full-analysis-queue.json"),
  uploadRoot = path.join(runtimeRoot, "WorkflowRuns", "full-analysis-batch-uploads"),
  defaultMaxConcurrentRuns = DEFAULT_MAX_CONCURRENT_RUNS,
  logger = null,
} = {}) {
  const state = loadQueueState(filePath);
  restoreQueuedFiles(state, uploadRoot);
  let advancing = false;
  const pendingAdvances = new Set();
  const advanceWaiters = [];
  for (const batch of state.batches.filter((item) => !isBatchTerminal(item))) {
    scheduleAdvance(batch.batchRunId, 0);
  }

  function createBatch({ workspaceId, files, fields = {} }) {
    const now = new Date().toISOString();
    const batchRunId = `batch_${randomUUID()}`;
    const maxConcurrentRuns = normalizeMaxConcurrentRuns(fields.maxConcurrentRuns, defaultMaxConcurrentRuns);
    const items = files.map((file, index) => {
      const queueItemId = `batch_item_${randomUUID()}`;
      const storedFile = persistQueuedFile(uploadRoot, batchRunId, queueItemId, file);
      return {
        queueItemId,
        batchRunId,
        workflowRunId: null,
        sampleVideoId: null,
        filename: file.filename ?? file.name ?? `video-${index + 1}`,
        mimeType: file.mimeType ?? file.type ?? "application/octet-stream",
        size: file.size ?? file.buffer?.length ?? null,
        filePath: storedFile.filePath,
        status: "queued",
        position: index + 1,
        currentStageKeys: [],
        currentStageLabel: null,
        errorSummary: null,
        createdAt: now,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
      };
    });
    const batch = {
      batchRunId,
      workflowKey: "full-analysis",
      status: "queued",
      workspaceId,
      maxConcurrentRuns,
      fields: sanitizeWorkflowFields(fields),
      options: {
        enableFunctionSlotAtomization: fields.enableFunctionSlotAtomization !== "false",
      },
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      items,
    };
    state.batches.push(batch);
    persistQueueState(filePath, state);
    scheduleAdvance(batchRunId, 0);
    return publicBatch(batch);
  }

  function getBatch(batchRunId) {
    const batch = findBatch(batchRunId);
    if (!batch) return null;
    scheduleAdvance(batchRunId, 0);
    return publicBatch(batch);
  }

  function getLatestBatch() {
    const batch = [...state.batches].sort((a, b) => batchTime(b) - batchTime(a))[0];
    if (!batch) return null;
    scheduleAdvance(batch.batchRunId, 0);
    return publicBatch(batch);
  }

  function getLatestActiveBatch() {
    const batch = [...state.batches].filter((item) => !isBatchTerminal(item)).sort((a, b) => batchTime(b) - batchTime(a))[0];
    if (!batch) return null;
    scheduleAdvance(batch.batchRunId, 0);
    return publicBatch(batch);
  }

  function retryItem(batchRunId, queueItemId) {
    const batch = findBatch(batchRunId);
    if (!batch) return null;
    const item = batch.items.find((entry) => entry.queueItemId === queueItemId);
    if (!item || !isRetryableItem(item)) return publicBatch(batch);
    const now = new Date().toISOString();
    item.workflowRunId = null;
    item.sampleVideoId = null;
    item.status = "queued";
    item.position = nextQueuedPosition(batch);
    item.currentStageKeys = [];
    item.currentStageLabel = null;
    item.errorSummary = null;
    item.startedAt = null;
    item.completedAt = null;
    item.updatedAt = now;
    batch.status = "queued";
    batch.completedAt = null;
    batch.updatedAt = now;
    persistQueueState(filePath, state);
    scheduleAdvance(batchRunId, 0);
    return publicBatch(batch);
  }

  async function advance(batchRunId = null) {
    if (advancing) {
      pendingAdvances.add(batchRunId ?? "*");
      return waitForAdvanceDrain(batchRunId);
    }
    advancing = true;
    try {
      let targetBatchRunId = batchRunId;
      do {
        if (targetBatchRunId) pendingAdvances.delete(targetBatchRunId);
        else pendingAdvances.clear();
        const batches = state.batches.filter((batch) => (
          targetBatchRunId ? batch.batchRunId === targetBatchRunId : !isBatchTerminal(batch)
        ));
        for (const batch of batches) {
          await syncBatchItems(batch);
          await dispatchQueuedItems(batch);
          updateBatchStatus(batch);
          if (!isBatchTerminal(batch)) scheduleAdvance(batch.batchRunId, 2000);
        }
        persistQueueState(filePath, state);
        targetBatchRunId = nextPendingBatchRunId(pendingAdvances);
      } while (targetBatchRunId !== undefined);
      return batchRunId ? publicBatch(findBatch(batchRunId)) : null;
    } finally {
      advancing = false;
      resolveAdvanceWaiters();
    }
  }

  async function syncBatchItems(batch) {
    for (const item of batch.items) {
      if (!item.workflowRunId) continue;
      await workflowService.advance?.(item.workflowRunId).catch(() => undefined);
      const run = workflowService.get?.(item.workflowRunId);
      if (!run) continue;
      item.sampleVideoId = run.sampleVideoId ?? item.sampleVideoId ?? null;
      item.currentStageKeys = run.currentStageKeys ?? [];
      item.currentStageLabel = currentStageLabel(run);
      item.errorSummary = run.errorSummary ?? null;
      item.status = normalizeItemStatusFromRun(run.status);
      item.updatedAt = new Date().toISOString();
      if (isItemTerminal(item) && !item.completedAt) {
        item.completedAt = item.updatedAt;
        if (item.status === "processed") cleanupQueuedFile(item);
      }
    }
    assignQueuedPositions(batch);
  }

  async function dispatchQueuedItems(batch) {
    const limit = normalizeMaxConcurrentRuns(batch.maxConcurrentRuns, defaultMaxConcurrentRuns);
    let activeCount = batch.items.filter((item) => isActiveItem(item)).length;
    const queued = batch.items.filter((item) => item.status === "queued").sort((a, b) => a.position - b.position);
    for (const item of queued) {
      if (activeCount >= limit) break;
      await startQueueItem(batch, item);
      activeCount += 1;
    }
    assignQueuedPositions(batch);
  }

  async function startQueueItem(batch, item) {
    const now = new Date().toISOString();
    item.status = "running";
    item.startedAt = item.startedAt ?? now;
    item.updatedAt = now;
    item.errorSummary = null;
    persistQueueState(filePath, state);
    try {
      const file = readQueuedFile(item);
      const result = await workflowService.start({
        workspaceId: batch.workspaceId,
        file,
        fields: {
          ...batchFieldsForWorkflow(batch),
          maxConcurrentRuns: undefined,
        },
      });
      item.workflowRunId = result.workflowRunId;
      item.sampleVideoId = result.sampleVideoId ?? null;
      item.currentStageKeys = result.currentStageKeys ?? [];
      item.currentStageLabel = currentStageLabel(result);
      item.status = normalizeItemStatusFromRun(result.status);
      item.updatedAt = new Date().toISOString();
    } catch (error) {
      item.status = "failed";
      item.completedAt = new Date().toISOString();
      item.updatedAt = item.completedAt;
      item.errorSummary = normalizeQueueError(error);
      await logger?.writeDebugSnapshot?.({
        traceContext: { runId: `batch_${batch.batchRunId}`, traceId: batch.batchRunId, stageId: item.queueItemId },
        stageName: "workflow.full_analysis.batch.dispatch",
        reason: item.errorSummary.code,
        inputSummary: { batchRunId: batch.batchRunId, queueItemId: item.queueItemId, filename: item.filename },
        debugPayload: { message: item.errorSummary.message },
      }).catch(() => undefined);
    }
  }

  function batchFieldsForWorkflow(batch) {
    return {
      workspaceId: batch.workspaceId,
      frameSampleRateFps: batch.fields?.frameSampleRateFps ?? batch.frameSampleRateFps ?? undefined,
      enableAudioSeparation: batch.fields?.enableAudioSeparation ?? "true",
      enableSubtitleRecognition: batch.fields?.enableSubtitleRecognition ?? "true",
      enableAudioFeatureAnalysis: batch.fields?.enableAudioFeatureAnalysis ?? "true",
      enableFunctionSlotAtomization: batch.options?.enableFunctionSlotAtomization === false ? "false" : "true",
      cacheDecision: batch.fields?.cacheDecision ?? "ask",
    };
  }

  function scheduleAdvance(batchRunId, delayMs = 1000) {
    const timer = setTimeout(() => {
      advance(batchRunId).catch(() => undefined);
    }, delayMs);
    timer.unref?.();
  }

  function waitForAdvanceDrain(batchRunId) {
    return new Promise((resolve) => {
      advanceWaiters.push({ batchRunId, resolve });
    });
  }

  function resolveAdvanceWaiters() {
    while (advanceWaiters.length) {
      const waiter = advanceWaiters.shift();
      waiter.resolve(waiter.batchRunId ? publicBatch(findBatch(waiter.batchRunId)) : null);
    }
  }

  function findBatch(batchRunId) {
    return state.batches.find((batch) => batch.batchRunId === batchRunId) ?? null;
  }

  return {
    createBatch,
    getBatch,
    getLatestBatch,
    getLatestActiveBatch,
    retryItem,
    advance,
  };
}

function loadQueueState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { batches: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const batches = Array.isArray(parsed.batches) ? parsed.batches.map(normalizeLoadedBatch) : [];
    return { batches };
  } catch {
    return { batches: [] };
  }
}

function normalizeLoadedBatch(batch) {
  const items = Array.isArray(batch.items) ? batch.items.map((item) => {
    const status = item.status === "running" ? "queued" : item.status;
    return {
      ...item,
      status,
      position: Number(item.position ?? 0),
      currentStageKeys: Array.isArray(item.currentStageKeys) ? item.currentStageKeys : [],
    };
  }) : [];
  return {
    ...batch,
    restored: true,
    status: batch.status === "running" ? "queued" : batch.status,
    maxConcurrentRuns: normalizeMaxConcurrentRuns(batch.maxConcurrentRuns, DEFAULT_MAX_CONCURRENT_RUNS),
    items,
  };
}

function persistQueueState(filePath, state) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ batches: state.batches }, null, 2), "utf8");
}

function persistQueuedFile(uploadRoot, batchRunId, queueItemId, file) {
  const dir = path.join(uploadRoot, batchRunId);
  fs.mkdirSync(dir, { recursive: true });
  const extension = path.extname(file.filename ?? file.name ?? "") || ".bin";
  const filePath = path.join(dir, `${queueItemId}${extension}`);
  fs.writeFileSync(filePath, file.buffer);
  return { filePath };
}

function readQueuedFile(item) {
  const buffer = fs.readFileSync(item.filePath);
  return {
    filename: item.filename,
    mimeType: item.mimeType,
    extension: path.extname(item.filename),
    size: buffer.length,
    buffer,
  };
}

function cleanupQueuedFile(item) {
  if (!item.filePath) return;
  fs.rmSync(item.filePath, { force: true });
}

function restoreQueuedFiles(state, uploadRoot) {
  for (const batch of state.batches) {
    for (const item of batch.items ?? []) {
      if (!item?.filePath || fs.existsSync(item.filePath)) continue;
      const fallbackPath = path.join(uploadRoot, batch.batchRunId, path.basename(item.filePath));
      if (fs.existsSync(fallbackPath)) item.filePath = fallbackPath;
    }
  }
}

function normalizeMaxConcurrentRuns(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return Math.min(parsed, 12);
  const fallbackNumber = Number(fallback);
  return Number.isInteger(fallbackNumber) && fallbackNumber > 0 ? fallbackNumber : DEFAULT_MAX_CONCURRENT_RUNS;
}

function normalizeItemStatusFromRun(status) {
  if (status === CACHE_WAITING_STATUS) return CACHE_WAITING_STATUS;
  if (TERMINAL_WORKFLOW_STATUSES.has(status)) return status;
  return "running";
}

function isItemTerminal(item) {
  return TERMINAL_WORKFLOW_STATUSES.has(item?.status);
}

function isActiveItem(item) {
  return item?.status === "running" || item?.status === CACHE_WAITING_STATUS;
}

function isBatchTerminal(batch) {
  return batch?.items?.length && batch.items.every((item) => isItemTerminal(item));
}

function nextPendingBatchRunId(pendingAdvances) {
  if (pendingAdvances.has("*")) return null;
  const next = pendingAdvances.values().next();
  return next.done ? undefined : next.value;
}

function updateBatchStatus(batch) {
  const now = new Date().toISOString();
  if (batch.items.some((item) => item.status === "running")) batch.status = "running";
  else if (batch.items.some((item) => item.status === CACHE_WAITING_STATUS)) batch.status = CACHE_WAITING_STATUS;
  else if (batch.items.some((item) => item.status === "queued")) batch.status = "queued";
  else if (batch.items.some((item) => item.status === "failed" || item.status === "partial_failed")) batch.status = "partial_failed";
  else batch.status = "processed";
  batch.updatedAt = now;
  batch.completedAt = isBatchTerminal(batch) ? batch.completedAt ?? now : null;
}

function assignQueuedPositions(batch) {
  let position = 1;
  for (const item of batch.items) {
    if (item.status === "queued") {
      item.position = position;
      position += 1;
    } else {
      item.position = 0;
    }
  }
}

function nextQueuedPosition(batch) {
  return Math.max(0, ...batch.items.map((item) => Number(item.position ?? 0))) + 1;
}

function currentStageLabel(run) {
  const keys = run.currentStageKeys ?? [];
  if (!keys.length) return null;
  return keys.map((key) => run.stages?.find((stage) => stage.key === key)?.label ?? key).join(" / ");
}

function batchTime(batch) {
  return Date.parse(batch?.updatedAt ?? batch?.createdAt ?? "") || 0;
}

function isRetryableItem(item) {
  return ["failed", "partial_failed"].includes(String(item?.status ?? "")) && Boolean(item?.filePath && fs.existsSync(item.filePath));
}

function normalizeQueueError(error) {
  return {
    code: error?.code ?? "full_analysis_batch_item_failed",
    message: error instanceof Error ? error.message.slice(0, 240) : "批量完整分析任务启动失败",
    stageName: "workflow.full_analysis.batch.dispatch",
    retryable: true,
    debugSnapshotUri: error?.debugSnapshotUri ?? null,
  };
}

function publicBatch(batch) {
  if (!batch) return null;
  return {
    batchRunId: batch.batchRunId,
    workflowKey: batch.workflowKey,
    status: batch.status,
    workspaceId: batch.workspaceId,
    maxConcurrentRuns: batch.maxConcurrentRuns,
    options: batch.options ?? {},
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    completedAt: batch.completedAt ?? null,
    restored: Boolean(batch.restored),
    items: batch.items.map((item) => ({
      queueItemId: item.queueItemId,
      batchRunId: item.batchRunId,
      workflowRunId: item.workflowRunId,
      sampleVideoId: item.sampleVideoId,
      filename: item.filename,
      mimeType: item.mimeType,
      size: item.size,
      status: item.status,
      position: item.position,
      currentStageKeys: item.currentStageKeys ?? [],
      currentStageLabel: item.currentStageLabel ?? null,
      errorSummary: item.errorSummary ?? null,
      retryable: isRetryableItem(item),
      sourceFileAvailable: Boolean(item.filePath && fs.existsSync(item.filePath)),
      lastFailure: item.status === "failed" || item.status === "partial_failed" ? item.errorSummary ?? null : null,
      createdAt: item.createdAt,
      startedAt: item.startedAt ?? null,
      completedAt: item.completedAt ?? null,
      updatedAt: item.updatedAt,
    })),
  };
}

function sanitizeWorkflowFields(fields = {}) {
  return {
    workspaceId: fields.workspaceId ?? null,
    frameSampleRateFps: fields.frameSampleRateFps ?? null,
    enableAudioSeparation: fields.enableAudioSeparation ?? "true",
    enableSubtitleRecognition: fields.enableSubtitleRecognition ?? "true",
    enableAudioFeatureAnalysis: fields.enableAudioFeatureAnalysis ?? "true",
    enableFunctionSlotAtomization: fields.enableFunctionSlotAtomization ?? "true",
    cacheDecision: fields.cacheDecision ?? "ask",
  };
}

module.exports = {
  DEFAULT_MAX_CONCURRENT_RUNS,
  createFullAnalysisBatchQueue,
  normalizeMaxConcurrentRuns,
};
