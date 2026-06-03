const fs = require("fs");
const path = require("path");

const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const THREADPOOL_ROLE_CONFIG_PATH = path.join(WORKSPACE_ROOT, "Infrastructure", "ThreadPool", "thread_roles.json");
const THREAD_TOKEN_USAGE_PATH = path.join(WORKSPACE_ROOT, "_workspace", "runtime", "appserver", "thread_token_usage.json");
const DEFAULT_THREADPOOL_URL = "http://127.0.0.1:8877";
const DEFAULT_ALLOWED_ROLES = loadAllowedRolesFromConfig();
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const DEFAULT_LEASE_ACQUIRE_TIMEOUT_MS = 120000;
const {
  hydrateRoleStatusContext,
  parseJson,
  readinessBlockedReason,
  sanitizeConfig,
  sanitizeHealth,
  sanitizeRoleStatus,
  summarizeReadinessDetail,
  summarizeRoleStatus,
} = require("./status-projection");

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
    return sanitizeRoleStatus(await hydrateRoleStatusContext(payload, {
      readThreadImpl,
      threadInputTokenCache,
      threadTokenUsageCache,
      threadTokenUsagePath,
      workspaceRoot: WORKSPACE_ROOT,
      defaultThreadTokenUsagePath: THREAD_TOKEN_USAGE_PATH,
    }));
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
    return requestJson("POST", `/threads/${encodeURIComponent(association.thread_id)}/discard`, { reason });
  }

  async function forceUpdateSeeds({ reason, roles } = {}) {
    const requestedRoles = Array.isArray(roles) && roles.length
      ? roles.map(String).filter((role) => allowedRoleSet.has(role))
      : Array.from(allowedRoleSet);
    if (!requestedRoles.length) return disallowedRolePayload("");
    return requestJson("POST", "/maintenance/force-update-seeds", {
      reason: reason || "manual-force-update-seeds-from-workbench",
      roles: requestedRoles,
    });
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
    if (status.recovering || !status.readyForLeases) {
      return {
        ok: false,
        unavailable: false,
        error: "threadpool_warming",
        message: status.recovering ? "ThreadPool 正在恢复，请稍后再试" : "ThreadPool 正在 warming，请稍后再试",
        role: status.role,
        retryable: true,
        detail: summarizeReadinessDetail(status),
      };
    }
    return { ok: true, role: status.role, status };
  }

  async function findAllowedThread(threadId) {
    const target = String(threadId || "").trim();
    if (!target) return disallowedThreadPayload(target);
    const statuses = await Promise.all(Array.from(allowedRoleSet).map((role) => roleStatus(role)));
    const entries = statuses.flatMap((status) => status?.ok
      ? (status.threads ?? [])
        .map((thread) => ({
          role: status.role,
          thread_id: String(thread.thread_id ?? "").trim(),
          workspace_root: status.workspaceRoot ?? null,
        }))
        .filter((thread) => thread.thread_id)
      : []);
    const exact = entries.find((thread) => thread.thread_id === target);
    if (exact) return allowedThreadPayload(exact, target);
    const suffixMatches = entries.filter((thread) => isThreadShortIdMatch(thread.thread_id, target));
    if (suffixMatches.length === 1) return allowedThreadPayload(suffixMatches[0], target);
    if (suffixMatches.length > 1) return ambiguousThreadPayload(target, suffixMatches);
    return disallowedThreadPayload(target);
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
    const parsed = text ? parseJson(text) : {};
    const payload = parsed?.invalidJson ? { raw: parsed.raw } : parsed;
    if (response.ok && parsed?.invalidJson) {
      const error = new Error("ThreadPool 返回了非 JSON 响应");
      error.code = "threadpool_invalid_json";
      error.payload = payload;
      error.request = request;
      throw error;
    }
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
    forceUpdateSeeds,
    findAllowedThread,
  };
}

function parseAllowedRoles(value) {
  if (!value) return DEFAULT_ALLOWED_ROLES;
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
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

function unavailablePayload(error) {
  return {
    ok: false,
    unavailable: true,
    error: error?.code === "threadpool_timeout" ? "threadpool_unavailable" : "threadpool_unavailable",
    message: error instanceof Error ? error.message : "ThreadPool 不可用",
    request: error?.request ?? null,
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

function allowedThreadPayload(match, requestedThreadId) {
  const threadId = String(match.thread_id || "");
  const requested = String(requestedThreadId || "");
  return {
    ok: true,
    role: match.role,
    thread_id: threadId,
    workspace_root: match.workspace_root ?? null,
    requested_thread_id: requested,
    resolved_from_short_id: Boolean(requested && requested !== threadId),
  };
}

function ambiguousThreadPayload(threadId, matches) {
  return {
    ok: false,
    unavailable: false,
    error: "threadpool_thread_id_ambiguous",
    message: "ThreadPool thread 短 id 匹配到多个当前工作区 role，请使用完整 thread id",
    thread_id: String(threadId || ""),
    match_count: matches.length,
    matches: matches.slice(0, 5).map((match) => ({
      role: match.role,
      thread_id: match.thread_id,
    })),
  };
}

function isThreadShortIdMatch(threadId, requestedThreadId) {
  const target = String(requestedThreadId || "").trim();
  const full = String(threadId || "").trim();
  return Boolean(target && full && target !== full && full.endsWith(target));
}

function safeErrorMessage(payload, status) {
  return String(payload?.detail || payload?.message || payload?.error || `ThreadPool request failed: ${status}`).slice(0, 240);
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
