const {
  test,
  assert,
  once,
  fsPromises,
  os,
  path,
  createServer,
  createAgentConversationStore,
  makeRequest,
  closeServer,
} = require("./server-test.helpers");

test("agent conversation store keeps storyboard result history and updates latest matching confirmation", async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "agent-conversation-store-storyboard-history-"));
  try {
    const store = createAgentConversationStore({ filePath: tempRoot });
    const conversation = await store.createOrUpdateFromSession({
      source: "threadpool-role",
      role: "function-slot-restructure",
      threadId: "thread_storyboard_history",
    });
    await store.confirmPlan({
      conversationId: conversation.conversationId,
      turnId: "turn_1",
      confirmationId: "confirm_turn_1",
      sourceRestructurePath: "Artifacts/one/restructure.final.md",
      sourceShotDesignPath: "Artifacts/one/shot-design.final.md",
      storyboardArtifact: { artifactId: "artifact_first", processingJobId: "job_first", status: "processing" },
      status: "storyboard_processing",
    });
    await store.createStoryboardResultMessage({
      conversationId: conversation.conversationId,
      turnId: "turn_1",
      confirmationId: "confirm_turn_1",
      planRevisionKey: "plan:one",
      sourceRestructurePath: "Artifacts/one/restructure.final.md",
      sourceShotDesignPath: "Artifacts/one/shot-design.final.md",
      storyboardArtifact: { artifactId: "artifact_first", processingJobId: "job_first", status: "processing" },
      status: "storyboard_processing",
    });
    await store.createStoryboardResultMessage({
      conversationId: conversation.conversationId,
      turnId: "turn_1",
      confirmationId: "confirm_turn_1",
      planRevisionKey: "plan:one",
      sourceRestructurePath: "Artifacts/one/restructure.final.md",
      sourceShotDesignPath: "Artifacts/one/shot-design.final.md",
      storyboardArtifact: { artifactId: "artifact_second", processingJobId: "job_second", status: "processing" },
      status: "storyboard_processing",
    });
    await store.updateStoryboardResultMessage({
      conversationId: conversation.conversationId,
      confirmationId: "confirm_turn_1",
      storyboardArtifact: { artifactId: "artifact_second_done", processingJobId: "job_second", status: "processed" },
      status: "completed",
    });

    const updated = await store.get(conversation.conversationId);
    const resultMessages = updated.messages.filter((message) => message.storyboardResult);
    assert.equal(resultMessages.length, 2);
    assert.equal(resultMessages[0].storyboardResult.artifactId, "artifact_first");
    assert.equal(resultMessages[0].storyboardResult.status, "storyboard_processing");
    assert.equal(resultMessages[1].storyboardResult.artifactId, "artifact_second_done");
    assert.equal(resultMessages[1].storyboardResult.status, "completed");
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("agent chat resume deletes restructure conversation when thread is unavailable", async () => {
  const conversation = {
    conversationId: "conversation_deleted",
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_missing",
    workspaceRoot: "C:\\Workspace",
    messages: [{ id: "user-turn_1", role: "user", text: "旧消息", status: "completed" }],
  };
  const removed = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    agentConversationStore: {
      get: async () => conversation,
      remove: async (conversationId) => {
        removed.push(conversationId);
        return conversation;
      },
    },
    appServer: {
      readThread: async () => {
        const error = new Error("thread gone");
        error.code = "appserver_thread_read_failed";
        throw error;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/conversations/conversation_deleted/resume", {});
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.deleted, true);
    assert.equal(response.body.refreshError.code, "appserver_thread_read_failed");
    assert.deepEqual(removed, ["conversation_deleted"]);
  } finally {
    await closeServer(server);
  }
});

test("agent chat rejects stale restructure conversation send before starting appserver turn", async () => {
  const turnInputs = [];
  const conversation = {
    conversationId: "conversation_stale",
    revision: 7,
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_stale",
    messages: [],
  };
  const staleError = () => {
    const error = new Error("会话已在其他窗口更新，请刷新后重试");
    error.statusCode = 409;
    error.code = "agent_chat_conversation_revision_conflict";
    throw error;
  };
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    agentConversationStore: {
      assertActive: async (_conversationId, { expectedRevision } = {}) => {
        if (expectedRevision !== conversation.revision) staleError();
        return conversation;
      },
      recordUserTurn: async () => {
        throw new Error("should not record stale turn");
      },
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        turnInputs.push(payload);
        return { threadId: "thread_stale", turnId: "turn_stale", status: "submitted" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_stale/turns", {
      source: "threadpool-role",
      role: "function-slot-restructure",
      conversationId: "conversation_stale",
      expectedRevision: 6,
      message: "旧窗口发送",
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "agent_chat_conversation_revision_conflict");
    assert.deepEqual(turnInputs, []);
  } finally {
    await closeServer(server);
  }
});

test("agent chat rejects conversation thread mismatch before starting appserver turn", async () => {
  const turnInputs = [];
  const conversation = {
    conversationId: "conversation_current",
    revision: 4,
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_current",
    latestTurnId: "turn_latest",
    messages: [],
  };
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/thread-mismatch.json" }),
    },
    agentConversationStore: {
      assertActive: async () => conversation,
      recordUserTurn: async () => {
        throw new Error("should not record mismatched turn");
      },
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        turnInputs.push(payload);
        return { threadId: "thread_old", turnId: "turn_wrong", status: "submitted" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_old/turns", {
      source: "threadpool-role",
      role: "function-slot-restructure",
      conversationId: "conversation_current",
      expectedRevision: 4,
      message: "这条不能发进旧 thread",
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "agent_chat_conversation_thread_mismatch");
    assert.deepEqual(turnInputs, []);
  } finally {
    await closeServer(server);
  }
});

