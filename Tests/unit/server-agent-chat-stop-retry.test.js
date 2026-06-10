const {
  test,
  assert,
  once,
  fsPromises,
  os,
  path,
  createServer,
  makeRequest,
  closeServer,
} = require("./server-test.helpers");

test("agent chat stop turn cancels the specified turn and marks it retryable", async () => {
  const cancelCalls = [];
  const stopped = [];
  const activeTurnCalls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    activeTurnRuntime: {
      cancel: async (payload) => {
        activeTurnCalls.push(payload);
        return { ok: true, threadId: payload.threadId, turnId: payload.turnId, status: "canceled" };
      },
    },
    appServer: {
      cancelTurn: async (payload) => {
        cancelCalls.push(payload);
        return { ok: true, threadId: payload.threadId, turnId: payload.turnId, status: "canceled" };
      },
    },
    agentConversationStore: {
      assertActive: async () => ({ conversationId: "conversation_1", status: "active", revision: 3, latestTurnId: "turn_1", messages: [] }),
      recordTurnStopped: async (payload) => {
        stopped.push(payload);
        return { conversationId: payload.conversationId, status: "active", revision: 4, latestTurnId: payload.turnId, messages: [{ role: "assistant", turnId: payload.turnId, status: "canceled" }] };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_1/turns/turn_1/stop", {
      conversationId: "conversation_1",
      expectedRevision: 3,
      workspaceRoot: "C:/workspace",
      reason: "manual stop",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.action, "stop_turn");
    assert.equal(response.body.status, "canceled");
    assert.deepEqual(cancelCalls.map((call) => [call.threadId, call.turnId]), []);
    assert.deepEqual(activeTurnCalls.map((call) => [call.threadId, call.turnId]), [["thread_1", "turn_1"]]);
    assert.equal(stopped[0].text, "已停止当前 turn：manual stop");
    assert.equal(response.body.actionProjection.flags.retrySameThread, true);
    assert.equal(response.body.activeTurnStatus, "canceled");
  } finally {
    await closeServer(server);
  }
});

test("agent chat stop turn rejects failed direct appserver cancel before recording stopped turn", async () => {
  const calls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/cancel-failed.json" }),
    },
    appServer: {
      cancelTurn: async (payload) => {
        calls.push({ type: "cancelTurn", payload });
        return { ok: false, error: "provider_cancel_rejected", message: "cancel rejected" };
      },
    },
    activeTurnRuntime: {},
    agentConversationStore: {
      assertActive: async () => ({ conversationId: "conversation_1", status: "active", revision: 3, latestTurnId: "turn_1", messages: [] }),
      recordTurnStopped: async (payload) => {
        calls.push({ type: "recordTurnStopped", payload });
        return { conversationId: payload.conversationId, revision: 4, latestTurnId: payload.turnId, messages: [] };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_1/turns/turn_1/stop", {
      conversationId: "conversation_1",
      expectedRevision: 3,
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "provider_cancel_rejected");
    assert.deepEqual(calls.map((call) => call.type), ["cancelTurn"]);
  } finally {
    await closeServer(server);
  }
});

test("agent chat stop thread cancels active turn and discards threadpool thread when requested", async () => {
  const calls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      cancelTurn: async (payload) => {
        calls.push({ type: "cancel", threadId: payload.threadId, turnId: payload.turnId });
        return { ok: true, status: "canceled" };
      },
    },
    threadPool: {
      releaseLease: async (payload) => {
        calls.push({ type: "release", ...payload });
        return { ok: true, status: "released" };
      },
      discardThread: async (payload) => {
        calls.push({ type: "discard", ...payload });
        return { ok: true, status: "discarded" };
      },
    },
    agentConversationStore: {
      assertActive: async () => ({ conversationId: "conversation_1", status: "active", revision: 5, source: "threadpool-role", latestTurnId: "turn_1", leaseId: "lease_1", ownerId: "owner_1", messages: [] }),
      stopThread: async () => ({ conversationId: "conversation_1", status: "active", revision: 6, source: "threadpool-role", latestTurnId: "turn_1", messages: [] }),
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_1/stop", {
      conversationId: "conversation_1",
      activeTurnId: "turn_1",
      source: "threadpool-role",
      leaseId: "lease_1",
      ownerId: "owner_1",
      discardThread: true,
      reason: "manual stop",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.action, "stop_thread");
    assert.deepEqual(calls, [
      { type: "cancel", threadId: "thread_1", turnId: "turn_1" },
      { type: "release", leaseId: "lease_1", ownerId: "owner_1" },
      { type: "discard", threadId: "thread_1", reason: "manual stop" },
    ]);
  } finally {
    await closeServer(server);
  }
});

