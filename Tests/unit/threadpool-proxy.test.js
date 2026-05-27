const { test, assert, fs, os, path, crypto, createJobStore, DEFAULT_PYTHON_RUNTIME_ROOT, createAppServerBridge, createShotBoundaryService, prepareInput, buildTurnInputs, renderAnalyzeTurnInputs, STAGES, buildProcessedAnalysis, normalizeTimestampBoundaries, buildShotsFromBoundaries, buildShotBoundaryCacheParams, buildRepairTurnInputs, renderRepairTurnInputs, renderSummaryTurnInputs, resolveAnalysisSampling, selectAnalysisFramesByTargetGrid, stripPromptFingerprint, splitPredecessorCacheParams, resolveSkillHash, createArtifactCacheParamBuilders, createArtifactIndex, loadRoleProfileByRole, summarizeThreadConversation, createThreadPoolProxy, sanitizeRoleStatus, DEFAULT_ALLOWED_ROLES, planContactSheets, createArtifact, createShotHarness, isTransformTurnPayload, createContactSheets, rootRuntime, escapeRegExp, delay, hashText, response, structuredErrorForTest, createTransformMessage, createInvalidTransformMessage, createShotMessage, createCachedShotAnalysis, createValidCachedShotAnalysis } = require("./threadpool-shot-boundary.helpers");

test("threadpool proxy filters roles outside the workspace allowlist", async () => {
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-transformer"],
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/health") {
        return response({ ok: true, roles: ["shot-boundary-transformer", "ae-precomp-design-producer"], warming_roles: ["ae-precomp-design-producer"] });
      }
      if (pathname === "/roles/shot-boundary-transformer/status") {
        return response({ ok: true, role: "shot-boundary-transformer", min_idle: 1, counts: { idle: 1, leased: 0 }, can_acquire: true, thread_entries: [{ thread_id: "thread_1", thread_status: "idle" }], active_leases: [] });
      }
      if (pathname === "/threads/thread_1/discard") return response({ ok: true, thread_id: "thread_1", status: "discarded" });
      return response({ ok: false, detail: "unexpected" }, 404);
    },
  });
  const roles = await proxy.roles();
  assert.deepEqual(roles.roles.map((role) => role.role), ["shot-boundary-transformer"]);
  assert.deepEqual(roles.health.warming_roles, []);
  const blocked = await proxy.roleStatus("ae-precomp-design-producer");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, "threadpool_role_not_allowed");
  const allowedThread = await proxy.findAllowedThread("thread_1");
  assert.equal(allowedThread.ok, true);
  const discarded = await proxy.discardThread({ threadId: "thread_1", reason: "test" });
  assert.equal(discarded.status, "discarded");
});

test("threadpool proxy backfills ctx usage from persisted token usage cache", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "threadpool-proxy-"));
  const tokenUsagePath = path.join(tempRoot, "thread_token_usage.json");
  await fs.writeFile(tokenUsagePath, JSON.stringify({
    thread_1: {
      latest: { last_token_usage: { input_tokens: 888, output_tokens: 12, total_tokens: 900 }, model_context_window: 258400 },
      turns: {},
    },
  }), "utf8");
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-transformer"],
    threadTokenUsagePath: tokenUsagePath,
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/health") {
        return response({ ok: true, roles: ["shot-boundary-transformer"], warming_roles: [] });
      }
      if (pathname === "/roles/shot-boundary-transformer/status") {
        return response({
          ok: true,
          role: "shot-boundary-transformer",
          min_idle: 1,
          counts: { idle: 1, leased: 0 },
          can_acquire: true,
          thread_entries: [{ thread_id: "thread_1", thread_status: "idle", is_seed: false }],
          active_leases: [],
        });
      }
      return response({ ok: false, detail: "unexpected" }, 404);
    },
  });

  const status = await proxy.roleStatus("shot-boundary-transformer");
  assert.equal(status.threads[0].latest_input_tokens, 888);
  assert.equal(status.threads[0].threshold_input_tokens, 206720);
});

