const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { server: defaultServer, createServer } = require("../../Apps/Api/server");
const { createAgentConversationStore } = require("../../Apps/Api/lib/agent-chat/conversation-store");

test.after(() => {
  if (defaultServer.listening) defaultServer.close();
});

test("agent conversation store writes one json file per conversation", async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "agent-conversation-store-"));
  try {
    const store = createAgentConversationStore({ filePath: tempRoot });
    await store.createOrUpdateFromSession({
      source: "threadpool-role",
      role: "function-slot-restructure",
      threadId: "thread_a",
    });
    await store.createOrUpdateFromSession({
      source: "threadpool-role",
      role: "function-slot-restructure",
      threadId: "thread_b",
    });

    const files = (await fsPromises.readdir(tempRoot)).filter((name) => name.endsWith(".json")).sort();
    assert.equal(files.length, 2);
    assert.equal(files.includes("conversations.json"), false);

    const listed = await store.list({ role: "function-slot-restructure", status: "active" });
    assert.equal(listed.length, 2);
    assert.deepEqual(new Set(listed.map((conversation) => conversation.threadId)), new Set(["thread_a", "thread_b"]));
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
});

function makeRequest(server, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method,
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        ...(body ? { "content-type": "application/json" } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

function makeMultipartRequest(server, { path: requestPath, fields = {}, file }) {
  const boundary = `----test-${Date.now().toString(36)}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`, "utf8"));
  chunks.push(Buffer.from(file.content, "utf8"));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
  const body = Buffer.concat(chunks);
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method: "POST",
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": body.length,
      },
    }, (response) => {
      const responseChunks = [];
      response.on("data", (chunk) => responseChunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(responseChunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

function makeMultipartFilesRequest(server, { path: requestPath, fields = {}, files = [] }) {
  const boundary = `----test-${Date.now().toString(36)}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"));
  }
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`, "utf8"));
    chunks.push(Buffer.from(file.content, "utf8"));
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  const body = Buffer.concat(chunks);
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method: "POST",
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": body.length,
      },
    }, (response) => {
      const responseChunks = [];
      response.on("data", (chunk) => responseChunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(responseChunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function exists(filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sampleRestructureFinalMarkdown() {
  return [
    "# 重组方案",
    "",
    "保存路径：`Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md`",
    "",
    "## 1. 重组目标与假设",
    "",
    "### 输入分层",
    "",
    "- brief：自动转换测试。",
    "",
    "## 2. 最终功能槽位链",
    "",
    "| 顺序 | 需求 | slotSubtype | parent archetype | 链路功能 | 本方案用法 | 选择理由 |",
    "|---:|---|---|---|---|---|---|",
    "| 1 | 首秒说明对象 | `SUB_auto_demo` 自动展示 | `ARCH_auto_demo` 自动原型 | 建立观看理由 | 展示对象 | 测试脚本转换 |",
    "",
    "## 3. Atoms 落地表",
    "",
    "| 槽位 | 来源 | script atom（原标签 → 本方案落地） | rhythm atom（原标签 → 本方案落地） | packaging atom（原标签 → 本方案落地） | atom 处理 |",
    "|---|---|---|---|---|---|",
    "| `SUB_auto_demo` | `A::F001` | `A::script::S001`：自动脚本 | `A::rhythm::R001`：自动节奏 | `A::packaging::P001`：自动包装 | 同源复用 |",
    "",
    "## 4. Adapter 方案",
    "",
    "不转换。",
    "",
    "## 5. 脚本段落方案",
    "",
    "| 脚本段落 | 使用 script atom | 段落任务 | 本方案表达 | 承接/依赖 | 证明义务 |",
    "|---|---|---|---|---|---|",
    "| 段落 1 | `A::script::S001` | 自动任务 | 自动表达 | 无 | 不改内容 |",
    "",
    "## 6. 节奏曲线",
    "",
    "| 节奏区间 | 使用 rhythm atom | 注意力状态 | 速度/密度 | 峰值/停顿/回落 | 必须同步点 |",
    "|---|---|---|---|---|---|",
    "| 区间 1 | `A::rhythm::R001` | 自动注意 | 快 | 峰值 | 同步 |",
    "",
    "## 7. 包装与证明方案",
    "",
    "| 包装块 | 使用 packaging atom | 服务主张 | 证明功能 | 覆盖层与视觉证明落地 | 字幕层规格 | 风险 |",
    "|---|---|---|---|---|---|---|",
    "| 包装块 1 | `A::packaging::P001` | 自动主张 | 自动证明 | 自动覆盖 | 自动字幕 | 无 |",
  ].join("\n");
}

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
    assert.equal(calls[0].workspaceRoot.endsWith("ByteDanceFullStack"), true);
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

test("agent chat persists restructure conversations and archives them manually", async () => {
  const conversations = new Map();
  const discardedThreads = [];
  const store = {
    list: async ({ role, status }) => Array.from(conversations.values()).filter((item) => item.role === role && item.status === status),
    get: async (conversationId) => conversations.get(conversationId) ?? null,
    createOrUpdateFromSession: async (session) => {
      const conversation = {
        conversationId: "conversation_restructure",
        revision: 1,
        source: session.source,
        role: session.role,
        status: "active",
        threadId: session.threadId,
        parentThreadId: session.parentThreadId,
        leaseId: session.leaseId,
        ownerId: session.ownerId,
        workspaceRoot: session.workspaceRoot,
        skillPath: session.skillPath,
        latestTurnId: null,
        messages: [],
        title: "重组方案",
        updatedAt: "2026-05-29T00:00:00.000Z",
      };
      conversations.set(conversation.conversationId, conversation);
      return conversation;
    },
    recordUserTurn: async ({ conversationId, turnId, text }) => {
      const conversation = conversations.get(conversationId);
      conversation.revision += 1;
      conversation.latestTurnId = turnId;
      conversation.messages.push({ id: `user-${turnId}`, role: "user", text, status: "completed" });
      conversation.messages.push({ id: `assistant-${turnId}`, role: "assistant", text: "生成中", status: "running" });
      return conversation;
    },
    recordAssistantTurn: async ({ conversationId, turnId, text, status }) => {
      const conversation = conversations.get(conversationId);
      conversation.revision += 1;
      const message = conversation.messages.find((item) => item.id === `assistant-${turnId}`);
      Object.assign(message, { text, status: status === "completed" ? "completed" : "running" });
      return conversation;
    },
    archive: async (conversationId, { expectedRevision } = {}) => {
      const conversation = conversations.get(conversationId);
      if (!conversation) return null;
      if (expectedRevision != null && expectedRevision !== conversation.revision) {
        const error = new Error("会话已在其他窗口更新，请刷新后重试");
        error.statusCode = 409;
        error.code = "agent_chat_conversation_revision_conflict";
        throw error;
      }
      conversation.revision += 1;
      conversation.status = "archived";
      return conversation;
    },
    recordSystemMessage: async ({ conversationId, text, expectedRevision }) => {
      const conversation = conversations.get(conversationId);
      if (!conversation) return null;
      if (expectedRevision != null && expectedRevision !== conversation.revision) {
        const error = new Error("会话已在其他窗口更新，请刷新后重试");
        error.statusCode = 409;
        error.code = "agent_chat_conversation_revision_conflict";
        throw error;
      }
      conversation.revision += 1;
      conversation.messages.push({ id: "system_1", role: "system", text, status: "completed" });
      return conversation;
    },
    confirmPlan: async ({ conversationId, turnId, confirmationId, displayArtifact, storyboardArtifact, expectedRevision }) => {
      const conversation = conversations.get(conversationId);
      if (!conversation) return null;
      if (expectedRevision != null && expectedRevision !== conversation.revision) {
        const error = new Error("会话已在其他窗口更新，请刷新后重试");
        error.statusCode = 409;
        error.code = "agent_chat_conversation_revision_conflict";
        throw error;
      }
      conversation.revision += 1;
      conversation.confirmedPlan = {
        status: displayArtifact || storyboardArtifact ? "completed" : "confirmed",
        turnId,
        confirmationId,
        displayArtifact,
        storyboardArtifact,
      };
      return conversation;
    },
    assertActive: async (conversationId, { expectedRevision } = {}) => {
      const conversation = conversations.get(conversationId);
      if (!conversation) return null;
      if (expectedRevision != null && expectedRevision !== conversation.revision) {
        const error = new Error("会话已在其他窗口更新，请刷新后重试");
        error.statusCode = 409;
        error.code = "agent_chat_conversation_revision_conflict";
        throw error;
      }
      return conversation;
    },
    remove: async (conversationId) => {
      const conversation = conversations.get(conversationId);
      conversations.delete(conversationId);
      return conversation ?? null;
    },
  };
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { seedThreadId: "seed_1", workspaceRoot: "C:\\Workspace", skillPath: "skill.md" } }),
      acquireLease: async () => ({ ok: true, status: "leased", thread_id: "thread_restructure", parent_thread_id: "seed_1", lease_id: "lease_1" }),
      discardThread: async ({ threadId, reason }) => {
        discardedThreads.push({ threadId, reason });
        return { ok: true, thread_id: threadId, status: "deleted" };
      },
    },
    appServer: {
      startTurnWithInputs: async () => ({ threadId: "thread_restructure", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({ threadId: "thread_restructure", turnId: "turn_1", status: "completed", finalMessage: "方案正文" }),
      readThread: async () => ({ thread: { id: "thread_restructure", status: "idle", turns: [{ id: "turn_1", status: "completed", finalMessage: "方案正文" }] } }),
    },
    agentConversationStore: store,
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const started = await makeRequest(server, "POST", "/api/agent-chat/threads", { source: "threadpool-role", role: "function-slot-restructure" });
    assert.equal(started.statusCode, 201);
    assert.equal(started.body.conversationId, "conversation_restructure");
    assert.equal(started.body.conversationRevision, 1);

    const submitted = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_restructure/turns", {
      source: "threadpool-role",
      role: "function-slot-restructure",
      conversationId: "conversation_restructure",
      expectedRevision: 1,
      message: "生成方案",
    });
    assert.equal(submitted.statusCode, 202);
    assert.equal(submitted.body.conversationRevision, 2);

    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_restructure/turns/turn_1?conversationId=conversation_restructure");
    assert.equal(collected.statusCode, 200);

    const listed = await makeRequest(server, "GET", "/api/agent-chat/conversations?role=function-slot-restructure&status=active");
    assert.equal(listed.statusCode, 200);
    const listedMessages = listed.body.conversations[0].messages;
    assert.equal(listedMessages[listedMessages.length - 1].text, "方案正文");

    const resumed = await makeRequest(server, "POST", "/api/agent-chat/conversations/conversation_restructure/resume", {});
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.body.refreshed.threadId, "thread_restructure");

    const systemMessage = await makeRequest(server, "POST", "/api/agent-chat/conversations/conversation_restructure/system-messages", { message: "确认完成", expectedRevision: 3 });
    assert.equal(systemMessage.statusCode, 200);
    assert.equal(systemMessage.body.conversation.messages[systemMessage.body.conversation.messages.length - 1].text, "确认完成");

    const confirmed = await makeRequest(server, "POST", "/api/agent-chat/conversations/conversation_restructure/confirm", {
      turnId: "turn_1",
      confirmationId: "confirm_turn_1_second",
      expectedRevision: 4,
      displayArtifact: { artifactId: "artifact_display", traceId: "trace_display", status: "placeholder" },
      storyboardArtifact: { artifactId: "artifact_storyboard", traceId: "trace_storyboard", status: "placeholder" },
    });
    assert.equal(confirmed.statusCode, 200);
    assert.equal(confirmed.body.conversation.confirmedPlan.status, "completed");
    assert.equal(confirmed.body.conversation.confirmedPlan.confirmationId, "confirm_turn_1_second");
    assert.equal(confirmed.body.conversation.confirmedPlan.displayArtifact.artifactId, "artifact_display");

    const archived = await makeRequest(server, "POST", "/api/agent-chat/conversations/conversation_restructure/archive", { expectedRevision: 5 });
    assert.equal(archived.statusCode, 200);
    assert.equal(archived.body.conversation.status, "archived");
    assert.deepEqual(discardedThreads, [{ threadId: "thread_restructure", reason: "agent-chat-conversation-archived" }]);
  } finally {
    await closeServer(server);
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

test("function slot manual boundary edit endpoint forwards sample id and json", async () => {
  const calls = [];
  const server = createServer({
    staticWorkbench: { handle: () => false },
    functionSlotAtomizationManualEditService: {
      applyBoundaryManualEdit: async (payload) => {
        calls.push(payload);
        return { sampleArtifact: { sampleVideoId: payload.sampleVideoId }, traceId: "trace_manual_edit" };
      },
    },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/sample-videos/sample_123/function-slot-atomization/manual-boundary-edit", {
      editedJsonText: "{\"slot_map\":{\"slots\":[]}}",
      expectedArtifactId: "artifact_atom",
      sourceBoundaryReviewArtifactId: "artifact_review",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.traceId, "trace_manual_edit");
    assert.deepEqual(calls[0], {
      sampleVideoId: "sample_123",
      editedJsonText: "{\"slot_map\":{\"slots\":[]}}",
      editedJson: null,
      expectedArtifactId: "artifact_atom",
      sourceBoundaryReviewArtifactId: "artifact_review",
    });
  } finally {
    await closeServer(server);
  }
});

test("modules endpoint returns public module descriptors only", async () => {
  const server = createServer({
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/modules");
    assert.equal(response.statusCode, 200);
    const sample = response.body.modules.find((entry) => entry.moduleId === "sample-ingest");
    const shot = response.body.modules.find((entry) => entry.moduleId === "shot-boundary");
    const module = response.body.modules.find((entry) => entry.moduleId === "script-segments");
    const governance = response.body.modules.find((entry) => entry.moduleId === "function-slot-semantic-governance");
    const restructure = response.body.modules.find((entry) => entry.moduleId === "function-slot-restructure");
    const displayTransform = response.body.modules.find((entry) => entry.moduleId === "function-slot-restructure-display-transformer");
    const storyboardPrep = response.body.modules.find((entry) => entry.moduleId === "shot-storyboard-prep");
    assert.equal(sample.moduleKind, "sample-ingest");
    assert.equal(sample.artifactKey, "sampleVideo");
    assert.equal(shot.moduleKind, "sample-understanding");
    assert.equal(shot.artifactKey, "shotBoundaryAnalysis");
    assert.equal(module.moduleKind, "structure-analysis");
    assert.equal(module.artifactKey, "scriptSegmentAnalysis");
    assert.equal(module.cacheKind, "script_segment");
    assert.equal(module.executorKind, "role-service");
    assert.equal(governance.moduleKind, "function-slot-workflow");
    assert.equal(governance.artifactType, "function-slot-semantic-governance-placeholder");
    assert.equal(governance.ui.placeholder, true);
    assert.equal(restructure.artifactType, "function-slot-restructure-placeholder");
    assert.equal(displayTransform.artifactType, "function-slot-restructure-display-placeholder");
    assert.equal(displayTransform.ui.stageKind, "functionSlotRestructureDisplayTransform");
    assert.equal(displayTransform.ui.placeholder, true);
    assert.equal(storyboardPrep.artifactType, "shot-storyboard-prep-placeholder");
    assert.equal(module.skillPath, undefined);
    assert.equal(module.createService, undefined);
    assert.equal(module.serviceKey, undefined);
  } finally {
    await closeServer(server);
  }
});

test("function slot workflow placeholder route returns traceable job", async () => {
  const calls = [];
  const server = createServer({
    moduleRegistry: {
      startModule: async (payload) => {
        calls.push(payload);
        return {
          processingJobId: "job_placeholder",
          sampleVideoId: payload.sampleVideoId,
          traceId: "trace_placeholder",
          runId: "run_placeholder",
          stageId: "stage_placeholder",
          artifactId: "artifact_placeholder",
          parentArtifactId: payload.body.parentArtifactId ?? null,
          status: "placeholder",
          message: "占位任务完成",
        };
      },
      list: () => [],
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/function-slot-workflow/restructure/run", {
      sampleVideoId: "sample_1",
      parentArtifactId: "artifact_parent",
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.status, "placeholder");
    assert.equal(response.body.traceId, "trace_placeholder");
    assert.deepEqual(calls, [{
      moduleId: "function-slot-restructure",
      sampleVideoId: "sample_1",
      body: {
        sampleVideoId: "sample_1",
        parentArtifactId: "artifact_parent",
      },
    }]);
  } finally {
    await closeServer(server);
  }
});

test("agent chat collect auto transforms completed restructure final markdown", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-restructure-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "auto-demo");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(path.join(planDir, "restructure.final.md"), sampleRestructureFinalMarkdown(), "utf8");
  const conversations = new Map();
  conversations.set("conversation_restructure", {
    conversationId: "conversation_restructure",
    revision: 1,
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_restructure",
    messages: [],
  });
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      collectTurnResult: async () => ({
        threadId: "thread_restructure",
        turnId: "turn_1",
        status: "completed",
        finalMessage: "已生成并落盘：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md)",
      }),
    },
    agentConversationStore: {
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      recordAssistantTurn: async ({ conversationId, turnId, text, status, slotAtomDisplay }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `assistant-${turnId}`, role: "assistant", text, status, slotAtomDisplay });
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_restructure/turns/turn_1?conversationId=conversation_restructure");

    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.autoDisplayTransform.status, "processed");
    assert.equal(collected.body.autoDisplayTransform.restructureFinalPath, "Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md");
    assert.equal(collected.body.autoDisplayTransform.displayJsonPath, "Artifacts/FunctionSlotRestructure/auto-demo/restructure.display.json");
    assert.equal(collected.body.autoDisplayTransform.slotAtomDisplay.status, "available");
    assert.equal(collected.body.autoDisplayTransform.slotAtomDisplay.slotCount, 1);
    assert.equal(collected.body.autoDisplayTransform.slotAtomDisplay.atomBindingCount, 1);
    assert.equal(collected.body.autoDisplayTransform.slotAtomDisplay.slots[0].slotSubtypeId, "SUB_auto_demo");
    assert.equal(collected.body.autoDisplayTransform.slotAtomDisplay.atoms[0].scriptAtom.includes("A::script::S001"), true);
    const displayJson = JSON.parse(await fsPromises.readFile(path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "auto-demo", "restructure.display.json"), "utf8"));
    assert.equal(displayJson.schemaVersion, "function_slot_restructure_display.v1");
    assert.equal(displayJson.sections.finalSlotChain.items[0].type, "table");
    assert.equal(conversations.get("conversation_restructure").messages[0].text, "已生成并落盘：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md)");
    assert.equal(conversations.get("conversation_restructure").messages[0].slotAtomDisplay.slots[0].slotSubtypeId, "SUB_auto_demo");
  } finally {
    await closeServer(server);
  }
});

