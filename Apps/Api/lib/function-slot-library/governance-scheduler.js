const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const SCHEMA_VERSION = "function_slot_governance_scheduler.v1";
const DEFAULT_QUIET_WINDOW_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const ACTIVE_ITEM_STATUSES = new Set(["queued", "running", "cache_waiting"]);
const SLOT_INDEX_RELATIVE_PATH = path.join("Runtime", "Temp", "FunctionSlotLibrary", "slot_index.json");

function createSemanticGovernanceScheduler({
  rootDir,
  runtimeRoot,
  governanceService,
  builderService,
  jobStore,
  loadSampleArtifact,
  quietWindowMs = DEFAULT_QUIET_WINDOW_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  filePath = runtimeRoot ? path.join(runtimeRoot, "WorkflowRuns", "semantic-governance-scheduler-state.json") : null,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  now = () => new Date(),
} = {}) {
  if (!rootDir) throw new Error("rootDir is required for semantic governance scheduler");
  if (!governanceService?.enqueue) throw new Error("governanceService.enqueue is required for semantic governance scheduler");

  let timer = null;
  let running = false;
  let latestBatches = [];
  let state = normalizeState(loadState(filePath), { quietWindowMs, now, resetActive: true });
  persistState();

  function getState() {
    return publicState(state);
  }

  function handleQueueChanged(_batch, context = {}) {
    const batches = Array.isArray(context.batches) ? context.batches : [];
    latestBatches = batches;
    const active = hasActiveStructureBatch(batches);
    const reason = context.reason ?? "queue_changed";

    if (active) {
      clearScheduledTimer();
      if (running) {
        markDirty("结构分析队列又有新任务，当前语义治理完成后会重新检查。");
        return getState();
      }
      updateState({
        status: "idle",
        scheduledAt: null,
        pendingReason: reason,
        pendingBatchRunIds: [],
        pendingSampleVideoIds: [],
        message: "等待结构分析队列完成后自动语义治理。",
      });
      return getState();
    }

    const pendingSampleVideoIds = processedStructureSampleIds(batches);
    if (!pendingSampleVideoIds.length) {
      clearScheduledTimer();
      if (running) {
        markDirty("结构分析队列已变化，当前语义治理完成后会重新检查。");
        return getState();
      }
      updateState({
        status: "skipped",
        scheduledAt: null,
        pendingReason: reason,
        pendingBatchRunIds: [],
        pendingSampleVideoIds: [],
        message: "结构分析队列已结束，但没有可纳入语义治理的成功样例。",
      });
      return getState();
    }

    if (running) {
      markDirty("新结构分析结果已完成，当前语义治理完成后会补跑。", pendingSampleVideoIds);
      return getState();
    }

    scheduleGovernance({ reason: "full_analysis_queue_idle", batches, pendingSampleVideoIds });
    return getState();
  }

  function scheduleGovernance({ reason, batches, pendingSampleVideoIds }) {
    clearScheduledTimer();
    const scheduledAt = new Date(now().getTime() + quietWindowMs).toISOString();
    updateState({
      status: "scheduled",
      scheduledAt,
      processingJobId: null,
      traceId: null,
      pendingReason: reason,
      pendingBatchRunIds: structureBatchIds(batches),
      pendingSampleVideoIds,
      dirtySince: null,
      message: "结构分析队列已完成，等待自动语义治理。",
    });
    timer = setTimeoutImpl(() => {
      timer = null;
      runScheduledGovernance(reason).catch((error) => markFailed(error));
    }, quietWindowMs);
    if (typeof timer?.unref === "function") timer.unref();
  }

  async function runScheduledGovernance(reason) {
    if (running) {
      markDirty("语义治理正在运行，本次请求会在当前任务后重新检查。");
      return;
    }
    running = true;
    updateState({
      status: "running",
      scheduledAt: null,
      processingJobId: null,
      traceId: null,
      message: "正在准备 FunctionSlotLibrary 证据并启动语义治理。",
    });

    try {
      const sampleIds = state.pendingSampleVideoIds ?? [];
      const hasAtomizationEvidence = await hasFunctionSlotAtomizationEvidence(sampleIds);
      if (!hasAtomizationEvidence) {
        running = false;
        updateState({
          status: "skipped",
          message: "没有新的功能槽位原子化结果可纳入语义治理。",
          lastRunCompletedAt: now().toISOString(),
        });
        return;
      }

      if (builderService?.refresh) {
        await builderService.refresh({ mode: "skip-existing", updateGovernance: false });
      }
      const evidenceHash = await readEvidenceHash();
      updateState({ lastEvidenceHash: evidenceHash });
      if (!evidenceHash) {
        running = false;
        updateState({
          status: "skipped",
          message: "没有生成可治理的 FunctionSlotLibrary 证据索引。",
          lastRunCompletedAt: now().toISOString(),
        });
        return;
      }
      if (evidenceHash === state.lastGovernedEvidenceHash) {
        running = false;
        updateState({
          status: "skipped",
          message: "FunctionSlotLibrary 证据未变化，已跳过自动语义治理。",
          lastRunCompletedAt: now().toISOString(),
        });
        return;
      }

      const started = await governanceService.enqueue({
        refreshEvidence: true,
        triggerReason: reason,
        evidenceHash,
      });
      updateState({
        status: state.dirtySince ? "dirty" : "running",
        processingJobId: started.processingJobId ?? null,
        traceId: started.traceId ?? null,
        message: state.dirtySince ? "语义治理运行中，已有新样例等待补跑。" : "语义治理运行中。",
      });
      monitorGovernanceJob(started.processingJobId, evidenceHash).catch((error) => markFailed(error));
    } catch (error) {
      running = false;
      markFailed(error);
    }
  }

  async function monitorGovernanceJob(processingJobId, evidenceHash) {
    if (!processingJobId || !jobStore?.getJob) return;
    while (running) {
      const job = jobStore.getJob(processingJobId);
      if (isJobProcessed(job)) {
        running = false;
        const shouldRerun = Boolean(state.dirtySince);
        updateState({
          status: "idle",
          lastGovernedEvidenceHash: evidenceHash,
          lastRunCompletedAt: now().toISOString(),
          dirtySince: null,
          message: "自动语义治理已完成。",
        });
        if (shouldRerun) requestDirtyRerun();
        return;
      }
      if (isJobFailed(job)) {
        running = false;
        markFailed(job?.errorSummary ?? new Error("semantic governance job failed"));
        return;
      }
      await sleep(pollIntervalMs);
    }
  }

  function requestDirtyRerun() {
    if (hasActiveStructureBatch(latestBatches)) {
      updateState({
        status: "dirty",
        message: "语义治理已完成，但结构分析队列仍有新任务，等待队列完成后补跑。",
      });
      return;
    }
    const sampleIds = processedStructureSampleIds(latestBatches);
    if (!sampleIds.length) return;
    scheduleGovernance({
      reason: "full_analysis_queue_dirty_after_governance",
      batches: latestBatches,
      pendingSampleVideoIds: sampleIds,
    });
  }

  function markDirty(message, pendingSampleVideoIds = []) {
    updateState({
      status: "dirty",
      dirtySince: state.dirtySince ?? now().toISOString(),
      pendingSampleVideoIds: mergeUnique(state.pendingSampleVideoIds, pendingSampleVideoIds),
      message,
    });
  }

  function markFailed(error) {
    clearScheduledTimer();
    updateState({
      status: "failed",
      scheduledAt: null,
      message: safeErrorMessage(error),
      lastRunCompletedAt: now().toISOString(),
    });
  }

  async function hasFunctionSlotAtomizationEvidence(sampleVideoIds) {
    if (!sampleVideoIds.length) return false;
    if (!loadSampleArtifact) return true;
    for (const sampleVideoId of sampleVideoIds) {
      const artifact = await loadSampleArtifact({ sampleVideoId }).catch(() => null);
      if (artifact?.functionSlotAtomizationAnalysis) return true;
    }
    return false;
  }

  async function readEvidenceHash() {
    const indexPath = path.join(rootDir, SLOT_INDEX_RELATIVE_PATH);
    const content = await fsp.readFile(indexPath).catch(() => null);
    if (!content) return null;
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  function updateState(patch) {
    state = normalizeState({ ...state, ...patch }, { quietWindowMs, now, resetActive: false });
    persistState();
  }

  function persistState() {
    if (!filePath) return;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(publicState(state), null, 2)}\n`, "utf8");
    } catch {
      // Scheduler state is observability-only; do not fail queue processing on write errors.
    }
  }

  function clearScheduledTimer() {
    if (!timer) return;
    clearTimeoutImpl(timer);
    timer = null;
  }

  function dispose() {
    clearScheduledTimer();
    running = false;
  }

  return {
    getState,
    handleQueueChanged,
    dispose,
  };
}

function loadState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeState(value, { quietWindowMs, now, resetActive = false }) {
  const status = ["idle", "scheduled", "running", "dirty", "skipped", "failed"].includes(value?.status)
    ? value.status
    : "idle";
  const staleActiveStatus = resetActive && (status === "scheduled" || status === "running" || status === "dirty");
  return {
    schemaVersion: SCHEMA_VERSION,
    status: staleActiveStatus ? "idle" : status,
    quietWindowMs,
    scheduledAt: staleActiveStatus ? null : value?.scheduledAt ?? null,
    processingJobId: staleActiveStatus ? null : value?.processingJobId ?? null,
    traceId: staleActiveStatus ? null : value?.traceId ?? null,
    lastEvidenceHash: value?.lastEvidenceHash ?? null,
    lastGovernedEvidenceHash: value?.lastGovernedEvidenceHash ?? null,
    dirtySince: staleActiveStatus ? null : value?.dirtySince ?? null,
    lastRunCompletedAt: value?.lastRunCompletedAt ?? null,
    pendingReason: value?.pendingReason ?? null,
    pendingBatchRunIds: Array.isArray(value?.pendingBatchRunIds) ? value.pendingBatchRunIds : [],
    pendingSampleVideoIds: Array.isArray(value?.pendingSampleVideoIds) ? value.pendingSampleVideoIds : [],
    message: staleActiveStatus ? "等待结构分析队列状态刷新后恢复自动语义治理。" : value?.message ?? "等待结构分析队列完成。",
    updatedAt: now().toISOString(),
  };
}

function publicState(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    status: state.status,
    quietWindowMs: state.quietWindowMs,
    scheduledAt: state.scheduledAt ?? null,
    processingJobId: state.processingJobId ?? null,
    traceId: state.traceId ?? null,
    lastEvidenceHash: state.lastEvidenceHash ?? null,
    lastGovernedEvidenceHash: state.lastGovernedEvidenceHash ?? null,
    dirtySince: state.dirtySince ?? null,
    lastRunCompletedAt: state.lastRunCompletedAt ?? null,
    message: state.message ?? null,
  };
}

function hasActiveStructureBatch(batches) {
  return batches.some((batch) => batch?.workflowKey === "full-analysis" && batch.items?.some((item) => ACTIVE_ITEM_STATUSES.has(item.status)));
}

function processedStructureSampleIds(batches) {
  return mergeUnique([], batches.flatMap((batch) => (
    batch?.workflowKey === "full-analysis"
      ? (batch.items ?? []).filter((item) => item.status === "processed" && item.sampleVideoId).map((item) => item.sampleVideoId)
      : []
  )));
}

function structureBatchIds(batches) {
  return mergeUnique([], batches.filter((batch) => batch?.workflowKey === "full-analysis").map((batch) => batch.batchRunId));
}

function mergeUnique(base = [], additions = []) {
  return [...new Set([...(base ?? []), ...(additions ?? [])].filter(Boolean))];
}

function isJobProcessed(job) {
  return ["processed", "completed", "complete"].includes(String(job?.status ?? "").toLowerCase());
}

function isJobFailed(job) {
  return ["failed", "canceled", "cancelled"].includes(String(job?.status ?? "").toLowerCase());
}

function safeErrorMessage(error) {
  if (typeof error?.message === "string" && error.message.trim()) return error.message;
  if (typeof error?.code === "string" && error.code.trim()) return `语义治理失败：${error.code}`;
  return "自动语义治理失败。";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  SCHEMA_VERSION,
  createSemanticGovernanceScheduler,
};