test("agent chat rejects stale restructure archive without discarding thread", async () => {
  const discardedThreads = [];
  const conversation = {
    conversationId: "conversation_archive_stale",
    revision: 3,
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_archive_stale",
    messages: [],
  };
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    agentConversationStore: {
      archive: async (_conversationId, { expectedRevision } = {}) => {
        if (expectedRevision !== conversation.revision) {
          const error = new Error("会话已在其他窗口更新，请刷新后重试");
          error.statusCode = 409;
          error.code = "agent_chat_conversation_revision_conflict";
          throw error;
        }
        conversation.status = "archived";
        conversation.revision += 1;
        return conversation;
      },
    },
    threadPool: {
      discardThread: async ({ threadId }) => {
        discardedThreads.push(threadId);
        return { ok: true, thread_id: threadId, status: "deleted" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/conversations/conversation_archive_stale/archive", {
      expectedRevision: 2,
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "agent_chat_conversation_revision_conflict");
    assert.deepEqual(discardedThreads, []);
  } finally {
    await closeServer(server);
  }
});

test("agent chat submits message, collects answer, and reads timeline", async () => {
  const turnInputs = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        turnInputs.push(payload);
        return { ok: true, threadId: payload.threadId, turnId: "turn_1", status: "submitted" };
      },
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_fork",
        turnId: "turn_1",
        status: "completed",
        finalMessage: "正常回答",
      }),
      readThread: async () => ({
        thread: {
          id: "thread_fork",
          turns: [{
            id: "turn_1",
            status: "completed",
            items: [
              { type: "userMessage", text: "你好" },
              { type: "agentMessage", text: "正常回答" },
            ],
          }],
        },
      }),
      listTurnItems: async () => ({
        ok: true,
        items: [
          { type: "userMessage", text: "你好" },
          { type: "agentMessage", text: "正常回答" },
        ],
      }),
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const submitted = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_fork/turns", {
      message: "你好",
      source: "threadpool-role",
      role: "script-segment-analyzer",
      leaseId: "lease_1",
      workspaceRoot: "C:/workspace",
      skillPath: "skill/path",
    });
    assert.equal(submitted.statusCode, 202);
    assert.equal(submitted.body.turnId, "turn_1");
    assert.deepEqual(turnInputs[0].inputs, [{ type: "text", text: "你好", text_elements: [] }]);
    assert.equal(turnInputs[0].workspaceRoot, "C:/workspace");
    assert.equal(turnInputs[0].skillPath, "skill/path");

    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_fork/turns/turn_1?workspaceRoot=C%3A%2Fworkspace");
    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.status, "completed");
    assert.equal(collected.body.finalMessage, "正常回答");

    const timeline = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_fork/turns/turn_1/timeline?workspaceRoot=C%3A%2Fworkspace");
    assert.equal(timeline.statusCode, 200);
    assert.equal(timeline.body.threadId, "thread_fork");
    assert.deepEqual(timeline.body.items.map((item) => item.kind), ["user_input", "agent_message"]);
  } finally {
    await closeServer(server);
  }
});

test("agent chat collect rejects mismatched turn before recording conversation or active turn", async () => {
  const calls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/collect-mismatch.json" }),
    },
    appServer: {
      collectTurnResult: async (payload) => ({
        ok: true,
        threadId: payload.threadId,
        turnId: "turn_other",
        status: "completed",
        finalMessage: "wrong turn",
      }),
    },
    activeTurnRuntime: {
      markCollectResult: async (payload) => calls.push({ type: "markCollectResult", payload }),
    },
    agentConversationStore: {
      recordAssistantTurn: async (payload) => {
        calls.push({ type: "recordAssistantTurn", payload });
        return { conversationId: payload.conversationId, revision: 2, latestTurnId: payload.turnId, messages: [] };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_1/turns/turn_1?conversationId=conversation_1");
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "agent_chat_turn_collect_mismatch");
    assert.deepEqual(calls, []);
  } finally {
    await closeServer(server);
  }
});
