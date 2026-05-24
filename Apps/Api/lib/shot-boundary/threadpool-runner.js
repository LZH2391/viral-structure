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

function summarizeRequestError(error) {
  if (!error) return null;
  return {
    code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error ?? "unknown").slice(0, 240),
    request: error?.request ?? null,
  };
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
        requestError: summarizeRequestError(error),
      },
      true,
    );
  }
  return codedError(
    "threadpool_acquire_failed",
    error instanceof Error ? error.message : "ThreadPool 获取 lease 失败",
    {
      threadPool: buildThreadPoolStatusDetail(status),
      requestError: summarizeRequestError(error),
    },
    true,
  );
}

async function waitBeforeRetry(delayMs) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function shouldRetryAcquire(error) {
  const code = String(error?.code ?? "");
  return ["threadpool_timeout", "threadpool_request_failed", "threadpool_unavailable", "threadpool_acquire_failed", "threadpool_warming"].includes(code);
}

function buildAcquireFailurePayload({ attemptCount, readinessDetail, lastRequestError, requestTimeoutMs }) {
  return {
    attemptCount,
    readinessDetail: readinessDetail ?? null,
    lastRequestError: lastRequestError ?? null,
    requestTimeoutMs: Number.isFinite(requestTimeoutMs) ? requestTimeoutMs : null,
  };
}

async function acquireLeaseWithRetry(threadPool, {
  role,
  ownerId,
  maxAttempts = 12,
  backoffMs = [1000, 2000, 3000, 5000, 8000, 10000],
  codedError,
}) {
  let attemptCount = 0;
  let readinessDetail = null;
  let lastRequestError = null;
  let requestTimeoutMs = Number.isFinite(threadPool?.leaseAcquireTimeoutMs) ? Number(threadPool.leaseAcquireTimeoutMs) : null;
  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    attemptCount = attemptIndex + 1;
    if (attemptIndex > 0) {
      await cleanupLease(threadPool, null, ownerId, "shot-boundary-acquire-retry");
    }
    const readiness = typeof threadPool.ensureRoleReady === "function"
      ? await threadPool.ensureRoleReady(role)
      : await fallbackEnsureRoleReady(threadPool, role);
    if (!readiness?.ok) {
      readinessDetail = readiness?.detail ?? null;
      const failure = threadPoolReadinessError(readiness, codedError);
      failure.debugPayload = {
        ...(failure.debugPayload ?? {}),
        ...buildAcquireFailurePayload({
          attemptCount,
          readinessDetail,
          lastRequestError,
          requestTimeoutMs,
        }),
      };
      if (!shouldRetryAcquire(failure) || attemptCount >= maxAttempts) {
        if (attemptCount >= maxAttempts) {
          await cleanupLease(threadPool, null, ownerId, "shot-boundary-acquire-failed");
        }
        throw failure;
      }
      await waitBeforeRetry(backoffMs[Math.min(attemptIndex, backoffMs.length - 1)] ?? 0);
      continue;
    }
    readinessDetail = buildThreadPoolStatusDetail(readiness.status);
    try {
      const lease = await threadPool.acquireLease({ role, ownerId });
      return {
        lease,
        attemptCount,
        readinessDetail,
        lastRequestError,
        requestTimeoutMs,
      };
    } catch (error) {
      requestTimeoutMs = Number.isFinite(error?.request?.requestTimeoutMs) ? Number(error.request.requestTimeoutMs) : requestTimeoutMs;
      lastRequestError = summarizeRequestError(error);
      const failure = normalizeThreadPoolAcquireError(error, readiness?.status ?? null, codedError);
      failure.debugPayload = {
        ...(failure.debugPayload ?? {}),
        ...buildAcquireFailurePayload({
          attemptCount,
          readinessDetail,
          lastRequestError,
          requestTimeoutMs,
        }),
      };
      if (!shouldRetryAcquire(failure) || attemptCount >= maxAttempts) {
        if (attemptCount >= maxAttempts) {
          await cleanupLease(threadPool, null, ownerId, "shot-boundary-acquire-failed");
        }
        throw failure;
      }
      await waitBeforeRetry(backoffMs[Math.min(attemptIndex, backoffMs.length - 1)] ?? 0);
    }
  }
  throw codedError(
    "threadpool_unavailable",
    "ThreadPool 当前不可用，请稍后再试",
    buildAcquireFailurePayload({
      attemptCount,
      readinessDetail,
      lastRequestError,
      requestTimeoutMs,
    }),
    true,
  );
}

module.exports = {
  finalizeLease,
  cleanupLease,
  fallbackEnsureRoleReady,
  threadPoolReadinessError,
  normalizeThreadPoolAcquireError,
  acquireLeaseWithRetry,
};
