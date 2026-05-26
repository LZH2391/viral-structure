const fs = require("fs");
const path = require("path");

const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..", "..");
const THREADPOOL_ROLE_CONFIG_PATH = path.join(WORKSPACE_ROOT, "Infrastructure", "ThreadPool", "thread_roles.json");
const THREAD_TOKEN_USAGE_PATH = path.join(WORKSPACE_ROOT, "_workspace", "runtime", "appserver", "thread_token_usage.json");
const DEFAULT_THREADPOOL_URL = "http://127.0.0.1:8877";
const DEFAULT_ALLOWED_ROLES = loadAllowedRolesFromConfig();
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const DEFAULT_LEASE_ACQUIRE_TIMEOUT_MS = 120000;
const THREAD_INPUT_TOKEN_CACHE_TTL_MS = 5000;
const THREAD_CONTEXT_THRESHOLD_RATIO = 0.8;

function createThreadPoolProxy({
  baseUrl = process.env.THREADPOOL_BASE_URL || DEFAULT_THREADPOOL_URL,
  fetchImpl = fetch,
  allowedRoles = parseAllowedRoles(process.env.THREADPOOL_ALLOWED_ROLES),
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  leaseAcquireTimeoutMs = DEFAULT_LEASE_ACQUIRE_TIMEOUT_MS,
  readThreadImpl = null,
  threadTokenUsagePath = THREAD_TOKEN_USAGE_PATH,
} = {}) {
  const normalizedBaseUrl = String(baseUrl || DEFAULT_THREADPOOL_URL).replace(/\/+$/, "");
  const allowedRoleSet = new Set((allowedRoles?.length ? allowedRoles : DEFAULT_ALLOWED_ROLES).map(String));
  const threadInputTokenCache = new Map();
  const threadTokenUsageCache = new Map();

  async function health() {
    return sanitizeHealth(await safeRequest("GET", "/health"), allowedRoleSet);
  }

  async function config() {
    const payload = await safeRequest("GET", "/config");
    return sanitizeConfig(payload);
  }

  async function roles() {
    const healthPayload = await health();
    if (!healthPayload.ok) return { ok: false, unavailable: true, roles: [], health: healthPayload };
    const roleNames = Array.isArray(healthPayload.roles) ? healthPayload.roles.filter((role) => allowedRoleSet.has(String(role))) : [];
    const roleStatuses = await Promise.all(roleNames.map((role) => roleStatus(role)));
    return {
      ok: true,
      unavailable: false,
      health: healthPayload,
      roles: roleStatuses.map((status) => summarizeRoleStatus(status)).filter(Boolean),
    };
  }

  async function roleStatus(role) {
    if (!isAllowedRole(role)) return disallowedRolePayload(role);
    const payload = await safeRequest("GET", `/roles/${encodeURIComponent(role)}/status`);
    if (!payload.ok) return payload;
    return sanitizeRoleStatus(await hydrateRoleStatusContext(payload, { readThreadImpl, threadInputTokenCache, threadTokenUsageCache, threadTokenUsagePath }));
  }

  async function acquireLease({ role, ownerId }) {
    assertAllowedRole(role);
    return requestJson("POST", "/leases/acquire", { role, owner_id: ownerId }, {
      requestTimeoutMs: leaseAcquireTimeoutMs,
    });
  }

  async function releaseLease({ leaseId, ownerId }) {
    return requestJson("POST", `/leases/${encodeURIComponent(leaseId)}/release`, { owner_id: ownerId });
  }

  async function releaseOwnerLeases(ownerId) {
    return requestJson("POST", "/leases/release-owner", { owner_id: ownerId });
  }

  async function discardThread({ threadId, reason }) {
    const association = await findAllowedThread(threadId);
    if (!association.ok) return association;
    return requestJson("POST", `/threads/${encodeURIComponent(threadId)}/discard`, { reason });
  }

  async function ensureRoleReady(role) {
    assertAllowedRole(role);
    const status = await roleStatus(role);
    if (!status?.ok) return status;
    if (status.warming) {
      return {
        ok: false,
        unavailable: false,
        error: "threadpool_warming",
        message: "ThreadPool 正在 warming，请稍后再试",
        role: status.role,
        retryable: true,
        detail: summarizeReadinessDetail(status),
      };
    }
    const blockedReason = readinessBlockedReason(status);
    if (blockedReason) {
      return {
        ok: false,
        unavailable: false,
        error: "threadpool_acquire_failed",
        message: blockedReason,
        role: status.role,
        retryable: true,
        detail: summarizeReadinessDetail(status),
      };
    }
    return { ok: true, role: status.role, status };
  }

  async function findAllowedThread(threadId) {
    const target = String(threadId || "");
    if (!target) return disallowedThreadPayload(target);
    const statuses = await Promise.all(Array.from(allowedRoleSet).map((role) => roleStatus(role)));
    const match = statuses.find((status) => status?.ok && (status.threads ?? []).some((thread) => thread.thread_id === target));
    return match ? { ok: true, role: match.role, thread_id: target } : disallowedThreadPayload(target);
  }

  function isAllowedRole(role) {
    return allowedRoleSet.has(String(role || ""));
  }

  function assertAllowedRole(role) {
    if (isAllowedRole(role)) return;
    const error = new Error("ThreadPool role 不属于当前工作区");
    error.statusCode = 403;
    error.payload = disallowedRolePayload(role);
    throw error;
  }

  async function safeRequest(method, pathname, body) {
    try {
      return await requestJson(method, pathname, body);
    } catch (error) {
      return unavailablePayload(error);
    }
  }

  async function requestJson(method, pathname, body, options = {}) {
    const resolvedRequestTimeoutMs = Number.isFinite(options.requestTimeoutMs) ? Number(options.requestTimeoutMs) : requestTimeoutMs;
    const request = { method, pathname, requestTimeoutMs: resolvedRequestTimeoutMs };
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort("threadpool-timeout"), resolvedRequestTimeoutMs) : null;
    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${pathname}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
      });
    } catch (error) {
      throw decorateRequestError(error, request);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await response.text();
    const payload = text ? parseJson(text) : {};
    if (!response.ok) {
      const error = new Error(safeErrorMessage(payload, response.status));
      error.statusCode = response.status;
      error.payload = payload;
      error.request = request;
      throw error;
    }
    return payload;
  }

  return {
    baseUrl: normalizedBaseUrl,
    allowedRoles: Array.from(allowedRoleSet),
    requestTimeoutMs,
    leaseAcquireTimeoutMs,
    health,
    config,
    roles,
    roleStatus,
    ensureRoleReady,
    acquireLease,
    releaseLease,
    releaseOwnerLeases,
    discardThread,
    findAllowedThread,
  };
}