test("agent chat auto display reads linked restructure file without overwriting final answer", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-linked-restructure-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "linked-demo");
  const finalPath = path.join(planDir, "restructure.final.md");
  const fullMarkdown = sampleRestructureFinalMarkdown().replaceAll("auto-demo", "linked-demo");
  const linkedAnswer = [
    "已生成并落盘：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/linked-demo/restructure.final.md)",
    "",
    "摘要：这是对话里的最终回答，不应该被写回 restructure.final.md。",
  ].join("\n");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(finalPath, fullMarkdown, "utf8");
  const conversations = new Map();
  conversations.set("conversation_restructure", {
    conversationId: "conversation_restructure",
    revision: 1,
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_restructure",
    messages: [],
  });
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      collectTurnResult: async () => ({
        threadId: "thread_restructure",
        turnId: "turn_1",
        status: "completed",
        finalMessage: linkedAnswer,
      }),
    },
    agentConversationStore: {
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      recordAssistantTurn: async ({ conversationId, turnId, text, status, slotAtomDisplay }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `assistant-${turnId}`, role: "assistant", text, status, slotAtomDisplay });
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_restructure/turns/turn_1?conversationId=conversation_restructure");

    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.finalMessage, linkedAnswer);
    assert.equal(collected.body.autoDisplayTransform.status, "processed");
    assert.equal(collected.body.autoDisplayTransform.sourceMode, "linkedFile");
    assert.equal(collected.body.autoDisplayTransform.displayJsonPath, "Artifacts/FunctionSlotRestructure/linked-demo/restructure.display.json");
    assert.equal(await fsPromises.readFile(finalPath, "utf8"), fullMarkdown);
    assert.equal(conversations.get("conversation_restructure").messages[0].text, linkedAnswer);
    assert.equal(conversations.get("conversation_restructure").messages[0].slotAtomDisplay.slots[0].slotSubtypeId, "SUB_auto_demo");
  } finally {
    await closeServer(server);
  }
});

