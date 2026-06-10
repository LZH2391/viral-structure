const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_CONCURRENT_RUNS = 2;
const DEFAULT_TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TERMINAL_RETENTION_LIMIT = 20;
const TERMINAL_WORKFLOW_STATUSES = new Set(["processed", "partial_failed", "failed", "canceled"]);

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

function persistQueueState(filePath, state, options = {}) {
  if (!filePath) return;
  pruneTerminalBatches(state, options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ batches: state.batches }, null, 2), "utf8");
}

function pruneTerminalBatches(state, { terminalRetentionMs = DEFAULT_TERMINAL_RETENTION_MS, terminalRetentionLimit = DEFAULT_TERMINAL_RETENTION_LIMIT } = {}) {
  const now = Date.now();
  const retentionMs = Math.max(0, Number(terminalRetentionMs) || 0);
  const retentionLimit = Math.max(0, Number(terminalRetentionLimit) || 0);
  const active = [];
  const terminal = [];
  for (const batch of state.batches ?? []) {
    if (isBatchTerminal(batch)) terminal.push(batch);
    else active.push(batch);
  }
  const keptTerminal = terminal
    .filter((batch) => {
      const completedAt = Date.parse(batch.completedAt ?? batch.updatedAt ?? "");
      return retentionMs <= 0 || (Number.isFinite(completedAt) && now - completedAt <= retentionMs);
    })
    .sort((a, b) => batchTime(b) - batchTime(a))
    .slice(0, retentionLimit);
  const keptIds = new Set(keptTerminal.map((batch) => batch.batchRunId));
  for (const batch of terminal) {
    if (!keptIds.has(batch.batchRunId)) cleanupBatchQueuedFiles(batch);
  }
  state.batches = [...active, ...keptTerminal].sort((a, b) => batchTime(a) - batchTime(b));
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

function cleanupBatchQueuedFiles(batch) {
  for (const item of batch?.items ?? []) cleanupQueuedFile(item);
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

function isBatchTerminal(batch) {
  return batch?.items?.length && batch.items.every((item) => TERMINAL_WORKFLOW_STATUSES.has(item?.status));
}

function batchTime(batch) {
  return Date.parse(batch?.updatedAt ?? batch?.createdAt ?? "") || 0;
}

module.exports = {
  cleanupBatchQueuedFiles,
  cleanupQueuedFile,
  loadQueueState,
  persistQueueState,
  persistQueuedFile,
  readQueuedFile,
  restoreQueuedFiles,
};