function parseAllowedRoles(value) {
  if (!value) return DEFAULT_ALLOWED_ROLES;
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

async function hydrateRoleStatusContext(payload, { readThreadImpl, threadInputTokenCache, threadTokenUsageCache, threadTokenUsagePath }) {
  const threadEntries = Array.isArray(payload?.thread_entries) ? payload.thread_entries : [];
  if (!threadEntries.length) return payload;
  const enrichedEntries = await Promise.all(threadEntries.map(async (thread) => {
    const threadId = String(thread?.thread_id ?? "").trim();
    if (!threadId) return thread;
    const usage = await readThreadTokenUsageCached({ threadId, threadTokenUsageCache, threadTokenUsagePath });
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
    if (typeof readThreadImpl !== "function") return thread;
    const threadSummary = await readThreadUsageSummaryCached({ threadId, readThreadImpl, threadInputTokenCache });
    if (thread?.latest_input_tokens == null && threadSummary.latestInputTokens != null) {
      thread = { ...thread, latest_input_tokens: threadSummary.latestInputTokens };
    }
    if (thread?.threshold_input_tokens == null && threadSummary.modelContextWindow != null) {
      const thresholdInputTokens = deriveThreadThresholdInputTokens(threadSummary.modelContextWindow);
      if (thresholdInputTokens != null) {
        thread = { ...thread, threshold_input_tokens: thresholdInputTokens };
      }
    }
    return thread;
  }));
  return { ...payload, thread_entries: enrichedEntries };
}

async function readThreadTokenUsageCached({ threadId, threadTokenUsageCache, threadTokenUsagePath }) {
  const now = Date.now();
  const cached = threadTokenUsageCache.get(threadId);
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
  threadTokenUsageCache.set(threadId, { time: now, value });
  return value;
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
  const modelContextWindow = nullableNumber(payload.model_context_window ?? payload.modelContextWindow);
  const result = {};
  if (normalized) result.last_token_usage = normalized;
  if (normalizedTotal) result.total_token_usage = normalizedTotal;
  if (modelContextWindow != null) result.model_context_window = modelContextWindow;
  return Object.keys(result).length ? result : null;
}

async function readThreadUsageSummaryCached({ threadId, readThreadImpl, threadInputTokenCache }) {
  const now = Date.now();
  const cached = threadInputTokenCache.get(threadId);
  if (cached && now - cached.time < THREAD_INPUT_TOKEN_CACHE_TTL_MS) return cached.value;
  let value = null;
  try {
    const result = await readThreadImpl(threadId);
    value = extractThreadUsageSummary(result?.thread ?? result);
  } catch {
    value = null;
  }
  threadInputTokenCache.set(threadId, { time: now, value });
  return value;
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
  const modelContextWindow = nullableNumber(turn.model_context_window ?? turn.modelContextWindow);
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

function loadAllowedRolesFromConfig() {
  try {
    const raw = fs.readFileSync(THREADPOOL_ROLE_CONFIG_PATH, "utf8");
    const config = JSON.parse(raw);
    const roles = Object.keys(config?.roles ?? {}).map(String).filter(Boolean);
    return roles.length ? roles : ["shot-boundary-transformer", "script-segment-analyzer", "rhythm-structure-analyzer"];
  } catch {
    return ["shot-boundary-transformer", "script-segment-analyzer", "rhythm-structure-analyzer"];
  }
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
  return {
    ok: true,
    role: payload.role,
    config: {
      min_idle: payload.min_idle ?? 0,
      profile_path: payload.profile_path ? basename(payload.profile_path) : null,
      profile_version: payload.profile_version ?? null,
      skill_path: payload.skill_path ? basename(payload.skill_path) : null,
      init_fingerprint: payload.current_init_fingerprint ?? null,
    },
    counts: normalizeCounts(payload.counts),
    minIdle: Number(payload.min_idle ?? payload.counts?.min_idle ?? 0),
    seedThreadId: payload.seed_thread_id ?? null,
    profilePath: payload.profile_path ?? null,
    profileVersion: payload.profile_version ?? null,
    skillPath: payload.skill_path ?? null,
    canAcquire: Boolean(payload.can_acquire),
    canInit: "can_init" in payload ? Boolean(payload.can_init) : Boolean(payload.can_acquire),
    warming: Boolean(payload.warming),
    replenishing: Boolean(payload.replenishing),
    warmupDetail: payload.warmup_detail ?? null,
    warmupError: payload.warmup_error ?? null,
    readyForLeases: Boolean(payload.ready_for_leases),
    recovering: Boolean(payload.recovering),
    startupError: payload.startup_error ?? null,
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
    warming: status.warming,
    replenishing: status.replenishing,
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

function unavailablePayload(error) {
  return {
    ok: false,
    unavailable: true,
    error: error?.code === "threadpool_timeout" ? "threadpool_unavailable" : "threadpool_unavailable",
    message: error instanceof Error ? error.message : "ThreadPool 不可用",
    request: error?.request ?? null,
  };
}

function readinessBlockedReason(status) {
  if (status.startupError) return String(status.startupError).slice(0, 240);
  if (status.warmupError) return String(status.warmupError).slice(0, 240);
  if (!status.readyForLeases) return "ThreadPool 当前未 ready，请稍后再试";
  return null;
}

function summarizeReadinessDetail(status) {
  return {
    role: status.role,
    readyForLeases: Boolean(status.readyForLeases),
    canAcquire: Boolean(status.canAcquire),
    warming: Boolean(status.warming),
    warmupDetail: status.warmupDetail ?? null,
    warmupError: status.warmupError ?? null,
    startupError: status.startupError ?? null,
  };
}

function disallowedRolePayload(role) {
  return {
    ok: false,
    unavailable: false,
    error: "threadpool_role_not_allowed",
    message: "ThreadPool role 不属于当前工作区",
    role: String(role || ""),
  };
}

function disallowedThreadPayload(threadId) {
  return {
    ok: false,
    unavailable: false,
    error: "threadpool_thread_not_allowed",
    message: "ThreadPool thread 不属于当前工作区 role",
    thread_id: String(threadId || ""),
  };
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: String(text).slice(0, 500) };
  }
}

function safeErrorMessage(payload, status) {
  return String(payload?.detail || payload?.message || payload?.error || `ThreadPool request failed: ${status}`).slice(0, 240);
}

function basename(value) {
  return String(value).split(/[\\/]/).at(-1) ?? String(value);
}

function decorateRequestError(error, request) {
  if (error?.name === "AbortError" || error === "threadpool-timeout") {
    const timeoutError = new Error("ThreadPool 请求超时，请稍后再试");
    timeoutError.code = "threadpool_timeout";
    timeoutError.request = request ?? null;
    return timeoutError;
  }
  if (error instanceof Error) {
    error.code = error.code ?? "threadpool_request_failed";
    error.request = error.request ?? request ?? null;
    return error;
  }
  const unknown = new Error("ThreadPool 请求失败");
  unknown.code = "threadpool_request_failed";
  unknown.request = request ?? null;
  return unknown;
}

module.exports = {
  THREADPOOL_ROLE_CONFIG_PATH,
  DEFAULT_THREADPOOL_URL,
  DEFAULT_ALLOWED_ROLES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_LEASE_ACQUIRE_TIMEOUT_MS,
  createThreadPoolProxy,
  sanitizeRoleStatus,
  summarizeRoleStatus,
};