test("agent chat auto display uses latest conversation restructure path after update without relinking", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-history-restructure-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "history-demo");
  const finalPath = path.join(planDir, "restructure.final.md");
  const fullMarkdown = sampleRestructureFinalMarkdown().replaceAll("auto-demo", "history-demo");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(finalPath, fullMarkdown, "utf8");
  const conversations = new Map();
  conversations.set("conversation_restructure", {
    conversationId: "conversation_restructure",
    revision: 3,
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_restructure",
    messages: [
      {
        id: "assistant-old",
        role: "assistant",
        text: "已生成并落盘：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/history-demo/restructure.final.md)",
        status: "completed",
      },
    ],
  });
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      collectTurnResult: async () => ({
        threadId: "thread_restructure",
        turnId: "turn_2",
        status: "completed",
        finalMessage: "好了。",
      }),
    },
    agentConversationStore: {
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      recordAssistantTurn: async ({ conversationId, turnId, text, status, slotAtomDisplay }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `assistant-${turnId}`, role: "assistant", text, status, slotAtomDisplay });
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_restructure/turns/turn_2?conversationId=conversation_restructure");

    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.autoDisplayTransform.status, "processed");
    assert.equal(collected.body.autoDisplayTransform.sourceMode, "conversationHistory");
    assert.equal(collected.body.autoDisplayTransform.trigger, "file_changed");
    assert.equal(collected.body.autoDisplayTransform.displayJsonPath, "Artifacts/FunctionSlotRestructure/history-demo/restructure.display.json");
    assert.equal(conversations.get("conversation_restructure").messages.at(-1).text, "好了。");
    assert.equal(conversations.get("conversation_restructure").messages.at(-1).slotAtomDisplay.slots[0].slotSubtypeId, "SUB_auto_demo");
  } finally {
    await closeServer(server);
  }
});