test("threadpool proxy default allowlist follows thread role config", () => {
  assert.deepEqual(DEFAULT_ALLOWED_ROLES, [
    "script-segment-analyzer",
    "rhythm-structure-analyzer",
    "packaging-structure-analyzer",
    "function-slot-atomization-analyzer",
    "function-slot-atomization-boundary-reviewer",
    "shot-boundary-raw-analyzer",
    "shot-boundary-transformer",
  ]);
  const proxy = createThreadPoolProxy({ fetchImpl: async () => response({ ok: true }) });
  assert.deepEqual(proxy.allowedRoles, DEFAULT_ALLOWED_ROLES);
});

test("threadpool proxy timeout becomes unavailable payload", async () => {
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-transformer"],
    requestTimeoutMs: 10,
    fetchImpl: async (_url, options = {}) => new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  });

  const health = await proxy.health();

  assert.equal(health.ok, false);
  assert.equal(health.unavailable, true);
  assert.equal(health.error, "threadpool_unavailable");
  assert.match(health.message, /超时/);
  assert.equal(health.request.requestTimeoutMs, 10);
  assert.equal(health.request.pathname, "/health");
  assert.equal(health.request.method, "GET");
});

test("threadpool proxy acquire lease uses dedicated timeout", async () => {
  const requests = [];
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-transformer"],
    requestTimeoutMs: 3000,
    leaseAcquireTimeoutMs: 90000,
    fetchImpl: async (url, options = {}) => {
      requests.push({
        pathname: new URL(url).pathname,
        method: options.method,
      });
      return response({ ok: true, lease_id: "lease_1", thread_id: "thread_1" });
    },
  });

  await proxy.acquireLease({ role: "shot-boundary-transformer", ownerId: "trace_1" });

  assert.equal(proxy.requestTimeoutMs, 3000);
  assert.equal(proxy.leaseAcquireTimeoutMs, 90000);
  assert.deepEqual(requests, [{ pathname: "/leases/acquire", method: "POST" }]);
});

test("threadpool proxy default lease timeout leaves headroom for seed initialization wait", async () => {
  const proxy = createThreadPoolProxy({ fetchImpl: async () => response({ ok: true }) });

  assert.ok(proxy.leaseAcquireTimeoutMs > 90000);
});

test("threadpool acquire retries warming until role becomes ready", async () => {
  const { acquireLeaseWithRetry } = require("../../Apps/Api/lib/shot-boundary/threadpool-runner");
  let readinessCalls = 0;
  let acquireCalls = 0;
  const releasedOwners = [];
  const threadPool = {
    leaseAcquireTimeoutMs: 90000,
    ensureRoleReady: async () => {
      readinessCalls += 1;
      if (readinessCalls < 3) {
        return {
          ok: false,
          error: "threadpool_warming",
          message: "ThreadPool 正在 warming，请稍后再试",
          retryable: true,
          detail: { role: "script-segment-analyzer", warming: true, canAcquire: false, readyForLeases: true },
        };
      }
      return {
        ok: true,
        status: { role: "script-segment-analyzer", warming: false, canAcquire: true, readyForLeases: true },
      };
    },
    acquireLease: async () => {
      acquireCalls += 1;
      if (acquireCalls < 3) {
        throw Object.assign(new Error("thread pool role is warming: seed is still initializing"), {
          code: "threadpool_acquire_failed",
          request: { requestTimeoutMs: 90000 },
        });
      }
      return { ok: true, lease_id: "lease_1", thread_id: "thread_1" };
    },
    releaseOwnerLeases: async (ownerId) => {
      releasedOwners.push(ownerId);
      return { ok: true };
    },
  };

  const result = await acquireLeaseWithRetry(threadPool, {
    role: "script-segment-analyzer",
    ownerId: "trace_1",
    backoffMs: [0],
    codedError: (code, message, debugPayload, retryable) => Object.assign(new Error(message), { code, debugPayload, retryable }),
  });

  assert.equal(result.lease.lease_id, "lease_1");
  assert.equal(readinessCalls, 3);
  assert.equal(acquireCalls, 3);
  assert.deepEqual(releasedOwners, ["trace_1", "trace_1"]);
  assert.equal(result.attemptCount, 3);
});

test("appserver bridge defaults to in-repo python runtime root", () => {
  const bridge = createAppServerBridge({ python: "python" });
  assert.equal(bridge.pythonRuntimeRoot, DEFAULT_PYTHON_RUNTIME_ROOT);
  assert.match(DEFAULT_PYTHON_RUNTIME_ROOT, /Infrastructure[\\/]AgentRuntime$/);
});
