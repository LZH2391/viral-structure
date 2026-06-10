const {
  test,
  assert,
  once,
  path,
  createServer,
  makeRequest,
  closeServer,
} = require("./server-test.helpers");

test("agent chat retry new thread releases newly acquired lease when submit fails", async () => {
  const calls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { workspaceRoot: "C:/workspace", skillPath: "skill/path" } }),
      acquireLease: async (payload) => {
        calls.push({ type: "acquire", payload });
        return { ok: true, thread_id: "thread_new", lease_id: "lease_new", status: "leased" };
      },
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        calls.push({ type: "startTurn", payload });
        throw Object.assign(new Error("submit failed"), { code: "appserver_turn_start_failed", statusCode: 502 });
      },
    },
    agentConversationStore: {
      assertActive: async () => ({
        conversationId: "conversation_1",
        source: "threadpool-role",
        role: "function-slot-restructure",
        status: "active",
        revision: 2,
        workspaceRoot: "C:/workspace",
        latestTurnId: "turn_1",
        threadId: "thread_old",
        messages: [
          { id: "user-turn_1", role: "user", turnId: "turn_1", text: "重新生成方案" },
          { id: "assistant-turn_1", role: "assistant", turnId: "turn_1", text: "已停止", status: "canceled" },
        ],
      }),
      bindThread: async (payload) => {
        calls.push({ type: "bindThread", payload });
        return { conversationId: payload.conversationId, source: "threadpool-role", status: "active", revision: 3, threadId: payload.threadId, messages: [] };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_old/turns/turn_1/retry", {
      mode: "new_thread",
      source: "threadpool-role",
      role: "function-slot-restructure",
      conversationId: "conversation_1",
    });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(calls.map((call) => call.type), ["acquire", "bindThread", "startTurn", "release", "bindThread"]);
    assert.equal(calls[3].payload.leaseId, "lease_new");
    assert.equal(calls[4].payload.threadId, "thread_old");
    assert.equal(calls[4].payload.leaseId, null);
    assert.equal(calls[4].payload.replace, true);
  } finally {
    await closeServer(server);
  }
});

test("active turns route returns safe running bindings only", async () => {
  const server = createServer({
    activeTurnRuntime: {
      listActive: async () => [{
        threadId: "thread_1",
        turnId: "turn_1",
        ownerType: "agent-chat",
        ownerId: "conversation_1",
        status: "running",
        replayRef: { type: "text", textSummary: { length: 12, preview: "safe preview" } },
      }],
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/active-turns");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.count, 1);
    assert.equal(response.body.activeTurns[0].turnId, "turn_1");
    assert.equal(response.body.activeTurns[0].replayRef.textSummary.preview, "safe preview");
  } finally {
    await closeServer(server);
  }
});

test("active turn stop route cancels binding and releases lease", async () => {
  const calls = [];
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_1",
        turnId: "turn_1",
        ownerType: "processing-job",
        ownerId: "job_1",
        leaseId: "lease_1",
        threadPoolOwnerId: "owner_1",
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { threadId: payload.threadId, turnId: payload.turnId, status: "canceled", ownerResult: { status: "canceled" } };
      },
    },
    threadPool: {
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_1/stop", { turnId: "turn_1" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, "canceled");
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "release"]);
    assert.equal(calls[0].payload.turnId, "turn_1");
    assert.equal(calls[1].payload.leaseId, "lease_1");
  } finally {
    await closeServer(server);
  }
});

test("active turn stop thread route marks agent chat thread stopped and releases lease", async () => {
  const calls = [];
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_1",
        turnId: "turn_1",
        ownerType: "agent-chat",
        ownerId: "conversation_1",
        leaseId: "lease_1",
        threadPoolOwnerId: "owner_1",
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { threadId: payload.threadId, turnId: payload.turnId, status: "canceled" };
      },
    },
    threadPool: {
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    agentConversationStore: {
      recordTurnStopped: async () => undefined,
      stopThread: async (payload) => {
        calls.push({ type: "stopThread", payload });
        return { conversationId: payload.conversationId, threadStopped: true };
      },
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_chat/stop-thread", { turnId: "turn_1" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.action, "stop_thread");
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "release", "stopThread"]);
    assert.equal(calls[1].payload.leaseId, "lease_1");
    assert.equal(calls[2].payload.conversationId, "conversation_1");
  } finally {
    await closeServer(server);
  }
});