test("agent chat auto display skips when restructure file is unchanged", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-no-auto-restructure-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "history-demo");
  const finalPath = path.join(planDir, "restructure.final.md");
  const fullMarkdown = sampleRestructureFinalMarkdown().replaceAll("auto-demo", "history-demo");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(finalPath, fullMarkdown, "utf8");
  const stat = await fsPromises.stat(finalPath);
  const fingerprint = {
    path: "Artifacts/FunctionSlotRestructure/history-demo/restructure.final.md",
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    sha256: createHash("sha256").update(await fsPromises.readFile(finalPath)).digest("hex"),
  };
  const conversations = new Map();
  conversations.set("conversation_restructure", {
    conversationId: "conversation_restructure",
    revision: 3,
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_restructure",
    messages: [
      {
        id: "assistant-old",
        role: "assistant",
        text: "已生成并落盘：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/history-demo/restructure.final.md)",
        status: "completed",
        slotAtomDisplay: {
          status: "available",
          fileFingerprint: fingerprint,
          slots: [],
          atoms: [],
        },
      },
    ],
  });
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      collectTurnResult: async () => ({
        threadId: "thread_restructure",
        turnId: "turn_3",
        status: "completed",
        finalMessage: "看了，slot_index.json 是在结构重组阶段使用的。",
      }),
    },
    agentConversationStore: {
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      recordAssistantTurn: async ({ conversationId, turnId, text, status, slotAtomDisplay }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `assistant-${turnId}`, role: "assistant", text, status, slotAtomDisplay });
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_restructure/turns/turn_3?conversationId=conversation_restructure");

    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.autoDisplayTransform.status, "skipped_unchanged");
    assert.equal(collected.body.autoDisplayTransform.trigger, "file_unchanged");
    assert.equal(conversations.get("conversation_restructure").messages.at(-1).slotAtomDisplay, null);
  } finally {
    await closeServer(server);
  }
});

