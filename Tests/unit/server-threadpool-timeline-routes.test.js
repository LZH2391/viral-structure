const {
  test,
  assert,
  once,
  fsPromises,
  os,
  path,
  createServer,
  makeRequest,
  writeRollout,
  rolloutEvent,
  closeServer,
} = require("./server-test.helpers");

test("agent chat collect keeps regressed terminal turn running before recording conversation", async () => {
  const calls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/regressed-terminal.json" }),
    },
    appServer: {
      collectTurnResult: async (payload) => ({
        ok: true,
        threadId: payload.threadId,
        turnId: payload.turnId,
        status: "completed",
        finalMessage: "我现在开始落盘方案文件。",
        turnActivity: {
          status: "completed",
          itemCount: 18,
          effectiveItemCount: 18,
          latestItemType: "agent_message",
        },
      }),
    },
    activeTurnRuntime: {
      getByTurnId: async () => ({
        turnId: "turn_1",
        lastResultSummary: {
          turnActivity: {
            itemCount: 40,
            effectiveItemCount: 40,
          },
        },
      }),
      markCollectResult: async (payload) => {
        calls.push({ type: "markCollectResult", payload });
        return { result: payload.result };
      },
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
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, "in_progress");
    assert.equal(response.body.terminalConfidence, "uncertain");
    assert.equal(response.body.finalMessage, null);
    assert.equal(calls.find((call) => call.type === "recordAssistantTurn").payload.status, "in_progress");
    assert.equal(calls.find((call) => call.type === "recordAssistantTurn").payload.text.includes("activity 视图发生回退"), true);
    assert.equal(calls.find((call) => call.type === "markCollectResult").payload.result.status, "in_progress");
    assert.equal(calls.find((call) => call.type === "markCollectResult").payload.result.turnActivity.itemCount, 18);
  } finally {
    await closeServer(server);
  }
});

test("agent chat submit rejects failed turn start before recording user turn", async () => {
  const calls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        calls.push({ type: "startTurn", payload });
        return { ok: false, error: "appserver_turn_start_failed", message: "start returned failed" };
      },
    },
    agentConversationStore: {
      recordUserTurn: async (payload) => calls.push({ type: "recordUser", payload }),
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_fork/turns", {
      message: "你好",
      source: "threadpool-role",
      role: "script-segment-analyzer",
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "appserver_turn_start_failed");
    assert.deepEqual(calls.map((call) => call.type), ["startTurn"]);
  } finally {
    await closeServer(server);
  }
});

