const fs = require("fs");
const path = require("path");

const THREAD_INPUT_TOKEN_CACHE_TTL_MS = 5000;
const THREAD_CONTEXT_THRESHOLD_RATIO = 0.1;

async function hydrateRoleStatusContext(payload, {
  readThreadImpl,
  codexRolloutReader,
  threadInputTokenCache,
  threadTokenUsageCache,
  threadTokenUsagePath,
  workspaceRoot,
  defaultThreadTokenUsagePath,
}) {
  const threadEntries = Array.isArray(payload?.thread_entries) ? payload.thread_entries : [];
  if (!threadEntries.length) return payload;
  const roleWorkspaceRoot = normalizeOptionalText(payload.workspace_root);
  const role = normalizeOptionalText(payload.role);
  const resolvedThreadTokenUsagePath = resolveThreadTokenUsagePath(threadTokenUsagePath, roleWorkspaceRoot, {
    workspaceRoot,
    defaultThreadTokenUsagePath,
  });
  const enrichedEntries = await Promise.all(threadEntries.map(async (thread) => {
    const threadId = String(thread?.thread_id ?? "").trim();
    if (!threadId) return thread;
    const usage = await readThreadTokenUsageCached({ threadId, threadTokenUsageCache, threadTokenUsagePath: resolvedThreadTokenUsagePath });
    const usageSummary = extractThreadUsageSummary(usage);
    if (thread?.latest_input_tokens == null && usageSummary.latestInputTokens != null) {
      thread = { ...thread, latest_input_tokens: usageSummary.latestInputTokens };
    }
    if (thread?.threshold_input_tokens == null && usageSummary.modelContextWindow != null) {
      const thresholdInputTokens = deriveThreadThresholdInputTokens(usageSummary.modelContextWindow);
      if (thresholdInputTokens != null) {
        thread = { ...thread, threshold_input_tokens: thresholdInputTokens };
      }
    }
    if (thread?.latest_input_tokens != null && thread?.threshold_input_tokens != null) return thread;
    if (typeof readThreadImpl === "function") {
      const threadSummary = await readThreadUsageSummaryCached({ threadId, readThreadImpl, threadInputTokenCache, workspaceRoot: roleWorkspaceRoot, role });
      if (thread?.latest_input_tokens == null && threadSummary.latestInputTokens != null) {
        thread = { ...thread, latest_input_tokens: threadSummary.latestInputTokens };
      }
      if (thread?.threshold_input_tokens == null && threadSummary.modelContextWindow != null) {
        const thresholdInputTokens = deriveThreadThresholdInputTokens(threadSummary.modelContextWindow);
        if (thresholdInputTokens != null) {
          thread = { ...thread, threshold_input_tokens: thresholdInputTokens };
        }
      }
    }
    if (thread?.latest_input_tokens != null && thread?.threshold_input_tokens != null) return thread;
    const rolloutSummary = await readRolloutUsageSummary({ threadId, codexRolloutReader });
    if (thread?.latest_input_tokens == null && rolloutSummary.latestInputTokens != null) {
      thread = { ...thread, latest_input_tokens: rolloutSummary.latestInputTokens };
    }
    if (thread?.threshold_input_tokens == null && rolloutSummary.modelContextWindow != null) {
      const thresholdInputTokens = deriveThreadThresholdInputTokens(rolloutSummary.modelContextWindow);
      if (thresholdInputTokens != null) {
        thread = { ...thread, threshold_input_tokens: thresholdInputTokens };
      }
    }
    return thread;
  }));
  return { ...payload, thread_entries: enrichedEntries };
}

async function readRolloutUsageSummary({ threadId, codexRolloutReader }) {
  if (typeof codexRolloutReader?.readThread !== "function") return { latestInputTokens: null, modelContextWindow: null };
  try {
    const result = await codexRolloutReader.readThread({ threadId });
    return extractThreadUsageSummary(result?.thread);
  } catch {
    return { latestInputTokens: null, modelContextWindow: null };
  }
}