test("agent chat stop thread rejects failed direct appserver cancel before stopping conversation", async () => {
  const calls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/thread-cancel-failed.json" }),
    },
    appServer: {
      cancelTurn: async (payload) => {
        calls.push({ type: "cancelTurn", payload });
        return { ok: false, message: "cancel rejected" };
      },
    },
    activeTurnRuntime: {},
    threadPool: {
      releaseLease: async (payload) => calls.push({ type: "releaseLease", payload }),
      discardThread: async (payload) => calls.push({ type: "discardThread", payload }),
    },
    agentConversationStore: {
      assertActive: async () => ({ conversationId: "conversation_1", status: "active", revision: 5, source: "threadpool-role", latestTurnId: "turn_1", leaseId: "lease_1", ownerId: "owner_1", messages: [] }),
      stopThread: async (payload) => {
        calls.push({ type: "stopThread", payload });
        return { conversationId: payload.conversationId, status: "active", revision: 6, latestTurnId: "turn_1", messages: [] };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_1/stop", {
      conversationId: "conversation_1",
      activeTurnId: "turn_1",
      source: "threadpool-role",
      leaseId: "lease_1",
      ownerId: "owner_1",
      discardThread: true,
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "agent_chat_turn_cancel_failed");
    assert.deepEqual(calls.map((call) => call.type), ["cancelTurn"]);
  } finally {
    await closeServer(server);
  }
});

test("agent chat retry same thread replays persisted user task on the same thread", async () => {
  const turnCalls = [];
  const activeTurns = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    activeTurnRuntime: {
      register: async (binding) => activeTurns.push(binding),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        turnCalls.push(payload);
        return { ok: true, threadId: payload.threadId, turnId: "turn_retry", status: "submitted" };
      },
    },
    agentConversationStore: {
      assertActive: async () => ({
        conversationId: "conversation_1",
        source: "direct",
        status: "active",
        revision: 2,
        workspaceRoot: "C:/workspace",
        skillPath: "skill/path",
        latestTurnId: "turn_1",
        messages: [
          { id: "user-turn_1", role: "user", turnId: "turn_1", text: "继续分析这个方案" },
          { id: "assistant-turn_1", role: "assistant", turnId: "turn_1", text: "已完成", status: "completed" },
        ],
      }),
      recordUserTurn: async (payload) => ({ conversationId: payload.conversationId, source: "direct", status: "active", revision: 3, latestTurnId: payload.turnId, messages: [] }),
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_1/turns/turn_1/retry", {
      mode: "same_thread",
      conversationId: "conversation_1",
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.action, "retry_same_thread");
    assert.equal(response.body.threadId, "thread_1");
    assert.equal(response.body.turnId, "turn_retry");
    assert.equal(turnCalls[0].threadId, "thread_1");
    assert.deepEqual(turnCalls[0].inputs, [{ type: "text", text: "继续分析这个方案", text_elements: [] }]);
    assert.equal(activeTurns[0].ownerType, "agent-chat");
    assert.equal(activeTurns[0].replayRef.type, "agent-chat-message");
    assert.equal(activeTurns[0].replayRef.sourceTurnId, "turn_1");
  } finally {
    await closeServer(server);
  }
});

test("agent chat retry rejects non-terminal source turn", async () => {
  const turnCalls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        turnCalls.push(payload);
        return { ok: true, threadId: payload.threadId, turnId: "turn_retry", status: "submitted" };
      },
    },
    agentConversationStore: {
      assertActive: async () => ({
        conversationId: "conversation_1",
        source: "direct",
        status: "active",
        revision: 2,
        workspaceRoot: "C:/workspace",
        latestTurnId: "turn_1",
        messages: [
          { id: "user-turn_1", role: "user", turnId: "turn_1", text: "继续分析这个方案" },
          { id: "assistant-turn_1", role: "assistant", turnId: "turn_1", text: "处理中", status: "running" },
        ],
      }),
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_1/turns/turn_1/retry", {
      mode: "same_thread",
      conversationId: "conversation_1",
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, "agent_chat_retry_source_not_terminal");
    assert.equal(turnCalls.length, 0);
  } finally {
    await closeServer(server);
  }
});

test("agent chat retry new thread starts a new thread before replaying task", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-retry-new-thread-"));
  const calls = [];
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      startThread: async (payload) => {
        calls.push({ type: "startThread", ...payload });
        return { ok: true, threadId: "thread_new", status: "created" };
      },
      startTurnWithInputs: async (payload) => {
        calls.push({ type: "startTurn", threadId: payload.threadId, inputs: payload.inputs });
        return { ok: true, threadId: payload.threadId, turnId: "turn_new", status: "submitted" };
      },
    },
    agentConversationStore: {
      assertActive: async () => ({
        conversationId: "conversation_1",
        source: "direct",
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
      bindThread: async (payload) => ({ conversationId: payload.conversationId, source: "direct", status: "active", revision: 3, threadId: payload.threadId, messages: [] }),
      recordUserTurn: async (payload) => ({ conversationId: payload.conversationId, source: "direct", status: "active", revision: 4, latestTurnId: payload.turnId, messages: [] }),
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_old/turns/turn_1/retry", {
      mode: "new_thread",
      conversationId: "conversation_1",
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.action, "retry_new_thread");
    assert.equal(response.body.previousThreadId, "thread_old");
    assert.equal(response.body.threadId, "thread_new");
    assert.deepEqual(calls.map((call) => call.type), ["startThread", "startTurn"]);
    assert.equal(calls[1].threadId, "thread_new");
  } finally {
    await closeServer(server);
    await fsPromises.rm(rootDir, { recursive: true, force: true });
  }
});