test("agent chat auto display runs format repair turn before retrying transform", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-repair-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "repair-demo");
  const finalPath = path.join(planDir, "restructure.final.md");
  const originalMarkdown = "# 坏格式\n\n没有目标章节\n";
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(finalPath, originalMarkdown, "utf8");
  const conversations = new Map();
  const repairCalls = [];
  conversations.set("conversation_restructure", {
    conversationId: "conversation_restructure",
    revision: 1,
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_restructure",
    messages: [],
  });
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      ensureRoleReady: async (role) => ({ ok: true, status: { skillPath: `${role}/SKILL.md` } }),
      acquireLease: async ({ role }) => {
        repairCalls.push({ type: "lease", role });
        return { ok: true, lease_id: "lease_repair", thread_id: "thread_repair" };
      },
      releaseLease: async ({ leaseId }) => {
        repairCalls.push({ type: "release", leaseId });
        return { ok: true };
      },
    },
    appServer: {
      collectTurnResult: async () => ({
        threadId: "thread_restructure",
        turnId: "turn_1",
        status: "completed",
        finalMessage: "已生成并落盘：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/repair-demo/restructure.final.md)",
      }),
      runTurnWithInputs: async ({ threadId, inputs }) => {
        repairCalls.push({ type: "repair-turn", threadId, prompt: inputs[0].text });
        await fsPromises.writeFile(
          path.join(planDir, "restructure.final.repair-attempt-1.md"),
          sampleRestructureFinalMarkdown().replaceAll("auto-demo", "repair-demo"),
          "utf8",
        );
        return { ok: true, threadId, turnId: "turn_repair_1", status: "completed", finalMessage: "已修复：Artifacts/FunctionSlotRestructure/repair-demo/restructure.final.repair-attempt-1.md" };
      },
    },
    agentConversationStore: {
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      recordAssistantTurn: async ({ conversationId, turnId, text, status }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `assistant-${turnId}`, role: "assistant", text, status });
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_restructure/turns/turn_1?conversationId=conversation_restructure");

    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.autoDisplayTransform.status, "processed");
    assert.equal(collected.body.autoDisplayTransform.repairAttemptCount, 1);
    assert.equal(collected.body.autoDisplayTransform.repairTurns[0].turnId, "turn_repair_1");
    assert.equal(collected.body.autoDisplayTransform.repairTurns[0].repairedPath, "Artifacts/FunctionSlotRestructure/repair-demo/restructure.final.repair-attempt-1.md");
    assert.equal(repairCalls.some((call) => call.type === "repair-turn" && /只做格式修复/.test(call.prompt)), true);
    assert.equal(repairCalls.some((call) => call.type === "repair-turn" && /restructure\.final\.repair-attempt-1\.md/.test(call.prompt)), true);
    assert.ok(await exists(path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "repair-demo", "restructure.final.repair-attempt-1.md")));
    assert.equal(await fsPromises.readFile(finalPath, "utf8"), originalMarkdown);
    const displayJson = JSON.parse(await fsPromises.readFile(path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "repair-demo", "restructure.display.json"), "utf8"));
    assert.equal(displayJson.source.restructureFinalPath.endsWith("restructure.final.repair-attempt-1.md"), true);
    assert.equal(displayJson.sourceTextDigest.sectionCount, 6);
  } finally {
    await closeServer(server);
  }
});