async function readThreadTokenUsageCached({ threadId, threadTokenUsageCache, threadTokenUsagePath }) {
  const now = Date.now();
  const cacheKey = `${threadTokenUsagePath || ""}::${threadId}`;
  const cached = threadTokenUsageCache.get(cacheKey);
  if (cached && now - cached.time < THREAD_INPUT_TOKEN_CACHE_TTL_MS) return cached.value;
  let value = null;
  try {
    const payload = await readJsonFileCached(threadTokenUsagePath);
    const entry = payload?.[threadId];
    if (entry && typeof entry === "object") {
      value = {
        latest: normalizePersistedTokenUsage(entry.latest),
        turns: normalizePersistedTurnUsageMap(entry.turns),
      };
    }
  } catch {
    value = null;
  }
  threadTokenUsageCache.set(cacheKey, { time: now, value });
  return value;
}

async function readThreadUsageSummaryCached({ threadId, readThreadImpl, threadInputTokenCache, workspaceRoot, role }) {
  const now = Date.now();
  const cacheKey = `${workspaceRoot || ""}::${threadId}`;
  const cached = threadInputTokenCache.get(cacheKey);
  if (cached && now - cached.time < THREAD_INPUT_TOKEN_CACHE_TTL_MS) return cached.value;
  let value = null;
  try {
    const result = await readThreadImpl(threadId, { workspaceRoot, role });
    value = extractThreadUsageSummary(result?.thread ?? result);
  } catch {
    value = null;
  }
  threadInputTokenCache.set(cacheKey, { time: now, value });
  return value;
}

function resolveThreadTokenUsagePath(threadTokenUsagePath, workspaceRoot, { workspaceRoot: defaultWorkspaceRoot, defaultThreadTokenUsagePath }) {
  if (typeof threadTokenUsagePath === "function") {
    return threadTokenUsagePath({ workspaceRoot: workspaceRoot || defaultWorkspaceRoot });
  }
  const configuredPath = normalizeOptionalText(threadTokenUsagePath);
  if (configuredPath && path.resolve(configuredPath) !== defaultThreadTokenUsagePath) return configuredPath;
  const root = normalizeOptionalText(workspaceRoot) || defaultWorkspaceRoot;
  return path.join(root, "_workspace", "runtime", "appserver", "thread_token_usage.json");
}

async function readJsonFileCached(filePath) {
  const raw = await fs.promises.readFile(filePath, "utf8");
  return parseJson(raw);
}

function normalizePersistedTurnUsageMap(payload) {
  if (!payload || typeof payload !== "object") return {};
  const result = {};
  for (const [turnId, usage] of Object.entries(payload)) {
    const normalized = normalizePersistedTokenUsage(usage);
    if (normalized) result[turnId] = normalized;
  }
  return result;
}

function normalizePersistedTokenUsage(payload) {
  if (!payload || typeof payload !== "object") return null;
  const last = payload.last_token_usage ?? payload.lastTokenUsage;
  const normalized = normalizeTokenUsage(last);
  const total = payload.total_token_usage ?? payload.totalTokenUsage;
  const normalizedTotal = normalizeTokenUsage(total);
  const modelContextWindow = nullablePositiveNumber(payload.model_context_window ?? payload.modelContextWindow);
  const result = {};
  if (normalized) result.last_token_usage = normalized;
  if (normalizedTotal) result.total_token_usage = normalizedTotal;
  if (modelContextWindow != null) result.model_context_window = modelContextWindow;
  return Object.keys(result).length ? result : null;
}

function extractThreadUsageSummary(payload) {
  const summary = { latestInputTokens: null, modelContextWindow: null };
  if (!payload || typeof payload !== "object") return summary;
  const turns = Array.isArray(payload.turns)
    ? payload.turns
    : payload.turns && typeof payload.turns === "object"
      ? Object.values(payload.turns)
      : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turnSummary = extractTurnUsageSummary(turns[index]);
    if (summary.latestInputTokens == null && turnSummary.latestInputTokens != null) {
      summary.latestInputTokens = turnSummary.latestInputTokens;
    }
    if (summary.modelContextWindow == null && turnSummary.modelContextWindow != null) {
      summary.modelContextWindow = turnSummary.modelContextWindow;
    }
    if (summary.latestInputTokens != null && summary.modelContextWindow != null) {
      return summary;
    }
  }
  const latestSummary = extractTurnUsageSummary(payload.latest);
  if (summary.latestInputTokens == null && latestSummary.latestInputTokens != null) {
    summary.latestInputTokens = latestSummary.latestInputTokens;
  }
  if (summary.modelContextWindow == null && latestSummary.modelContextWindow != null) {
    summary.modelContextWindow = latestSummary.modelContextWindow;
  }
  return summary;
}

