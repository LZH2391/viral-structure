const DEFAULT_THREADPOOL_URL = "http://127.0.0.1:8767";

function createThreadPoolProxy({ baseUrl = process.env.THREADPOOL_BASE_URL || DEFAULT_THREADPOOL_URL, fetchImpl = fetch } = {}) {
  const normalizedBaseUrl = String(baseUrl || DEFAULT_THREADPOOL_URL).replace(/\/+$/, "");

  async function health() {
    return safeRequest("GET", "/health");
  }

  async function config() {
    const payload = await safeRequest("GET", "/config");
    return sanitizeConfig(payload);
  }

  async function roles() {
    const healthPayload = await health();
    if (!healthPayload.ok) return { ok: false, unavailable: true, roles: [], health: healthPayload };
    const roleNames = Array.isArray(healthPayload.roles) ? healthPayload.roles : [];
    const roleStatuses = await Promise.all(roleNames.map((role) => roleStatus(role)));
    return {
      ok: true,
      unavailable: false,
      health: healthPayload,
      roles: roleStatuses.map((status) => summarizeRoleStatus(status)).filter(Boolean),
    };
  }

  async function roleStatus(role) {
    const payload = await safeRequest("GET", `/roles/${encodeURIComponent(role)}/status`);
    if (!payload.ok) return payload;
    return sanitizeRoleStatus(payload);
  }

  async function acquireLease({ role, ownerId }) {
    return requestJson("POST", "/leases/acquire", { role, owner_id: ownerId });
  }

  async function releaseLease({ leaseId, ownerId }) {
    return requestJson("POST", `/leases/${encodeURIComponent(leaseId)}/release`, { owner_id: ownerId });
  }

  async function discardThread({ threadId, reason }) {
    return requestJson("POST", `/threads/${encodeURIComponent(threadId)}/discard`, { reason });
  }

  async function safeRequest(method, pathname, body) {
    try {
      return await requestJson(method, pathname, body);
    } catch (error) {
      return unavailablePayload(error);
    }
  }

  async function requestJson(method, pathname, body) {
    const response = await fetchImpl(`${normalizedBaseUrl}${pathname}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const payload = text ? parseJson(text) : {};
    if (!response.ok) {
      const error = new Error(safeErrorMessage(payload, response.status));
      error.statusCode = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  return { baseUrl: normalizedBaseUrl, health, config, roles, roleStatus, acquireLease, releaseLease, discardThread };
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
    seed: false,
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
      skill_path: payload.skill_path ? basename(payload.skill_path) : null,
      init_fingerprint: payload.current_init_fingerprint ?? null,
    },
    counts: normalizeCounts(payload.counts),
    minIdle: Number(payload.min_idle ?? payload.counts?.min_idle ?? 0),
    seedThreadId: payload.seed_thread_id ?? null,
    skillPath: payload.skill_path ?? null,
    canAcquire: Boolean(payload.can_acquire),
    warming: Boolean(payload.warming),
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
    skillPath: status.skillPath,
  };
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
    error: "threadpool_unavailable",
    message: error instanceof Error ? error.message : "ThreadPool 不可用",
  };
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

module.exports = { DEFAULT_THREADPOOL_URL, createThreadPoolProxy, sanitizeRoleStatus, summarizeRoleStatus };