test("active turn stop thread route does not release lease or write owner when cancel fails", async () => {
  const calls = [];
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_1",
        turnId: "turn_1",
        ownerType: "agent-chat",
        ownerId: "conversation_1",
        leaseId: "lease_1",
        threadPoolOwnerId: "owner_1",
      }),
      cancel: async () => {
        const error = new Error("request failed: turn/cancel");
        error.code = "appserver_turn_cancel_failed";
        error.statusCode = 502;
        throw error;
      },
    },
    threadPool: {
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    agentConversationStore: {
      stopThread: async (payload) => calls.push({ type: "stopThread", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_chat/stop-thread", { turnId: "turn_1" });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "appserver_turn_cancel_failed");
    assert.deepEqual(calls, []);
  } finally {
    await closeServer(server);
  }
});

test("active turn retry route replays agent chat user message through owner binding", async () => {
  const calls = [];
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_1",
        turnId: "turn_1",
        ownerType: "agent-chat",
        ownerId: "conversation_1",
        replayRef: { type: "agent-chat-message", sourceTurnId: "turn_1", messageId: "user-turn_1" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { status: "submitted", threadId: payload.threadId, turnId: "turn_retry" };
      },
    },
    agentConversationStore: {
      get: async () => ({
        conversationId: "conversation_1",
        latestTurnId: "turn_1",
        threadId: "thread_1",
        messages: [{ id: "user-turn_1", turnId: "turn_1", role: "user", text: "retry me" }],
      }),
      recordTurnStopped: async () => undefined,
      recordUserTurn: async (payload) => calls.push({ type: "recordUser", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_chat/retry", {});
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.turnId, "turn_retry");
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "start", "recordUser"]);
    assert.equal(calls[1].payload.inputs[0].text, "retry me");
    assert.equal(calls[2].payload.turnId, "turn_retry");
  } finally {
    await closeServer(server);
  }
});

test("active turn retry route can create a new thread for agent chat replay", async () => {
  const calls = [];
  const server = createServer({
    appServer: {
      startThread: async () => {
        calls.push({ type: "startThread" });
        return { threadId: "thread_new" };
      },
    },
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_1",
        ownerType: "agent-chat",
        ownerId: "conversation_1",
        leaseId: "lease_old",
        threadPoolOwnerId: "owner_old",
        replayRef: { type: "agent-chat-message", sourceTurnId: "turn_1", messageId: "user-turn_1" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { status: "submitted", threadId: payload.threadId, turnId: "turn_retry" };
      },
    },
    agentConversationStore: {
      get: async () => ({
        conversationId: "conversation_1",
        source: "direct",
        latestTurnId: "turn_1",
        threadId: "thread_old",
        messages: [{ id: "user-turn_1", turnId: "turn_1", role: "user", text: "retry me" }],
      }),
      recordTurnStopped: async () => undefined,
      bindThread: async (payload) => {
        calls.push({ type: "bindThread", payload });
        return { conversationId: payload.conversationId, threadId: payload.threadId };
      },
      recordUserTurn: async (payload) => calls.push({ type: "recordUser", payload }),
    },
    threadPool: {
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_chat/retry", { mode: "new_thread" });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.action, "retry_new_thread");
    assert.equal(response.body.threadId, "thread_new");
    assert.equal(response.body.previousThreadId, "thread_old");
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "release", "startThread", "start", "bindThread", "recordUser"]);
    assert.equal(calls[1].payload.leaseId, "lease_old");
    assert.equal(calls[3].payload.threadId, "thread_new");
  } finally {
    await closeServer(server);
  }
});

test("active turn retry new direct thread rejects missing thread id before binding conversation", async () => {
  const calls = [];
  const server = createServer({
    appServer: {
      startThread: async () => {
        calls.push({ type: "startThread" });
        return { ok: true, status: "created" };
      },
    },
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_1",
        ownerType: "agent-chat",
        ownerId: "conversation_1",
        replayRef: { type: "agent-chat-message", sourceTurnId: "turn_1", messageId: "user-turn_1" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { status: "submitted", threadId: payload.threadId, turnId: "turn_retry" };
      },
    },
    agentConversationStore: {
      get: async () => ({
        conversationId: "conversation_1",
        source: "direct",
        latestTurnId: "turn_1",
        threadId: "thread_old",
        messages: [{ id: "user-turn_1", turnId: "turn_1", role: "user", text: "retry me" }],
      }),
      bindThread: async (payload) => calls.push({ type: "bindThread", payload }),
      recordUserTurn: async (payload) => calls.push({ type: "recordUser", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_chat/retry", { mode: "new_thread" });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "appserver_thread_start_failed");
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "startThread"]);
  } finally {
    await closeServer(server);
  }
});