test("processing job endpoint can read archived terminal jobs", async () => {
  const server = createServer({
    jobStore: {
      getJob: () => null,
      getArchivedJob: (jobId) => jobId === "job_archived"
        ? { jobId, sampleVideoId: "sample_1", traceId: "trace_archived", stage: "processed", status: "processed", progress: 100 }
        : null,
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/processing-jobs/job_archived");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, "processed");
    assert.equal(response.body.traceId, "trace_archived");
  } finally {
    await closeServer(server);
  }
});

test("analysis roles endpoint returns public descriptors only", async () => {
  const server = createServer({
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/analysis-roles");
    assert.equal(response.statusCode, 200);
    const role = response.body.roles.find((entry) => entry.analysisId === "script-segments");
    assert.equal(role.artifactKey, "scriptSegmentAnalysis");
    assert.equal(role.cacheKind, "script_segment");
    assert.equal(role.route, "/api/sample-videos/:sampleVideoId/analyses/script-segments");
    assert.equal(role.skillPath, undefined);
    assert.equal(role.createService, undefined);
    assert.equal(role.serviceKey, undefined);
    assert.equal(role.executorKind, undefined);
  } finally {
    await closeServer(server);
  }
});

test("thread turn timeline returns summarized turn items", async () => {
  const readThreadIds = [];
  const listTurnItemsThreadIds = [];
  const fullThreadId = "019e69b7-cef4-79c0-8fe5-1faf536836c5";
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      findAllowedThread: async (threadId) => ({
        ok: true,
        role: "script-segment-analyzer",
        thread_id: fullThreadId,
        requested_thread_id: threadId,
        resolved_from_short_id: threadId !== fullThreadId,
      }),
    },
    appServer: {
      readThread: async ({ threadId }) => {
        readThreadIds.push(threadId);
        return {
          thread: {
            id: fullThreadId,
            turns: [{
              id: "turn_abc",
              status: "running",
              items: [
                { type: "agentMessage", text: "正在分析脚本结构" },
                { type: "toolCall", toolName: "shell_command", arguments: { command: "Get-ChildItem" } },
              ],
            }],
          },
        };
      },
      listTurnItems: async ({ threadId }) => {
        listTurnItemsThreadIds.push(threadId);
        return { ok: true, items: [] };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/threadpool/threads/af536836c5/turns/turn_abc/timeline");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(readThreadIds, [fullThreadId]);
    assert.deepEqual(listTurnItemsThreadIds, [fullThreadId]);
    assert.equal(response.body.threadId, fullThreadId);
    assert.equal(response.body.turnId, "turn_abc");
    assert.deepEqual(response.body.items.map((item) => item.kind), ["agent_message", "tool_call"]);
    assert.equal(response.body.activity.itemCount, 2);
  } finally {
    await closeServer(server);
  }
});

test("thread turn timeline resolves short turn ids before rollout matching", async () => {
  const { createCodexRolloutReader } = require("../../Apps/Api/lib/observability/codex-rollout-reader");
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-rollout-threadpool-"));
  const threadId = "019e8bc9-0fd8-7590-ae69-4f84d947255a";
  const fullTurnId = "019e8e0d-d97b-7eb2-a74f-5c48d30609d9";
  const shortTurnId = "d30609d9";
  const listedTurnIds = [];
  await writeRollout(tempRoot, threadId, [
    rolloutEvent("2026-06-03T13:56:39.801Z", "session_meta", { id: threadId }),
    rolloutEvent("2026-06-03T13:56:39.816Z", "event_msg", { type: "task_started", turn_id: fullTurnId, model_context_window: 20000 }),
    rolloutEvent("2026-06-03T13:57:23.278Z", "event_msg", { type: "token_count", info: { last_token_usage: { input_tokens: 1200, output_tokens: 40, total_tokens: 1240 }, model_context_window: 20000 } }),
    rolloutEvent("2026-06-03T13:57:24.000Z", "event_msg", { type: "context_compacted" }),
  ]);
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    codexRolloutReader: createCodexRolloutReader({ codexHome: tempRoot }),
    threadPool: {
      findAllowedThread: async () => ({
        ok: true,
        role: "function-slot-restructure",
        thread_id: threadId,
      }),
    },
    appServer: {
      readThread: async () => ({
        thread: {
          id: threadId,
          turns: [{
            id: shortTurnId,
            status: "running",
            items: [{ type: "agentMessage", text: "from appserver" }],
          }],
        },
      }),
      listTurnItems: async ({ turnId }) => {
        listedTurnIds.push(turnId);
        return { ok: true, items: [{ type: "agentMessage", text: "from appserver" }] };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", `/api/threadpool/threads/${threadId}/turns/${shortTurnId}/timeline`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(listedTurnIds, [fullTurnId]);
    assert.equal(response.body.turnId, fullTurnId);
    assert.deepEqual(response.body.items.map((item) => item.kind), ["agent_message", "token_usage", "context_compacted"]);
    assert.equal(response.body.activity.tokenUsage.inputTokens, 1200);
    assert.equal(response.body.activity.tokenUsage.contextThresholdTokens, 16000);
  } finally {
    await closeServer(server);
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("thread turn timeline falls back when turn item list is unsupported", async () => {
  const fullThreadId = "019e69b7-e817-79e0-9ea4-b500c6e9e7f3";
  const writes = [];
  const server = createServer({
    logger: {
      writeStageLog: async (entry) => {
        writes.push(entry);
      },
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      findAllowedThread: async () => ({
        ok: true,
        role: "function-slot-atomization-analyzer",
        thread_id: fullThreadId,
      }),
    },
    appServer: {
      readThread: async () => ({
        thread: {
          id: fullThreadId,
          turns: [{
            id: "019e6c42-ca7b-7dd3-925f-4bba8eb5ece0",
            status: "running",
            items: [{ type: "agentMessage", text: "正在读取运行追踪" }],
          }],
        },
      }),
      listTurnItems: async () => {
        throw Object.assign(new Error("thread/turns/items/list is not supported yet"), {
          code: "appserver_turn_items_list_failed",
        });
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", `/api/threadpool/threads/${fullThreadId}/turns/019e6c42-ca7b-7dd3-925f-4bba8eb5ece0/timeline`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.threadId, fullThreadId);
    assert.deepEqual(response.body.items.map((item) => item.kind), ["agent_message"]);
    const endLog = writes.find((entry) => entry.event === "stage.end");
    assert.equal(endLog.outputSummary.source, "thread/read");
    assert.equal(endLog.outputSummary.itemListFallback.code, "appserver_turn_items_list_failed");
  } finally {
    await closeServer(server);
  }
});

test("thread conversation reads the resolved full thread id", async () => {
  const readThreadIds = [];
  const fullThreadId = "019e69b7-cef4-79c0-8fe5-1faf536836c5";
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      findAllowedThread: async (threadId) => ({
        ok: true,
        role: "script-segment-analyzer",
        thread_id: fullThreadId,
        requested_thread_id: threadId,
        resolved_from_short_id: true,
      }),
    },
    appServer: {
      readThread: async ({ threadId }) => {
        readThreadIds.push(threadId);
        return { thread: { id: fullThreadId, status: "idle", turns: [] } };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/threadpool/threads/af536836c5/conversation");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(readThreadIds, [fullThreadId]);
    assert.equal(response.body.threadId, fullThreadId);
  } finally {
    await closeServer(server);
  }
});

test("thread discard catalog errors return forbidden status", async () => {
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      discardThread: async () => ({
        ok: false,
        unavailable: false,
        error: "threadpool_thread_id_ambiguous",
        message: "ThreadPool thread 短 id 匹配到多个当前工作区 role，请使用完整 thread id",
      }),
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/threadpool/threads/af536836c5/discard", {});
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error, "threadpool_thread_id_ambiguous");
  } finally {
    await closeServer(server);
  }
});

test("threadpool force seed update route forwards maintenance request", async () => {
  const calls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      forceUpdateSeeds: async (payload) => {
        calls.push(payload);
        return { ok: true, roles: ["script-segment-analyzer"], deleted_count: 2, retiring_count: 1 };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/threadpool/maintenance/force-update-seeds", {
      reason: "test-refresh",
      roles: ["script-segment-analyzer"],
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.deleted_count, 2);
    assert.deepEqual(calls, [{ reason: "test-refresh", roles: ["script-segment-analyzer"] }]);
  } finally {
    await closeServer(server);
  }
});

test("thread turn timeline returns 404 for missing turn", async () => {
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      findAllowedThread: async () => ({ ok: true, role: "script-segment-analyzer", thread_id: "thread_123" }),
    },
    appServer: {
      readThread: async () => ({ thread: { id: "thread_123", turns: [] } }),
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/threadpool/threads/thread_123/turns/missing/timeline");
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.code, "thread_turn_not_found");
  } finally {
    await closeServer(server);
  }
});