function extractTurnUsageSummary(turn) {
  const summary = { latestInputTokens: null, modelContextWindow: null };
  if (!turn || typeof turn !== "object") return summary;
  const usage = normalizeTokenUsage(turn.last_token_usage ?? turn.lastTokenUsage ?? turn.token_usage ?? turn.tokenUsage);
  if (usage?.input_tokens != null) {
    summary.latestInputTokens = nullableNumber(usage.input_tokens);
  }
  const modelContextWindow = nullablePositiveNumber(turn.model_context_window ?? turn.modelContextWindow);
  if (modelContextWindow != null) {
    summary.modelContextWindow = modelContextWindow;
  }
  return summary;
}

function deriveThreadThresholdInputTokens(modelContextWindow) {
  const window = nullableNumber(modelContextWindow);
  if (window == null || window <= 0) return null;
  return Math.round(window * THREAD_CONTEXT_THRESHOLD_RATIO);
}

function sanitizeHealth(payload, allowedRoleSet) {
  if (!payload?.ok) return payload;
  return {
    ...payload,
    roles: Array.isArray(payload.roles) ? payload.roles.filter((role) => allowedRoleSet.has(String(role))) : [],
    warming_roles: Array.isArray(payload.warming_roles) ? payload.warming_roles.filter((role) => allowedRoleSet.has(String(role))) : [],
  };
}

function sanitizeConfig(payload) {
  if (!payload?.ok) return payload;
  return {
    ok: true,
    configPath: payload.config_path ? basename(payload.config_path) : null,
    discardOnRelease: Boolean(payload.discard_on_release),
    reportedAt: payload.reported_at ?? null,
  };
}

function sanitizeRoleStatus(payload) {
  const threads = (payload.thread_entries ?? []).map((thread) => ({
    thread_id: String(thread.thread_id ?? ""),
    role: payload.role,
    status: normalizeThreadStatus(thread.thread_status),
    lease_id: thread.lease_id ?? null,
    owner_id: thread.owner_id ?? null,
    last_owner_id: thread.last_owner_id ?? null,
    latest_input_tokens: nullableNumber(thread.latest_input_tokens),
    threshold_input_tokens: nullableNumber(thread.threshold_input_tokens),
    seed: Boolean(thread.is_seed),
    last_seen_at: thread.last_seen_at ?? null,
  }));
  const leases = (payload.active_leases ?? []).map((lease) => ({
    lease_id: String(lease.lease_id ?? ""),
    thread_id: String(lease.thread_id ?? ""),
    owner_id: String(lease.owner_id ?? ""),
    status: "active",
    thread_status: normalizeThreadStatus(lease.thread_status),
    last_seen_at: lease.last_seen_at ?? null,
  }));
  const counts = normalizeCounts(payload.counts);
  const minIdle = Number(payload.min_idle ?? payload.counts?.min_idle ?? 0);
  const readyForLeases = Boolean(payload.ready_for_leases);
  const canAcquire = Boolean(payload.can_acquire);
  const hasStartupError = Boolean(payload.startup_error);
  const hasWarmupError = Boolean(payload.warmup_error);
  const seedMissing = Boolean(
    readyForLeases
    && !hasStartupError
    && !hasWarmupError
    && minIdle > 0
    && !payload.seed_thread_id
    && counts.idle < minIdle,
  );
  const warming = Boolean(payload.warming) || seedMissing;
  const replenishing = Boolean(payload.replenishing);
  return {
    ok: true,
    role: payload.role,
    config: {
      min_idle: payload.min_idle ?? 0,
      profile_path: payload.profile_path ? basename(payload.profile_path) : null,
      profile_version: payload.profile_version ?? null,
      workspace_root: payload.workspace_root ?? null,
      skill_path: payload.skill_path ? basename(payload.skill_path) : null,
      init_fingerprint: payload.current_init_fingerprint ?? null,
    },
    counts,
    minIdle,
    seedThreadId: payload.seed_thread_id ?? null,
    profilePath: payload.profile_path ?? null,
    profileVersion: payload.profile_version ?? null,
    workspaceRoot: payload.workspace_root ?? null,
    skillPath: payload.skill_path ?? null,
    canAcquire,
    canInit: "can_init" in payload ? Boolean(payload.can_init) : canAcquire,
    warming,
    replenishing,
    seedMissing,
    warmupDetail: payload.warmup_detail ?? (seedMissing ? "waiting for seed initialization" : null),
    warmupError: payload.warmup_error ?? null,
    readyForLeases,
    recovering: Boolean(payload.recovering),
    startupError: payload.startup_error ?? null,
    startupThreadAlive: Boolean(payload.startup_thread_alive),
    startupElapsedMs: nullableNumber(payload.startup_elapsed_ms),
    startupStalled: Boolean(payload.startup_stalled),
    threads,
    leases,
    reportedAt: payload.reported_at ?? null,
  };
}

