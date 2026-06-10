const {
  test,
  assert,
  once,
  path,
  createServer,
  makeRequest,
  closeServer,
} = require("./server-test.helpers");

test("thread conversation forbidden path closes stage with stage.start and stage.end", async () => {
  const stageLogs = [];
  const server = createServer({
    logger: {
      writeStageLog: async (entry) => {
        stageLogs.push(entry);
        return entry;
      },
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      findAllowedThread: async () => ({ ok: false, error: "thread_forbidden", message: "不允许读取该线程" }),
    },
    appServer: {
      readThread: async () => {
        throw new Error("should not read forbidden thread");
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/threadpool/threads/thread_123/conversation");
    assert.equal(response.statusCode, 403);
    assert.deepEqual(stageLogs.map((entry) => entry.event), ["stage.start", "stage.end"]);
    assert.equal(stageLogs[0].stageName, "threadPool.conversation.read");
    assert.equal(stageLogs[1].outputSummary.allowed, false);
    assert.equal(stageLogs[1].outputSummary.statusCode, 403);
    assert.equal(stageLogs[1].outputSummary.threadId, "thread_123");
  } finally {
    await closeServer(server);
  }
});

test("top-level request catch returns failure trace metadata for status errors", async () => {
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/unused.json" }),
    },
    readCapabilities: async () => {
      const error = new Error("能力读取失败");
      error.statusCode = 400;
      error.code = "capability_read_failed";
      throw error;
    },
    recordApiRequestFailure: async () => ({
      traceContext: { traceId: "trace_fallback_400" },
      snapshot: { uri: "/runtime/debug-snapshots/fallback-400.json" },
      errorSummary: { stageName: "api.request.handle" },
    }),
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/capabilities");
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "capability_read_failed");
    assert.equal(response.body.traceId, "trace_fallback_400");
    assert.equal(response.body.debugSnapshotUri, "/runtime/debug-snapshots/fallback-400.json");
    assert.equal(response.body.stageName, "api.request.handle");
  } finally {
    await closeServer(server);
  }
});

test("top-level request catch returns 500 payload with trace metadata", async () => {
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/unused.json" }),
    },
    readCapabilities: async () => {
      throw new Error("boom");
    },
    recordApiRequestFailure: async () => ({
      traceContext: { traceId: "trace_fallback_500" },
      snapshot: { uri: "/runtime/debug-snapshots/fallback-500.json" },
      errorSummary: { stageName: "api.request.handle" },
    }),
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/capabilities");
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.code, "internal_error");
    assert.equal(response.body.traceId, "trace_fallback_500");
    assert.equal(response.body.debugSnapshotUri, "/runtime/debug-snapshots/fallback-500.json");
    assert.equal(response.body.stageName, "api.request.handle");
    assert.equal(response.body.retryable, true);
  } finally {
    await closeServer(server);
  }
});