test("function slot governance route enqueues semantic governance job", async () => {
  const calls = [];
  const server = createServer({
    functionSlotGovernanceService: {
      enqueue: async (payload) => {
        calls.push(payload);
        return {
          processingJobId: "job_governance",
          sampleVideoId: "function-slot-library",
          traceId: "trace_governance",
          runId: "run_governance",
          stageId: "stage_governance",
          artifactId: "artifact_governance",
          parentArtifactId: null,
          status: "submitted",
          message: "FunctionSlotLibrary 语义治理任务已提交。",
        };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/function-slot-library/governance/run", {
      refreshEvidence: false,
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.status, "submitted");
    assert.equal(response.body.traceId, "trace_governance");
    assert.deepEqual(calls, [{ refreshEvidence: false }]);
  } finally {
    await closeServer(server);
  }
});

test("full analysis workflow routes create, read, and rerun runs", async () => {
  const calls = [];
  const fakeRun = { workflowRunId: "workflow_1", workflowKey: "full-analysis", workflowVersion: "full-analysis.v1", status: "running", traceId: "trace_workflow", runId: "run_workflow", sampleVideoId: "sample_1", currentStageKeys: ["upload"], stages: [] };
  const server = createServer({
    fullAnalysisWorkflowService: {
      start: async (payload) => {
        calls.push({ type: "start", workspaceId: payload.workspaceId, fileName: payload.file.filename });
        return fakeRun;
      },
      get: (workflowRunId) => workflowRunId === "workflow_1" ? fakeRun : null,
      getLatest: () => fakeRun,
      getLatestBySampleVideoId: (sampleVideoId) => sampleVideoId === "sample_1" ? fakeRun : null,
      rerunStage: async (payload) => {
        calls.push({ type: "rerun", ...payload });
        return { ...fakeRun, currentStageKeys: [payload.stageKey] };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const boundary = "----codex-boundary";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="workspaceId"\r\n\r\ndefault-workspace\r\n`, "utf8"),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.mp4"\r\nContent-Type: video/mp4\r\n\r\nvideo\r\n`, "utf8"),
      Buffer.from(`--${boundary}--\r\n`, "utf8"),
    ]);
    const address = server.address();
    const created = await new Promise((resolve, reject) => {
      const request = require("node:http").request({
        agent: false,
        method: "POST",
        host: "127.0.0.1",
        port: address.port,
        path: "/api/workflows/full-analysis/runs",
        headers: {
          connection: "close",
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": body.length,
        },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      });
      request.on("error", reject);
      request.end(body);
    });
    assert.equal(created.statusCode, 202);
    assert.equal(created.body.workflowRunId, "workflow_1");

    const read = await makeRequest(server, "GET", "/api/workflows/runs/workflow_1");
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.traceId, "trace_workflow");

    const latest = await makeRequest(server, "GET", "/api/workflows/full-analysis/latest");
    assert.equal(latest.statusCode, 200);
    assert.equal(latest.body.workflowRunId, "workflow_1");

    const latestForSample = await makeRequest(server, "GET", "/api/sample-videos/sample_1/workflows/full-analysis/latest");
    assert.equal(latestForSample.statusCode, 200);
    assert.equal(latestForSample.body.workflowRunId, "workflow_1");

    const missingForSample = await makeRequest(server, "GET", "/api/sample-videos/sample_missing/workflows/full-analysis/latest");
    assert.equal(missingForSample.statusCode, 404);

    const rerun = await makeRequest(server, "POST", "/api/workflows/runs/workflow_1/stages/scriptSegment/rerun");
    assert.equal(rerun.statusCode, 202);
    assert.deepEqual(calls, [
      { type: "start", workspaceId: "default-workspace", fileName: "sample.mp4" },
      { type: "rerun", workflowRunId: "workflow_1", stageKey: "scriptSegment" },
    ]);
  } finally {
    await closeServer(server);
  }
});

test("material recognition workflow routes create, read, and rerun runs", async () => {
  const calls = [];
  const fakeRun = { workflowRunId: "workflow_material_1", workflowKey: "material-recognition", workflowVersion: "material-recognition.v1", status: "running", traceId: "trace_material", runId: "run_material", sampleVideoId: "sample_material", currentStageKeys: ["upload"], stages: [] };
  const runStore = {
    getRun: (workflowRunId) => workflowRunId === "workflow_material_1" ? fakeRun : null,
  };
  const server = createServer({
    workflowRunStore: runStore,
    materialRecognitionWorkflowService: {
      start: async (payload) => {
        calls.push({ type: "start", workspaceId: payload.workspaceId, fileName: payload.file.filename });
        return fakeRun;
      },
      get: (workflowRunId) => workflowRunId === "workflow_material_1" ? fakeRun : null,
      getLatest: () => fakeRun,
      getLatestBySampleVideoId: (sampleVideoId) => sampleVideoId === "sample_material" ? fakeRun : null,
      rerunStage: async (payload) => {
        calls.push({ type: "rerun", ...payload });
        return { ...fakeRun, currentStageKeys: [payload.stageKey] };
      },
    },
    fullAnalysisWorkflowService: {
      get: () => null,
      rerunStage: async () => {
        throw new Error("should route material-recognition rerun to material service");
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const created = await makeMultipartRequest(server, {
      path: "/api/workflows/material-recognition/runs",
      fields: { workspaceId: "default-workspace" },
      file: { name: "material.mp4", type: "video/mp4", content: "video" },
    });
    assert.equal(created.statusCode, 202);
    assert.equal(created.body.workflowRunId, "workflow_material_1");

    const latest = await makeRequest(server, "GET", "/api/workflows/material-recognition/latest");
    assert.equal(latest.statusCode, 200);
    assert.equal(latest.body.workflowKey, "material-recognition");

    const latestForSample = await makeRequest(server, "GET", "/api/sample-videos/sample_material/workflows/material-recognition/latest");
    assert.equal(latestForSample.statusCode, 200);
    assert.equal(latestForSample.body.workflowRunId, "workflow_material_1");

    const read = await makeRequest(server, "GET", "/api/workflows/runs/workflow_material_1");
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.traceId, "trace_material");

    const rerun = await makeRequest(server, "POST", "/api/workflows/runs/workflow_material_1/stages/userMaterialTagger/rerun");
    assert.equal(rerun.statusCode, 202);
    assert.deepEqual(calls, [
      { type: "start", workspaceId: "default-workspace", fileName: "material.mp4" },
      { type: "rerun", workflowRunId: "workflow_material_1", stageKey: "userMaterialTagger" },
    ]);
  } finally {
    await closeServer(server);
  }
});

test("full analysis cache check reports existing upload cache without starting workflow", async () => {
  const cachedItem = { sampleVideoId: "sample_cached", filename: "cached.mp4", tags: [], cacheAvailable: true };
  const calls = [];
  const server = createServer({
    artifactIndex: {
      findLatestByFileHash: async (fileHash) => {
        calls.push(fileHash);
        return cachedItem;
      },
    },
    fullAnalysisWorkflowService: {
      start: async () => {
        throw new Error("should not start workflow");
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeMultipartRequest(server, {
      path: "/api/workflows/full-analysis/cache-check",
      fields: { workspaceId: "default-workspace" },
      file: { name: "cached.mp4", type: "video/mp4", content: "cached-video" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.cacheHit, true);
    assert.equal(response.body.cachedItem.sampleVideoId, "sample_cached");
    assert.equal(calls.length, 1);
  } finally {
    server.close();
  }
});

test("agent chat compact route calls appserver and records a system message", async () => {
  const stageLogs = [];
  const systemMessages = [];
  const compactCalls = [];
  const server = createServer({
    logger: {
      writeStageLog: async (entry) => {
        stageLogs.push(entry);
      },
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    agentConversationStore: {
      recordSystemMessage: async (payload) => {
        systemMessages.push(payload);
        return { conversationId: payload.conversationId, revision: 8 };
      },
    },
    appServer: {
      compactThread: async (payload) => {
        compactCalls.push(payload);
        return { ok: true, threadId: payload.threadId, status: "started" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_compact/compact", {
      conversationId: "conversation_compact",
      expectedRevision: 7,
      workspaceRoot: "C:/workspace",
      contextUsage: { inputTokens: 820, modelContextWindow: 1000, contextThresholdTokens: 800, contextUsageRatio: 0.82, contextUsageState: "danger" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.threadId, "thread_compact");
    assert.equal(response.body.conversationRevision, 8);
    assert.equal(compactCalls[0].workspaceRoot, "C:/workspace");
    assert.equal(compactCalls[0].threadId, "thread_compact");
    assert.equal(systemMessages[0].text, "上下文已自动压缩");
    assert.equal(stageLogs[0].stageName, "agentChat.context.compact");
    assert.deepEqual(stageLogs.map((entry) => entry.event), ["stage.start", "stage.end"]);
    assert.equal(stageLogs[0].inputSummary.contextUsage.contextUsageState, "danger");
  } finally {
    await closeServer(server);
  }
});

test("agent chat compact route writes failure stage and snapshot", async () => {
  const stageLogs = [];
  const snapshots = [];
  const server = createServer({
    logger: {
      writeStageLog: async (entry) => {
        stageLogs.push(entry);
      },
      writeDebugSnapshot: async (entry) => {
        snapshots.push(entry);
        return { uri: "/runtime/debug-snapshots/compact-failed.json" };
      },
    },
    appServer: {
      compactThread: async () => {
        const error = new Error("compact failed");
        error.code = "appserver_thread_compact_failed";
        throw error;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_compact/compact", {});
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "appserver_thread_compact_failed");
    assert.equal(response.body.debugSnapshotUri, "/runtime/debug-snapshots/compact-failed.json");
    assert.deepEqual(stageLogs.map((entry) => entry.event), ["stage.start", "stage.fail"]);
    assert.equal(snapshots[0].stageName, "agentChat.context.compact");
  } finally {
    await closeServer(server);
  }
});

test("agent chat stop turn cancels the specified turn and marks it retryable", async () => {
  const cancelCalls = [];
  const stopped = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
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
    assert.deepEqual(cancelCalls.map((call) => [call.threadId, call.turnId]), [["thread_1", "turn_1"]]);
    assert.equal(stopped[0].text, "已停止当前 turn：manual stop");
    assert.equal(response.body.actionProjection.flags.retrySameThread, true);
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

test("agent chat retry same thread replays persisted user task on the same thread", async () => {
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
        skillPath: "skill/path",
        latestTurnId: "turn_1",
        messages: [{ id: "user-turn_1", role: "user", turnId: "turn_1", text: "继续分析这个方案" }],
      }),
      recordUserTurn: async (payload) => ({ conversationId: payload.conversationId, status: "active", revision: 3, latestTurnId: payload.turnId, messages: [] }),
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
  } finally {
    await closeServer(server);
  }
});

test("agent chat retry new thread starts a new thread before replaying task", async () => {
  const calls = [];
  const server = createServer({
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
        messages: [{ id: "user-turn_1", role: "user", turnId: "turn_1", text: "重新生成方案" }],
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
  }
});

test("full analysis batch routes create and read batch queue", async () => {
  const calls = [];
  const fakeBatch = {
    batchRunId: "batch_1",
    workflowKey: "full-analysis",
    status: "queued",
    workspaceId: "default-workspace",
    maxConcurrentRuns: 2,
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    completedAt: null,
    items: [],
  };
  const server = createServer({
    fullAnalysisBatchQueue: {
      createBatch: ({ files, fields }) => {
        calls.push({ type: "create", fileNames: files.map((file) => file.filename), maxConcurrentRuns: fields.maxConcurrentRuns });
        return fakeBatch;
      },
      advance: async (batchRunId) => calls.push({ type: "advance", batchRunId }),
      getBatch: (batchRunId) => batchRunId === "batch_1" ? fakeBatch : null,
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const created = await makeMultipartFilesRequest(server, {
      path: "/api/workflows/full-analysis/batch-runs",
      fields: { workspaceId: "default-workspace", maxConcurrentRuns: "2" },
      files: [
        { name: "a.mp4", type: "video/mp4", content: "a" },
        { name: "b.mp4", type: "video/mp4", content: "b" },
      ],
    });
    assert.equal(created.statusCode, 202);
    assert.equal(created.body.batchRunId, "batch_1");

    const read = await makeRequest(server, "GET", "/api/workflows/full-analysis/batch-runs/batch_1");
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.batchRunId, "batch_1");
    assert.deepEqual(calls, [
      { type: "create", fileNames: ["a.mp4", "b.mp4"], maxConcurrentRuns: "2" },
      { type: "advance", batchRunId: "batch_1" },
    ]);
  } finally {
    await closeServer(server);
  }
});

test("packaging structure route enqueues service with shot dependency", async () => {
  const calls = [];
  const server = createServer({
    packagingStructureService: {
      enqueue: async (payload) => {
        calls.push(payload);
        return { processingJobId: "job_packaging", sampleVideoId: payload.sampleVideoId, traceId: "trace_packaging" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/sample-videos/sample_1/packaging-structure", {
      cacheDecision: "refresh",
      dependencies: { shotBoundaryArtifactId: "artifact_shot_1" },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.processingJobId, "job_packaging");
    assert.deepEqual(calls[0], {
      sampleVideoId: "sample_1",
      cacheDecision: "refresh",
      expectedShotBoundaryArtifactId: "artifact_shot_1",
    });
  } finally {
    await closeServer(server);
  }
});

test("generic analysis route enqueues registered service with shot dependency", async () => {
  const calls = [];
  const server = createServer({
    packagingStructureService: {
      enqueue: async (payload) => {
        calls.push(payload);
        return { processingJobId: "job_packaging", sampleVideoId: payload.sampleVideoId, traceId: "trace_packaging" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/sample-videos/sample_1/analyses/packaging-structure", {
      cacheDecision: "refresh",
      dependencies: { shotBoundaryArtifactId: "artifact_shot_1" },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.processingJobId, "job_packaging");
    assert.deepEqual(calls[0], {
      sampleVideoId: "sample_1",
      cacheDecision: "refresh",
      expectedShotBoundaryArtifactId: "artifact_shot_1",
    });
  } finally {
    await closeServer(server);
  }
});

test("cache-decision dispatches packaging structure jobs", async () => {
  const calls = [];
  const server = createServer({
    jobStore: {
      getJob: () => ({ jobId: "job_packaging", status: "cache_waiting", cachePrompt: { cacheKind: "packaging_structure" } }),
    },
    packagingStructureService: {
      resolveCacheDecision: async (payload) => {
        calls.push(payload);
        return { jobId: payload.jobId, status: "processed", sampleVideoId: "sample_1", stage: "packaging_structure.cache_reuse", progress: 100, traceId: "trace_packaging" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/processing-jobs/job_packaging/cache-decision", { decision: "reuse" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.stage, "packaging_structure.cache_reuse");
    assert.deepEqual(calls[0], { jobId: "job_packaging", decision: "reuse" });
  } finally {
    await closeServer(server);
  }
});

test("cache-decision infers legacy shot boundary cache jobs", async () => {
  const calls = [];
  const server = createServer({
    jobStore: {
      getJob: () => ({
        jobId: "job_shot",
        status: "cache_waiting",
        stage: "shot.cache_lookup",
        cachePrompt: {
          cachedItem: { tags: ["切镜"] },
        },
      }),
    },
    shotBoundaryService: {
      resolveCacheDecision: async (payload) => {
        calls.push(payload);
        return { jobId: payload.jobId, status: "processed", sampleVideoId: "sample_1", stage: "processed", progress: 100, traceId: "trace_shot" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/processing-jobs/job_shot/cache-decision", { decision: "reuse" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.stage, "processed");
    assert.deepEqual(calls[0], { jobId: "job_shot", decision: "reuse" });
  } finally {
    await closeServer(server);
  }
});