function summarizeRoleStatus(status) {
  if (!status?.ok) return null;
  return {
    role: status.role,
    minIdle: status.minIdle,
    idle: status.counts.idle,
    leased: status.counts.leased,
    seedThreadId: status.seedThreadId,
    canAcquire: status.canAcquire,
    readyForLeases: status.readyForLeases,
    recovering: status.recovering,
    warming: status.warming,
    replenishing: status.replenishing,
    seedMissing: status.seedMissing,
    skillPath: status.skillPath,
  };
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = nullableNumber(usage.input_tokens ?? usage.inputTokens);
  if (inputTokens == null) return null;
  const result = { input_tokens: inputTokens };
  const cachedInputTokens = nullableNumber(usage.cached_input_tokens ?? usage.cachedInputTokens);
  if (cachedInputTokens != null) result.cached_input_tokens = cachedInputTokens;
  const outputTokens = nullableNumber(usage.output_tokens ?? usage.outputTokens);
  if (outputTokens != null) result.output_tokens = outputTokens;
  const reasoningOutputTokens = nullableNumber(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens);
  if (reasoningOutputTokens != null) result.reasoning_output_tokens = reasoningOutputTokens;
  const totalTokens = nullableNumber(usage.total_tokens ?? usage.totalTokens);
  if (totalTokens != null) result.total_tokens = totalTokens;
  return result;
}

function normalizeCounts(counts) {
  return {
    idle: Number(counts?.idle ?? 0),
    leased: Number(counts?.leased ?? 0),
    retired: Number(counts?.retired ?? 0),
    discarded: Number(counts?.discarded ?? 0),
    initializing: Number(counts?.initializing ?? 0),
    activeLeases: Number(counts?.active_leases ?? 0),
  };
}

function normalizeThreadStatus(value) {
  const status = String(value || "idle");
  return ["idle", "leased", "retired", "discarded", "initializing"].includes(status) ? status : "idle";
}

function readinessBlockedReason(status) {
  if (status.startupError) return String(status.startupError).slice(0, 240);
  if (status.warmupError) return String(status.warmupError).slice(0, 240);
  return null;
}

function summarizeReadinessDetail(status) {
  return {
    role: status.role,
    readyForLeases: Boolean(status.readyForLeases),
    canAcquire: Boolean(status.canAcquire),
    recovering: Boolean(status.recovering),
    warming: Boolean(status.warming),
    seedMissing: Boolean(status.seedMissing),
    warmupDetail: status.warmupDetail ?? null,
    warmupError: status.warmupError ?? null,
    startupError: status.startupError ?? null,
  };
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullablePositiveNumber(value) {
  const number = nullableNumber(value);
  return number != null && number > 0 ? number : null;
}

function normalizeOptionalText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { invalidJson: true, raw: String(text).slice(0, 500) };
  }
}

function basename(value) {
  return String(value).split(/[\\/]/).at(-1) ?? String(value);
}

module.exports = {
  hydrateRoleStatusContext,
  parseJson,
  readinessBlockedReason,
  sanitizeConfig,
  sanitizeHealth,
  sanitizeRoleStatus,
  summarizeReadinessDetail,
  summarizeRoleStatus,
};