test("agent chat starts direct appserver thread", async () => {
  const stageLogs = [];
  const calls = [];
  const server = createServer({
    logger: {
      writeStageLog: async (entry) => {
        stageLogs.push(entry);
        return entry;
      },
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      startThread: async (payload) => {
        calls.push(payload);
        return { ok: true, threadId: "thread_direct", status: "created" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads", { source: "direct" });
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.threadId, "thread_direct");
    assert.equal(response.body.source, "direct");
    assert.equal(response.body.status, "created");
    assert.match(response.body.traceId, /^trace_/);
    assert.deepEqual(stageLogs.map((entry) => entry.event), ["stage.start", "stage.end"]);
    assert.equal(stageLogs[0].stageName, "agentChat.thread.start");
    assert.equal(calls[0].workspaceRoot, response.body.workspaceRoot);
    assert.equal(calls[0].workspaceRoot.includes("bd-api-server-isolated-"), true);
  } finally {
    await closeServer(server);
  }
});

test("agent chat direct thread start rejects missing thread id", async () => {
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      startThread: async () => ({ ok: true, status: "created" }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads", { source: "direct" });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "appserver_thread_start_failed");
  } finally {
    await closeServer(server);
  }
});

test("agent chat starts ThreadPool role fork session through lease", async () => {
  const calls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      ensureRoleReady: async (role) => {
        calls.push({ type: "ready", role });
        return { ok: true, status: { workspaceRoot: "C:/workspace", skillPath: "skill/path", seedThreadId: "thread_seed" } };
      },
      acquireLease: async (payload) => {
        calls.push({ type: "lease", payload });
        return { ok: true, lease_id: "lease_1", thread_id: "thread_fork", status: "leased" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads", { source: "threadpool-role", role: "script-segment-analyzer" });
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.source, "threadpool-role");
    assert.equal(response.body.role, "script-segment-analyzer");
    assert.equal(response.body.threadId, "thread_fork");
    assert.equal(response.body.parentThreadId, "thread_seed");
    assert.equal(response.body.leaseId, "lease_1");
    assert.equal(response.body.workspaceRoot, "C:/workspace");
    assert.equal(response.body.skillPath, "skill/path");
    assert.equal(calls[0].type, "ready");
    assert.equal(calls[1].payload.role, "script-segment-analyzer");
    assert.match(calls[1].payload.ownerId, /^workbench-agent-chat-run_/);
  } finally {
    await closeServer(server);
  }
});

test("agent chat threadpool session rejects lease without lease id", async () => {
  const conversations = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { workspaceRoot: "C:/workspace", skillPath: "skill/path" } }),
      acquireLease: async () => ({ ok: true, thread_id: "thread_fork", status: "leased" }),
    },
    agentConversationStore: {
      createOrUpdateFromSession: async (session) => {
        conversations.push(session);
        return { conversationId: "conversation_1", revision: 1, status: "active" };
      },
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads", {
      source: "threadpool-role",
      role: "function-slot-restructure",
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error, "threadpool_lease_unavailable");
    assert.equal(conversations.length, 0);
  } finally {
    await closeServer(server);
  }
});

test("agent chat lease release is idempotent for missing active leases", async () => {
  const stageLogs = [];
  const removed = [];
  const server = createServer({
    logger: {
      writeStageLog: async (entry) => {
        stageLogs.push(entry);
      },
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      releaseLease: async () => {
        throw new Error("unknown active lease: lease_missing");
      },
    },
    agentConversationStore: {
      remove: async (conversationId) => {
        removed.push(conversationId);
        return { conversationId };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threadpool/leases/release", {
      leaseId: "lease_missing",
      ownerId: "owner_1",
      conversationId: "conversation_missing",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.status, "already_released");
    assert.equal(response.body.conversationDeleted, true);
    assert.deepEqual(removed, ["conversation_missing"]);
    assert.deepEqual(stageLogs.map((entry) => entry.event), ["stage.start", "stage.end"]);
    assert.equal(stageLogs[1].outputSummary.status, "already_released");
  } finally {
    await closeServer(server);
  }
});

test("agent chat rejects rebinding an existing conversation to a new ThreadPool fork", async () => {
  const calls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    agentConversationStore: {
      assertActive: async () => ({ conversationId: "conversation_existing", status: "active", role: "function-slot-restructure" }),
    },
    threadPool: {
      ensureRoleReady: async () => {
        calls.push("ready");
        return { ok: true, status: { seedThreadId: "seed_1" } };
      },
      acquireLease: async () => {
        calls.push("lease");
        return { ok: true, lease_id: "lease_new", thread_id: "thread_new" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads", {
      source: "threadpool-role",
      role: "function-slot-restructure",
      conversationId: "conversation_existing",
      expectedRevision: 1,
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "agent_chat_thread_rebind_forbidden");
    assert.deepEqual(calls, []);
  } finally {
    await closeServer(server);
  }
});
