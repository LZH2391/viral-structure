function buildThreadPoolStatusDetail(status) {
  return status
    ? {
      role: status.role,
      readyForLeases: Boolean(status.readyForLeases),
      canAcquire: Boolean(status.canAcquire),
      warming: Boolean(status.warming),
      warmupDetail: status.warmupDetail ?? null,
      warmupError: status.warmupError ?? null,
      startupError: status.startupError ?? null,
    }
    : null;
}

async function finalizeLease(threadPool, agentRun, options = {}) {
  if (options.shouldDiscard && agentRun?.threadId) {
    await threadPool.discardThread({ threadId: agentRun.threadId, reason: options.reason || "shot-boundary-analysis-failed" });
    if (typeof threadPool.releaseOwnerLeases === "function" && agentRun?.traceId) {
      await threadPool.releaseOwnerLeases(agentRun.traceId).catch(() => undefined);
    }
    return { mode: "discard" };
  }
  await threadPool.releaseLease({ leaseId: agentRun.leaseId, ownerId: agentRun.traceId });
  return { mode: "lease-release" };
}

async function cleanupLease(threadPool, lease, ownerId, reason) {
  if (lease?.thread_id) {
    await threadPool.discardThread({ threadId: lease.thread_id, reason }).catch(() => undefined);
  }
  if (ownerId && typeof threadPool.releaseOwnerLeases === "function") {
    await threadPool.releaseOwnerLeases(ownerId).catch(() => undefined);
  }
}

async function fallbackEnsureRoleReady(threadPool, role) {
  const status = await threadPool.roleStatus(role);
  if (!status?.ok) return status;
  if (status.warming) {
    return {
      ok: false,
      error: "threadpool_warming",
      message: "ThreadPool 正在 warming，请稍后再试",
      retryable: true,
      detail: buildThreadPoolStatusDetail(status),
    };
  }
  if (status.startupError || status.warmupError || !status.readyForLeases || !status.canAcquire) {
    return {
      ok: false,
      error: "threadpool_acquire_failed",
      message: String(status.startupError || status.warmupError || (!status.readyForLeases ? "ThreadPool 当前未 ready，请稍后再试" : "ThreadPool 当前不可获取 lease，请稍后再试")).slice(0, 240),
      retryable: true,
      detail: buildThreadPoolStatusDetail(status),
    };
  }
  return { ok: true, role, status };
}

function threadPoolReadinessError(readiness, codedError) {
  return codedError(
    readiness?.error ?? "threadpool_acquire_failed",
    readiness?.message ?? "ThreadPool 当前不可用，请稍后再试",
    {
      threadPool: readiness?.detail ?? null,
      readinessError: readiness?.error ?? null,
      retryable: readiness?.retryable ?? true,
    },
    readiness?.retryable ?? true,
  );
}

function normalizeThreadPoolAcquireError(error, status, codedError) {
  if (error?.code === "threadpool_timeout" || error?.code === "threadpool_request_failed") {
    return codedError(
      "threadpool_unavailable",
      "ThreadPool 当前不可用，请稍后再试",
      {
        threadPool: buildThreadPoolStatusDetail(status),
        requestError: error instanceof Error ? error.message : String(error ?? "unknown"),
      },
      true,
    );
  }
  return codedError(
    "threadpool_acquire_failed",
    error instanceof Error ? error.message : "ThreadPool 获取 lease 失败",
    {
      threadPool: buildThreadPoolStatusDetail(status),
      requestError: error instanceof Error ? error.message : String(error ?? "unknown"),
    },
    true,
  );
}

module.exports = {
  finalizeLease,
  cleanupLease,
  fallbackEnsureRoleReady,
  threadPoolReadinessError,
  normalizeThreadPoolAcquireError,
};
