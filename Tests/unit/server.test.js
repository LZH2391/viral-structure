const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { server: defaultServer, createServer } = require("../../Apps/Api/server");
const { createAgentConversationStore } = require("../../Apps/Api/lib/agent-chat/conversation-store");
const { reviewShotDialogueForConversation } = require("../../Apps/Api/lib/agent-chat/shot-dialogue-auto-review");

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

test("agent conversation store preserves concurrent writes to one conversation", async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "agent-conversation-store-concurrent-"));
  try {
    const store = createAgentConversationStore({ filePath: tempRoot });
    const conversation = await store.createOrUpdateFromSession({
      source: "direct",
      threadId: "thread_a",
    });

    await Promise.all([
      store.recordUserTurn({
        conversationId: conversation.conversationId,
        turnId: "turn_a",
        text: "first",
      }),
      store.recordSystemMessage({
        conversationId: conversation.conversationId,
        text: "system note",
      }),
    ]);

    const saved = await store.get(conversation.conversationId);
    assert.equal(saved.messages.some((message) => message.id === "user-turn_a"), true);
    assert.equal(saved.messages.some((message) => message.role === "system" && message.text === "system note"), true);
    assert.equal(saved.messages.some((message) => message.id === "assistant-turn_a"), true);
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("agent conversation bindThread replace clears stale lease metadata", async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "agent-conversation-store-bind-replace-"));
  try {
    const store = createAgentConversationStore({ filePath: tempRoot });
    const conversation = await store.createOrUpdateFromSession({
      source: "threadpool-role",
      role: "function-slot-restructure",
      threadId: "thread_new",
      parentThreadId: "thread_old",
      leaseId: "lease_new",
      ownerId: "owner_new",
      workspaceRoot: "C:/workspace",
      skillPath: "skill/new.md",
    });

    await store.bindThread({
      conversationId: conversation.conversationId,
      threadId: "thread_old",
      source: "direct",
      replace: true,
    });

    const saved = await store.get(conversation.conversationId);
    assert.equal(saved.threadId, "thread_old");
    assert.equal(saved.parentThreadId, null);
    assert.equal(saved.leaseId, null);
    assert.equal(saved.ownerId, null);
    assert.equal(saved.workspaceRoot, null);
    assert.equal(saved.skillPath, null);
    assert.equal(saved.source, "direct");
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
    "### 素材供给判断",
    "",
    "| 供给类型 | 可支持的视频路径 |",
    "|---|---|",
    "| `material_insufficient_for_full_video` | 不能独立支持完整视频 |",
    "",
    "### 槽位链",
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

function sampleShotDesignFinalMarkdown() {
  return [
    "# Shot 设计",
    "",
    "保存路径：`Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md`",
    "",
    "| shot | 画面 | 台词/字幕（若有） |",
    "|---|---|---|",
    "| shot_001 | 包装近景 | 商品记忆轻转化，包装信息也给你看。 |",
    "| shot_002 | 成品杯 | 你看这个颜色，冲出来就是这种豆浆感。 |",
  ].join("\n");
}

function sampleShotDesignDialogueFingerprint(entries, filePath = "Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md") {
  const normalized = entries.map(([shot, dialogue]) => `${shot}\t${dialogue}`).join("\n");
  return {
    path: filePath,
    size: entries.length,
    sha256: createHash("sha256").update(normalized).digest("hex"),
    entryCount: entries.length,
    nonEmptyCount: entries.filter(([, dialogue]) => dialogue && dialogue !== "无").length,
  };
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
    confirmPlan: async ({ conversationId, turnId, confirmationId, sourceRestructurePath, sourceShotDesignPath, displayArtifact, storyboardArtifact, expectedRevision }) => {
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
        sourceRestructurePath,
        sourceShotDesignPath,
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
    assert.equal(response.body.modules.some((entry) => entry.moduleId === "function-slot-restructure-display-transformer"), false);
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

test("agent conversation store does not let stale assistant turn steal latest turn", async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "agent-conversation-stale-turn-"));
  try {
    const store = createAgentConversationStore({ filePath: tempRoot });
    const conversation = await store.createOrUpdateFromSession({
      source: "direct",
      role: "agent",
      threadId: "thread_1",
    });
    await store.recordUserTurn({ conversationId: conversation.conversationId, turnId: "turn_new", text: "new" });
    await store.recordAssistantTurn({ conversationId: conversation.conversationId, turnId: "turn_old", text: "old done", status: "completed" });
    const updated = await store.get(conversation.conversationId);
    assert.equal(updated.latestTurnId, "turn_new");
    assert.equal(updated.messages.find((message) => message.id === "assistant-turn_old").text, "old done");
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("function slot replacement candidates endpoint reads slot index evidence", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-replacement-candidates-"));
  const indexDir = path.join(rootDir, "Runtime", "Temp", "FunctionSlotLibrary");
  const governanceDir = path.join(rootDir, "Artifacts", "FunctionSlotLibrary", "_governance");
  await fsPromises.mkdir(indexDir, { recursive: true });
  await fsPromises.mkdir(governanceDir, { recursive: true });
  await fsPromises.writeFile(path.join(indexDir, "slot_index.json"), JSON.stringify({
    schemaVersion: "short_video_slot_index.v1",
    slotVariants: [{
      variantId: "sample_a::F001",
      sampleId: "sample_a",
      artifactId: "artifact_a",
      sourceSlotId: "F001",
      slotType: "pain_entry",
      slotName: "强痛点场景进入",
      slotOrder: 1,
      persuasionTask: "先建立具体痛点",
      confidence: 0.8,
      requiredSyncPoints: ["痛点出现"],
      substitutionRules: ["保留痛点"],
    }],
    atomVariants: [{
      variantId: "sample_a::script::S001",
      sampleId: "sample_a",
      artifactId: "artifact_a",
      kind: "script",
      sourceAtomId: "S001",
      slotType: "pain_entry",
      label: "痛点先行",
      function: "先讲痛点",
      confidence: 0.81,
    }],
    bindings: [{
      id: "B001",
      type: "sync",
      sampleId: "sample_a",
      artifactId: "artifact_a",
      slotIds: ["F001"],
      atomIds: ["S001"],
      rule: "痛点和脚本同步",
      riskIfBroken: "入口断裂",
    }],
    rules: [],
  }), "utf8");
  await fsPromises.writeFile(path.join(governanceDir, "semantic-governance.v1.json"), JSON.stringify({
    schemaVersion: "function_slot_semantic_governance.v1",
    governanceId: "governance_test",
    reviewItems: [{ severity: "medium", topic: "单样例支持", sourceVariantIds: ["sample_a::F001"] }],
  }), "utf8");
  const server = createServer({ rootDir, staticWorkbench: { handle: () => false } });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const slotResponse = await makeRequest(server, "GET", "/api/function-slot-library/replacement-candidates?kind=slot&q=%E7%97%9B%E7%82%B9");
    assert.equal(slotResponse.statusCode, 200);
    assert.equal(slotResponse.body.schemaVersion, "function_slot_replacement_candidates.v1");
    assert.equal(slotResponse.body.candidates[0].slotSubtypeId, "pain_entry");
    assert.equal(slotResponse.body.candidates[0].bindingEvidence.bindings[0].riskIfBroken, "入口断裂");
    assert.equal(slotResponse.body.candidates[0].evidenceTags.some((tag) => /单样例支持/.test(tag)), true);

    const atomResponse = await makeRequest(server, "GET", "/api/function-slot-library/replacement-candidates?kind=atom&atomKind=script&slotSubtypeId=pain_entry");
    assert.equal(atomResponse.statusCode, 200);
    assert.equal(atomResponse.body.candidates[0].atomId, "S001");

    const fallbackAtomResponse = await makeRequest(server, "GET", "/api/function-slot-library/replacement-candidates?kind=atom&atomKind=script&slotSubtypeId=ARCH_unknown_display_id");
    assert.equal(fallbackAtomResponse.statusCode, 200);
    assert.equal(fallbackAtomResponse.body.candidates[0].atomId, "S001");
  } finally {
    await closeServer(server);
  }
});

test("agent chat manual replacement route renders restructure replacement turn", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-manual-replacement-"));
  const conversations = new Map();
  conversations.set("conversation_restructure", {
    conversationId: "conversation_restructure",
    revision: 4,
    role: "function-slot-restructure",
    source: "threadpool-role",
    status: "active",
    threadId: "thread_restructure",
    workspaceRoot: rootDir,
    skillPath: "function-slot-restructure/SKILL.md",
    messages: [],
  });
  const calls = [];
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        calls.push(payload);
        return { threadId: payload.threadId, turnId: "turn_manual_1", status: "submitted" };
      },
    },
    agentConversationStore: {
      assertActive: async (conversationId, { expectedRevision } = {}) => {
        const conversation = conversations.get(conversationId);
        if (!conversation) return null;
        if (expectedRevision && expectedRevision !== conversation.revision) {
          const error = new Error("revision mismatch");
          error.statusCode = 409;
          error.code = "agent_chat_conversation_revision_conflict";
          throw error;
        }
        return conversation;
      },
      recordUserTurn: async ({ conversationId, turnId, text }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `user-${turnId}`, role: "user", text });
        conversation.revision += 1;
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_restructure/turns/manual-replacement", {
      conversationId: "conversation_restructure",
      expectedRevision: 4,
      sourceRestructureFinalPath: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md",
      sourceDisplayJsonPath: "Artifacts/FunctionSlotRestructure/demo/restructure.display.json",
      displayFingerprint: { path: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md", sha256: "abc" },
      replacements: [{
        type: "slot",
        slotOrder: 1,
        fromSlotSubtypeId: "value_anchor",
        fromSlotLabel: "低门槛价值锚点",
        toSlotSubtypeId: "pain_entry",
        toSlotLabel: "强痛点场景进入",
        candidateId: "sample_a::F001",
        affectedAtomIds: ["A::script::S001"],
      }],
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.turnId, "turn_manual_1");
    assert.equal(response.body.promptTemplateVersion, "manual-replacement.v1");
    assert.match(response.body.userTurnText, /低门槛价值锚点 -> 强痛点场景进入/);
    assert.match(calls[0].inputs[0].text, /强痛点场景进入/);
    assert.match(calls[0].inputs[0].text, new RegExp(response.body.userTurnText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(calls[0].inputs[0].text, /先说明影响并请求用户确认/);
    assert.match(conversations.get("conversation_restructure").messages[0].text, /低门槛价值锚点 -> 强痛点场景进入/);
  } finally {
    await closeServer(server);
  }
});

test("agent chat manual replacement rejects start result for a different thread before recording user turn", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-manual-replacement-thread-mismatch-"));
  const calls = [];
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/start-thread-mismatch.json" }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        calls.push({ type: "startTurn", payload });
        return { threadId: "thread_other", turnId: "turn_manual_1", status: "submitted" };
      },
    },
    agentConversationStore: {
      assertActive: async () => ({
        conversationId: "conversation_restructure",
        revision: 4,
        role: "function-slot-restructure",
        source: "threadpool-role",
        status: "active",
        threadId: "thread_restructure",
        workspaceRoot: rootDir,
        skillPath: "function-slot-restructure/SKILL.md",
        messages: [],
      }),
      recordUserTurn: async (payload) => calls.push({ type: "recordUserTurn", payload }),
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_restructure/turns/manual-replacement", {
      conversationId: "conversation_restructure",
      expectedRevision: 4,
      sourceRestructureFinalPath: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md",
      sourceDisplayJsonPath: "Artifacts/FunctionSlotRestructure/demo/restructure.display.json",
      replacements: [{
        type: "slot",
        fromSlotSubtypeId: "value_anchor",
        toSlotSubtypeId: "pain_entry",
        candidateId: "sample_a::F001",
      }],
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "agent_chat_turn_start_thread_mismatch");
    assert.deepEqual(calls.map((call) => call.type), ["startTurn"]);
  } finally {
    await closeServer(server);
  }
});

test("agent chat manual replacement rejects failed turn start before recording user turn", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-manual-replacement-failed-"));
  const conversation = {
    conversationId: "conversation_restructure",
    revision: 4,
    role: "function-slot-restructure",
    source: "threadpool-role",
    status: "active",
    threadId: "thread_restructure",
    workspaceRoot: rootDir,
    skillPath: "function-slot-restructure/SKILL.md",
    messages: [],
  };
  const calls = [];
  const server = createServer({
    rootDir,
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
      assertActive: async () => conversation,
      recordUserTurn: async (payload) => calls.push({ type: "recordUser", payload }),
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_restructure/turns/manual-replacement", {
      conversationId: "conversation_restructure",
      expectedRevision: 4,
      sourceRestructureFinalPath: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md",
      sourceDisplayJsonPath: "Artifacts/FunctionSlotRestructure/demo/restructure.display.json",
      displayFingerprint: { path: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md", sha256: "abc" },
      replacements: [{
        type: "slot",
        slotOrder: 1,
        fromSlotSubtypeId: "value_anchor",
        fromSlotLabel: "低门槛价值锚点",
        toSlotSubtypeId: "pain_entry",
        toSlotLabel: "强痛点场景进入",
        candidateId: "sample_a::F001",
      }],
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, "appserver_turn_start_failed");
    assert.deepEqual(calls.map((call) => call.type), ["startTurn"]);
    assert.equal(conversation.messages.length, 0);
  } finally {
    await closeServer(server);
    await fsPromises.rm(rootDir, { recursive: true, force: true });
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
    assert.equal(displayJson.sections.finalSlotChain.items[0].type, "heading");
    assert.equal(conversations.get("conversation_restructure").messages[0].text, "已生成并落盘：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md)");
    assert.equal(conversations.get("conversation_restructure").messages[0].slotAtomDisplay.slots[0].slotSubtypeId, "SUB_auto_demo");
  } finally {
    await closeServer(server);
  }
});

test("agent chat collect auto reviews completed shot design dialogue in restructure conversation", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-shot-dialogue-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "shot-demo");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(path.join(planDir, "shot-design.final.md"), sampleShotDesignFinalMarkdown(), "utf8");
  const conversations = new Map();
  conversations.set("conversation_shot_design", {
    conversationId: "conversation_shot_design",
    revision: 1,
    source: "direct",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_shot_design",
    messages: [],
  });
  const reviewTurns = [];
  const reworkTurns = [];
  const activeTurns = [];
  const releases = [];
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/dialogue-review.json" }),
    },
    threadPool: {
      ensureRoleReady: async (role) => ({
        ok: true,
        status: {
          role,
          skillPath: "C:/ByteDanceFullStack/.agents/skills/function-slot-dialogue-robotic-reviewer/SKILL.md",
        },
      }),
      acquireLease: async ({ role, ownerId }) => ({
        ok: true,
        role,
        ownerId,
        thread_id: "thread_dialogue_review",
        lease_id: "lease_dialogue_review",
      }),
      releaseLease: async (payload) => {
        releases.push(payload);
        return { ok: true };
      },
    },
    appServer: {
      collectTurnResult: async () => ({
        threadId: "thread_shot_design",
        turnId: "turn_shot_1",
        status: "completed",
        finalMessage: "已生成并落盘：Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
      }),
      runTurnWithInputs: async (payload) => {
        reviewTurns.push(payload);
        return {
          threadId: payload.threadId,
          turnId: "turn_dialogue_review_1",
          status: "completed",
          finalMessage: JSON.stringify({
            decision: "rework",
            reason: "存在明显方案腔台词",
            issues: [
              {
                shot: "shot_001",
                original: "商品记忆轻转化，包装信息也给你看。",
                robotic_type: "名词堆叠腔",
                reason: "像结构字段拼成的说明，不像真人口播。",
                minimal_direction: "删掉方案词，改成观众能听懂的包装信息提示。",
              },
            ],
          }),
        };
      },
      startTurnWithInputs: async (payload) => {
        reworkTurns.push(payload);
        return {
          threadId: payload.threadId,
          turnId: "turn_dialogue_rework_auto_1",
          status: "submitted",
        };
      },
    },
    activeTurnRuntime: {
      register: async (binding) => {
        activeTurns.push(binding);
        return binding;
      },
    },
    agentConversationStore: {
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      recordAssistantTurn: async ({ conversationId, turnId, text, status, dialogueRoboticReview }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `assistant-${turnId}`, role: "assistant", text, status, dialogueRoboticReview });
        return conversation;
      },
      recordUserTurn: async ({ conversationId, turnId, text }) => {
        const conversation = conversations.get(conversationId);
        conversation.latestTurnId = turnId;
        conversation.messages.push({ id: `user-${turnId}`, turnId, role: "user", text, status: "completed" });
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_shot_design/turns/turn_shot_1?conversationId=conversation_shot_design");

    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.autoDialogueRoboticReview.status, "processed");
    assert.equal(collected.body.autoDialogueRoboticReview.decision, "rework");
    assert.equal(collected.body.autoDialogueRoboticReview.issueCount, 1);
    assert.equal(collected.body.autoDialogueRoboticReview.shotDesignFinalPath, "Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md");
    assert.equal(reviewTurns.length, 1);
    assert.equal(reviewTurns[0].threadId, "thread_dialogue_review");
    assert.match(reviewTurns[0].inputs[0].text, /shot-design\.final\.md/);
    assert.match(reviewTurns[0].inputs[0].text, /finalMessage 只返回 JSON object/);
    assert.equal(reworkTurns.length, 1);
    assert.equal(reworkTurns[0].threadId, "thread_shot_design");
    assert.match(reworkTurns[0].inputs[0].text, /根据台词机器人感审查结果/);
    assert.match(reworkTurns[0].inputs[0].text, /reviewIssuesJson/);
    assert.match(reworkTurns[0].inputs[0].text, /shot_001/);
    assert.equal(collected.body.autoDialogueRework.ok, true);
    assert.equal(collected.body.autoDialogueRework.turnId, "turn_dialogue_rework_auto_1");
    assert.equal(activeTurns[0].stageName, "agentChat.dialogueReview.autoRework");
    assert.equal(activeTurns[0].parentArtifactId, collected.body.autoDialogueRoboticReview.artifactId);
    assert.equal(releases[0].leaseId, "lease_dialogue_review");
    const artifact = JSON.parse(await fsPromises.readFile(path.join(planDir, "dialogue-robotic-review.final.json"), "utf8"));
    assert.equal(artifact.schemaVersion, "function_slot_dialogue_robotic_review.v1");
    assert.equal(artifact.review.decision, "rework");
    assert.equal(artifact.review.issues[0].shot, "shot_001");
    assert.equal(conversations.get("conversation_shot_design").messages[0].dialogueRoboticReview.decision, "rework");
    assert.equal(conversations.get("conversation_shot_design").messages[1].id, "user-turn_dialogue_rework_auto_1");
    assert.equal(conversations.get("conversation_shot_design").messages[0].dialogueRoboticReview.fileFingerprint.path, "Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md");
  } finally {
    await closeServer(server);
  }
});

test("agent chat collect does not auto review historical shot design on plain dialogue", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-shot-dialogue-plain-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "shot-demo");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(path.join(planDir, "shot-design.final.md"), sampleShotDesignFinalMarkdown(), "utf8");
  const conversations = new Map();
  conversations.set("conversation_shot_design", {
    conversationId: "conversation_shot_design",
    revision: 2,
    source: "direct",
    role: "function-slot-shot-design",
    status: "active",
    threadId: "thread_shot_design",
    latestTurnId: "turn_plain_chat",
    messages: [{
      id: "assistant-turn_shot_1",
      turnId: "turn_shot_1",
      role: "assistant",
      text: "已生成并落盘：Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
      status: "completed",
    }],
  });
  const reviewTurns = [];
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/dialogue-review.json" }),
    },
    threadPool: {
      ensureRoleReady: async (role) => ({ ok: true, status: { role, skillPath: "dialogue-reviewer/SKILL.md" } }),
      acquireLease: async ({ role, ownerId }) => ({ ok: true, role, ownerId, thread_id: "thread_dialogue_review", lease_id: "lease_dialogue_review" }),
      releaseLease: async () => ({ ok: true }),
    },
    appServer: {
      collectTurnResult: async () => ({
        threadId: "thread_shot_design",
        turnId: "turn_plain_chat",
        status: "completed",
        finalMessage: "可以，我后续会按这个方向处理。",
      }),
      runTurnWithInputs: async (payload) => {
        reviewTurns.push(payload);
        return { threadId: payload.threadId, turnId: "turn_dialogue_review_unexpected", status: "completed", finalMessage: "{}" };
      },
    },
    agentConversationStore: {
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      recordAssistantTurn: async ({ conversationId, turnId, text, status, dialogueRoboticReview }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `assistant-${turnId}`, role: "assistant", text, status, dialogueRoboticReview });
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_shot_design/turns/turn_plain_chat?conversationId=conversation_shot_design");

    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.autoDialogueRoboticReview, undefined);
    assert.equal(reviewTurns.length, 0);
    const message = conversations.get("conversation_shot_design").messages.at(-1);
    assert.equal(message.turnId, undefined);
    assert.equal(message.dialogueRoboticReview, null);
  } finally {
    await closeServer(server);
  }
});

test("agent chat collect does not auto review unchanged shot design mentioned by plain dialogue", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-shot-dialogue-unchanged-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "shot-demo");
  const shotDesignPath = path.join(planDir, "shot-design.final.md");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(shotDesignPath, sampleShotDesignFinalMarkdown(), "utf8");
  const oldTime = new Date(Date.now() - 60_000);
  await fsPromises.utimes(shotDesignPath, oldTime, oldTime);
  const conversations = new Map();
  conversations.set("conversation_shot_design", {
    conversationId: "conversation_shot_design",
    revision: 2,
    source: "direct",
    role: "function-slot-shot-design",
    status: "active",
    threadId: "thread_shot_design",
    latestTurnId: "turn_plain_chat",
    messages: [],
  });
  const reviewTurns = [];
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/dialogue-review.json" }),
    },
    threadPool: {
      ensureRoleReady: async (role) => ({ ok: true, status: { role, skillPath: "dialogue-reviewer/SKILL.md" } }),
      acquireLease: async ({ role, ownerId }) => ({ ok: true, role, ownerId, thread_id: "thread_dialogue_review", lease_id: "lease_dialogue_review" }),
      releaseLease: async () => ({ ok: true }),
    },
    appServer: {
      collectTurnResult: async () => ({
        threadId: "thread_shot_design",
        turnId: "turn_plain_chat",
        status: "completed",
        finalMessage: "已生成并落盘：Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
      }),
      runTurnWithInputs: async (payload) => {
        reviewTurns.push(payload);
        return { threadId: payload.threadId, turnId: "turn_dialogue_review_unexpected", status: "completed", finalMessage: "{}" };
      },
    },
    activeTurnRuntime: {
      getByTurnId: async () => ({
        turnId: "turn_plain_chat",
        createdAt: new Date(Date.now() - 5_000).toISOString(),
      }),
      markCollectResult: async () => null,
    },
    agentConversationStore: {
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      recordAssistantTurn: async ({ conversationId, turnId, text, status, dialogueRoboticReview }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `assistant-${turnId}`, role: "assistant", text, status, dialogueRoboticReview });
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_shot_design/turns/turn_plain_chat?conversationId=conversation_shot_design");

    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.autoDialogueRoboticReview, undefined);
    assert.equal(reviewTurns.length, 0);
  } finally {
    await closeServer(server);
  }
});

test("agent chat collect auto reviews remembered shot design when dialogue changes", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-shot-dialogue-changed-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "shot-demo");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(path.join(planDir, "shot-design.final.md"), [
    "# Shot 设计",
    "",
    "| shot | 画面 | 台词/字幕（若有） |",
    "|---|---|---|",
    "| shot_001 | 包装近景 | 这袋先看包装，配料和冲法都在这儿。 |",
    "| shot_002 | 成品杯 | 你看这个颜色，冲出来就是这种豆浆感。 |",
  ].join("\n"), "utf8");
  const conversations = new Map();
  conversations.set("conversation_shot_design", {
    conversationId: "conversation_shot_design",
    revision: 3,
    source: "direct",
    role: "function-slot-shot-design",
    status: "active",
    threadId: "thread_shot_design",
    latestTurnId: "turn_dialogue_changed",
    messages: [{
      id: "assistant-turn_shot_1",
      turnId: "turn_shot_1",
      role: "assistant",
      text: "已生成并落盘：Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
      status: "completed",
      dialogueRoboticReview: {
        status: "processed",
        decision: "pass",
        issueCount: 0,
        shotDesignFinalPath: "Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
        dialogueFingerprint: sampleShotDesignDialogueFingerprint([
          ["shot_001", "商品记忆轻转化，包装信息也给你看。"],
          ["shot_002", "你看这个颜色，冲出来就是这种豆浆感。"],
        ]),
      },
    }],
  });
  const reviewTurns = [];
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/dialogue-review.json" }),
    },
    threadPool: {
      ensureRoleReady: async (role) => ({ ok: true, status: { role, skillPath: "dialogue-reviewer/SKILL.md" } }),
      acquireLease: async ({ role, ownerId }) => ({ ok: true, role, ownerId, thread_id: "thread_dialogue_review", lease_id: "lease_dialogue_review" }),
      releaseLease: async () => ({ ok: true }),
    },
    appServer: {
      collectTurnResult: async () => ({
        threadId: "thread_shot_design",
        turnId: "turn_dialogue_changed",
        status: "completed",
        finalMessage: "已按你的要求调整台词。",
      }),
      runTurnWithInputs: async (payload) => {
        reviewTurns.push(payload);
        return {
          threadId: payload.threadId,
          turnId: "turn_dialogue_review_changed",
          status: "completed",
          finalMessage: JSON.stringify({ decision: "pass", reason: "台词自然", issues: [] }),
        };
      },
    },
    agentConversationStore: {
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      recordAssistantTurn: async ({ conversationId, turnId, text, status, dialogueRoboticReview }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `assistant-${turnId}`, role: "assistant", text, status, dialogueRoboticReview });
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_shot_design/turns/turn_dialogue_changed?conversationId=conversation_shot_design");

    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.autoDialogueRoboticReview.status, "processed");
    assert.equal(collected.body.autoDialogueRoboticReview.sourceMode, "rememberedShotDesignPath");
    assert.equal(reviewTurns.length, 1);
    assert.equal(conversations.get("conversation_shot_design").messages.at(-1).dialogueRoboticReview.dialogueFingerprint.nonEmptyCount, 2);
  } finally {
    await closeServer(server);
  }
});

test("agent chat collect ignores remembered shot design when only non-dialogue fields change", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-shot-packaging-changed-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "shot-demo");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(path.join(planDir, "shot-design.final.md"), [
    "# Shot 设计",
    "",
    "| shot | 包装说明 | 台词/字幕（若有） |",
    "|---|---|---|",
    "| shot_001 | 右上角新增证据标签 | 商品记忆轻转化，包装信息也给你看。 |",
    "| shot_002 | 底部字幕避让杯身 | 你看这个颜色，冲出来就是这种豆浆感。 |",
  ].join("\n"), "utf8");
  const conversations = new Map();
  conversations.set("conversation_shot_design", {
    conversationId: "conversation_shot_design",
    revision: 3,
    source: "direct",
    role: "function-slot-shot-design",
    status: "active",
    threadId: "thread_shot_design",
    latestTurnId: "turn_packaging_changed",
    messages: [{
      id: "assistant-turn_shot_1",
      turnId: "turn_shot_1",
      role: "assistant",
      text: "已生成并落盘：Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
      status: "completed",
      dialogueRoboticReview: {
        status: "processed",
        decision: "pass",
        issueCount: 0,
        shotDesignFinalPath: "Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
        dialogueFingerprint: sampleShotDesignDialogueFingerprint([
          ["shot_001", "商品记忆轻转化，包装信息也给你看。"],
          ["shot_002", "你看这个颜色，冲出来就是这种豆浆感。"],
        ]),
      },
    }],
  });
  const reviewTurns = [];
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/dialogue-review.json" }),
    },
    threadPool: {
      ensureRoleReady: async (role) => ({ ok: true, status: { role, skillPath: "dialogue-reviewer/SKILL.md" } }),
      acquireLease: async ({ role, ownerId }) => ({ ok: true, role, ownerId, thread_id: "thread_dialogue_review", lease_id: "lease_dialogue_review" }),
      releaseLease: async () => ({ ok: true }),
    },
    appServer: {
      collectTurnResult: async () => ({
        threadId: "thread_shot_design",
        turnId: "turn_packaging_changed",
        status: "completed",
        finalMessage: "已调整包装说明。",
      }),
      runTurnWithInputs: async (payload) => {
        reviewTurns.push(payload);
        return { threadId: payload.threadId, turnId: "turn_dialogue_review_unexpected", status: "completed", finalMessage: "{}" };
      },
    },
    agentConversationStore: {
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      recordAssistantTurn: async ({ conversationId, turnId, text, status, dialogueRoboticReview }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `assistant-${turnId}`, role: "assistant", text, status, dialogueRoboticReview });
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_shot_design/turns/turn_packaging_changed?conversationId=conversation_shot_design");

    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.autoDialogueRoboticReview, undefined);
    assert.equal(reviewTurns.length, 0);
  } finally {
    await closeServer(server);
  }
});

test("dialogue review turn registers active binding while collecting", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-dialogue-review-active-turn-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "shot-demo");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(path.join(planDir, "shot-design.final.md"), sampleShotDesignFinalMarkdown(), "utf8");

  const startedTurns = [];
  const collectedTurns = [];
  const releasedLeases = [];
  const conversation = {
    conversationId: "conversation_shot_design",
    revision: 3,
    role: "function-slot-shot-design",
    status: "active",
    threadId: "thread_shot_design",
    latestTurnId: "turn_shot_1",
    messages: [{
      id: "assistant-turn_shot_1",
      turnId: "turn_shot_1",
      role: "assistant",
      text: "已生成并落盘：Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
      status: "completed",
    }],
  };

  const review = await reviewShotDialogueForConversation({
    handlers: {
      rootDir,
      logger: {
        writeStageLog: async () => undefined,
        writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/dialogue-review.json" }),
      },
      threadPool: {
        ensureRoleReady: async (role) => ({ ok: true, status: { role, skillPath: "dialogue-reviewer/SKILL.md" } }),
        acquireLease: async ({ role, ownerId }) => ({ ok: true, role, ownerId, thread_id: "thread_dialogue_review", lease_id: "lease_dialogue_review" }),
        releaseLease: async (payload) => {
          releasedLeases.push(payload);
          return { ok: true };
        },
      },
      activeTurnRuntime: {
        start: async (payload) => {
          startedTurns.push(payload);
          return { threadId: payload.threadId, turnId: "turn_dialogue_review_active", status: "submitted" };
        },
        collect: async (payload) => {
          collectedTurns.push(payload);
          return {
            threadId: payload.threadId,
            turnId: payload.turnId,
            status: "completed",
            finalMessage: JSON.stringify({
              decision: "rework",
              reason: "存在模板腔台词",
              issues: [{
                shot: "shot_001",
                original: "商品记忆轻转化，包装信息也给你看。",
                robotic_type: "模板腔",
                reason: "像方案说明。",
                minimal_direction: "改成自然口播。",
              }],
            }),
          };
        },
      },
      agentConversationStore: {
        get: async (conversationId) => conversationId === conversation.conversationId ? conversation : null,
        assertActive: async (conversationId) => conversationId === conversation.conversationId ? conversation : null,
      },
    },
    traceContext: { traceId: "trace_dialogue", runId: "run_dialogue", stageId: "stage_dialogue" },
    conversationId: conversation.conversationId,
    sourceTurnId: "turn_shot_1",
    parentArtifactId: "turn_shot_1",
    force: true,
  });

  assert.equal(review.status, "processed");
  assert.equal(review.turnId, "turn_dialogue_review_active");
  assert.equal(startedTurns.length, 1);
  assert.equal(startedTurns[0].binding.ownerType, "agent-chat-dialogue-review");
  assert.equal(startedTurns[0].binding.stageName, "function.slot.dialogue_robotic_review.auto_review");
  assert.equal(startedTurns[0].binding.leaseId, "lease_dialogue_review");
  assert.equal(startedTurns[0].binding.replayRef.type, "dialogue-review-input");
  assert.equal(collectedTurns.length, 1);
  assert.equal(collectedTurns[0].turnId, "turn_dialogue_review_active");
  assert.equal(collectedTurns[0].skipOwnerHandler, true);
  assert.equal(releasedLeases[0].leaseId, "lease_dialogue_review");
});

test("agent chat conversation dialogue review route attaches review summary to assistant message", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-manual-dialogue-review-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "shot-demo");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(path.join(planDir, "shot-design.final.md"), sampleShotDesignFinalMarkdown(), "utf8");
  const conversations = new Map();
  conversations.set("conversation_shot_design", {
    conversationId: "conversation_shot_design",
    revision: 3,
    source: "threadpool-role",
    role: "function-slot-shot-design",
    status: "active",
    threadId: "thread_shot_design",
    latestTurnId: "turn_shot_1",
    messages: [{
      id: "assistant-turn_shot_1",
      turnId: "turn_shot_1",
      role: "assistant",
      text: "已生成并落盘：Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
      status: "completed",
    }],
  });
  const reviewTurns = [];
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/dialogue-review.json" }),
    },
    threadPool: {
      ensureRoleReady: async (role) => ({ ok: true, status: { role, skillPath: "dialogue-reviewer/SKILL.md" } }),
      acquireLease: async ({ role, ownerId }) => ({ ok: true, role, ownerId, thread_id: "thread_dialogue_review", lease_id: "lease_dialogue_review" }),
      releaseLease: async () => ({ ok: true }),
    },
    appServer: {
      runTurnWithInputs: async (payload) => {
        reviewTurns.push(payload);
        return {
          threadId: payload.threadId,
          turnId: "turn_dialogue_review_1",
          status: "completed",
          finalMessage: JSON.stringify({
            decision: "rework",
            reason: "存在模板腔台词",
            issues: [{
              shot: "shot_001",
              original: "商品记忆轻转化，包装信息也给你看。",
              robotic_type: "模板腔",
              reason: "像方案说明。",
              minimal_direction: "改成自然口播。",
            }],
          }),
        };
      },
    },
    agentConversationStore: {
      assertActive: async (conversationId, { expectedRevision } = {}) => {
        const conversation = conversations.get(conversationId);
        if (!conversation) return null;
        if (expectedRevision && expectedRevision !== conversation.revision) {
          const error = new Error("revision mismatch");
          error.statusCode = 409;
          error.code = "agent_chat_conversation_revision_conflict";
          throw error;
        }
        return conversation;
      },
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      attachDialogueRoboticReview: async ({ conversationId, turnId, dialogueRoboticReview }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages = conversation.messages.map((message) => (
          message.turnId === turnId ? { ...message, dialogueRoboticReview } : message
        ));
        conversation.revision += 1;
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/conversations/conversation_shot_design/dialogue-review", {
      turnId: "turn_shot_1",
      expectedRevision: 3,
      shotDesignFinalPath: "Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.review.status, "processed");
    assert.equal(response.body.review.decision, "rework");
    assert.equal(response.body.review.issueCount, 1);
    assert.equal(response.body.conversationRevision, 4);
    assert.equal(reviewTurns.length, 1);
    assert.match(reviewTurns[0].inputs[0].text, /shot-design\.final\.md/);
    assert.equal(conversations.get("conversation_shot_design").messages[0].dialogueRoboticReview.decision, "rework");
  } finally {
    await closeServer(server);
  }
});

test("agent chat conversation dialogue rework route records review-driven user turn", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-dialogue-rework-"));
  const reviewDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "shot-demo");
  await fsPromises.mkdir(reviewDir, { recursive: true });
  await fsPromises.writeFile(path.join(reviewDir, "dialogue-robotic-review.final.json"), JSON.stringify({
    schemaVersion: "function_slot_dialogue_robotic_review.v1",
    artifactId: "artifact_review_1",
    review: {
      decision: "rework",
      reason: "台词偏说明书腔",
      issues: [{
        shot: "shot_001",
        original: "成分、用法、适用提示，都要看清楚。",
        robotic_type: "说明书腔",
        reason: "字段式表达像在念商品页。",
        minimal_direction: "改成下单前确认自己能不能用、买哪款的动作判断。",
      }],
    },
  }, null, 2), "utf8");
  const conversations = new Map();
  conversations.set("conversation_shot_design", {
    conversationId: "conversation_shot_design",
    revision: 4,
    source: "threadpool-role",
    role: "function-slot-shot-design",
    status: "active",
    threadId: "thread_shot_design",
    workspaceRoot: rootDir,
    skillPath: "function-slot-shot-design/SKILL.md",
    latestTurnId: "turn_shot_1",
    messages: [{
      id: "assistant-turn_shot_1",
      turnId: "turn_shot_1",
      role: "assistant",
      text: "已生成 shot-design.final.md",
      status: "completed",
      dialogueRoboticReview: {
        decision: "rework",
        issueCount: 1,
        shotDesignFinalPath: "Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
        reviewOutputPath: "Artifacts/FunctionSlotRestructure/shot-demo/dialogue-robotic-review.final.json",
        artifactId: "artifact_review_1",
      },
    }],
  });
  const turnCalls = [];
  const activeTurns = [];
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/dialogue-rework.json" }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        turnCalls.push(payload);
        return { threadId: payload.threadId, turnId: "turn_rework_1", status: "submitted" };
      },
    },
    activeTurnRuntime: {
      register: async (binding) => {
        activeTurns.push(binding);
        return binding;
      },
    },
    agentConversationStore: {
      assertActive: async (conversationId, { expectedRevision } = {}) => {
        const conversation = conversations.get(conversationId);
        if (!conversation) return null;
        if (expectedRevision && expectedRevision !== conversation.revision) {
          const error = new Error("revision mismatch");
          error.statusCode = 409;
          error.code = "agent_chat_conversation_revision_conflict";
          throw error;
        }
        return conversation;
      },
      recordUserTurn: async ({ conversationId, turnId, text }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `user-${turnId}`, turnId, role: "user", text });
        conversation.latestTurnId = turnId;
        conversation.revision += 1;
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/conversations/conversation_shot_design/dialogue-rework", {
      expectedRevision: 4,
    });

    assert.equal(response.statusCode, 202);
    assert.equal(response.body.turnId, "turn_rework_1");
    assert.equal(response.body.conversationRevision, 5);
    assert.match(response.body.userTurnText, /根据台词机器人感审查结果/);
    assert.match(response.body.userTurnText, /dialogue-robotic-review\.final\.json/);
    assert.match(response.body.userTurnText, /reviewIssuesJson/);
    assert.match(response.body.userTurnText, /shot_001/);
    assert.match(response.body.userTurnText, /成分、用法、适用提示/);
    assert.match(response.body.userTurnText, /说明书腔/);
    assert.match(response.body.userTurnText, /最小|minimal_direction|动作判断/);
    assert.equal(turnCalls[0].threadId, "thread_shot_design");
    assert.match(turnCalls[0].inputs[0].text, /必须逐条依据 reviewIssuesJson/);
    assert.match(turnCalls[0].inputs[0].text, /minimal_direction/);
    assert.equal(conversations.get("conversation_shot_design").messages.at(-1).id, "user-turn_rework_1");
    assert.equal(activeTurns[0].ownerType, "agent-chat");
    assert.equal(activeTurns[0].replayRef.type, "agent-chat-message");
    assert.equal(activeTurns[0].parentArtifactId, "Artifacts/FunctionSlotRestructure/shot-demo/dialogue-robotic-review.final.json");
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

test("agent chat auto display rejects invalid repair lease before running repair turn", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-repair-lease-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "repair-lease-demo");
  const finalPath = path.join(planDir, "restructure.final.md");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(finalPath, "# 坏格式\n\n没有目标章节\n", "utf8");
  const repairCalls = [];
  const conversations = new Map([["conversation_restructure", {
    conversationId: "conversation_restructure",
    revision: 1,
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_restructure",
    messages: [],
  }]]);
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      ensureRoleReady: async (role) => ({ ok: true, status: { skillPath: `${role}/SKILL.md` } }),
      acquireLease: async () => {
        repairCalls.push({ type: "lease" });
        return { ok: true, thread_id: "thread_repair" };
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
        finalMessage: "已生成并落盘：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/repair-lease-demo/restructure.final.md)",
      }),
      runTurnWithInputs: async () => {
        repairCalls.push({ type: "repair-turn" });
        return { ok: true, threadId: "thread_repair", turnId: "turn_repair_1", status: "completed" };
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
    assert.equal(collected.body.autoDisplayTransform.status, "repair_required");
    assert.deepEqual(repairCalls.map((call) => call.type), ["lease"]);
  } finally {
    await closeServer(server);
    await fsPromises.rm(rootDir, { recursive: true, force: true });
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

test("active turn retry new thread releases agent chat lease when start returns failure", async () => {
  const calls = [];
  const server = createServer({
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
        return { ok: false, error: "appserver_turn_start_failed", message: "start returned failed" };
      },
    },
    agentConversationStore: {
      get: async () => ({
        conversationId: "conversation_1",
        source: "threadpool-role",
        role: "script-segment-analyzer",
        latestTurnId: "turn_1",
        threadId: "thread_old",
        messages: [{ id: "user-turn_1", turnId: "turn_1", role: "user", text: "retry me" }],
      }),
      bindThread: async (payload) => calls.push({ type: "bindThread", payload }),
      recordUserTurn: async (payload) => calls.push({ type: "recordUser", payload }),
    },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { workspaceRoot: "C:/workspace", skillPath: "skill.md" } }),
      acquireLease: async (payload) => {
        calls.push({ type: "acquire", payload });
        return { lease_id: "lease_new", thread_id: "thread_new" };
      },
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_chat/retry", { mode: "new_thread" });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "release", "acquire", "start", "release"]);
    assert.equal(calls[4].payload.leaseId, "lease_new");
  } finally {
    await closeServer(server);
  }
});

test("active turn retry route does not replay agent chat when cancel observes completed turn", async () => {
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
        return { status: "completed", threadId: payload.threadId, turnId: payload.turnId, ownerResult: { status: "completed" } };
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
      recordUserTurn: async (payload) => calls.push({ type: "recordUser", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_chat/retry", {});
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error, "active_turn_retry_source_not_canceled");
    assert.deepEqual(calls.map((call) => call.type), ["cancel"]);
  } finally {
    await closeServer(server);
  }
});

test("active turn retry route can create a new thread for processing job replay and update owner run", async () => {
  const calls = [];
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "failed",
    stage: "shot.boundary.turn_started",
    progress: 80,
    activeTurnReplay: { inputs: [{ type: "text", text: "retry job", text_elements: [] }] },
    agentRun: {
      threadId: "thread_old",
      turnId: "turn_old",
      currentAttemptId: "attempt_old",
      leaseId: "lease_old",
      skillPath: "skill.md",
      status: "canceled",
    },
  }]]);
  const server = createServer({
    appServer: {
      startThread: async (payload) => {
        calls.push({ type: "startThread", payload });
        return { threadId: "thread_new" };
      },
    },
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_old",
        ownerType: "processing-job",
        ownerId: "job_1",
        currentAttemptId: "attempt_old",
        stageName: "shot.boundary.turn_started",
        leaseId: "lease_old",
        threadPoolOwnerId: "owner_old",
        replayRef: { type: "processing-job-input", refId: "job_1", sourceTurnId: "turn_old" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { status: "submitted", threadId: payload.threadId, turnId: "turn_new" };
      },
    },
    jobStore: {
      getJob: (jobId) => jobs.get(jobId) ?? null,
      updateJob: (jobId, patch) => {
        calls.push({ type: "updateJob", jobId, patch });
        const next = { ...(jobs.get(jobId) ?? {}), ...patch };
        jobs.set(jobId, next);
        return next;
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
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_job/retry", { mode: "new_thread" });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.action, "retry_new_thread");
    assert.equal(response.body.threadId, "thread_new");
    assert.equal(response.body.previousThreadId, "thread_old");
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "release", "startThread", "start", "updateJob"]);
    assert.equal(calls[1].payload.leaseId, "lease_old");
    assert.equal(calls[3].payload.inputs[0].text, "retry job");
    assert.equal(jobs.get("job_1").status, "processing");
    assert.equal(jobs.get("job_1").agentRun.threadId, "thread_new");
    assert.equal(jobs.get("job_1").agentRun.turnId, "turn_new");
    assert.equal(jobs.get("job_1").agentRun.retrySourceTurnId, "turn_old");
  } finally {
    await closeServer(server);
  }
});

test("active turn processing-job retry rejects threadpool lease without lease id", async () => {
  const calls = [];
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "failed",
    stage: "shot.boundary.turn_started",
    progress: 80,
    activeTurnReplay: { inputs: [{ type: "text", text: "retry job", text_elements: [] }] },
    agentRun: {
      threadId: "thread_old",
      turnId: "turn_old",
      currentAttemptId: "attempt_old",
      status: "canceled",
    },
  }]]);
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_old",
        ownerType: "processing-job",
        ownerId: "job_1",
        currentAttemptId: "attempt_old",
        stageName: "shot.boundary.turn_started",
        replayRef: { type: "processing-job-input", refId: "job_1", sourceTurnId: "turn_old" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { status: "submitted", threadId: payload.threadId, turnId: "turn_new" };
      },
    },
    jobStore: {
      getJob: (jobId) => jobs.get(jobId) ?? null,
      updateJob: (jobId, patch) => {
        calls.push({ type: "updateJob", jobId, patch });
        jobs.set(jobId, { ...jobs.get(jobId), ...patch });
      },
    },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { workspaceRoot: "C:/workspace" } }),
      acquireLease: async (payload) => {
        calls.push({ type: "acquire", payload });
        return { ok: true, thread_id: "thread_new" };
      },
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_job/retry", { mode: "new_thread", role: "script-segment-analyzer" });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error, "active_turn_retry_threadpool_lease_failed");
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "acquire"]);
    assert.equal(jobs.get("job_1").status, "failed");
  } finally {
    await closeServer(server);
  }
});

test("active turn retry route does not replay when cancel observes completed turn", async () => {
  const calls = [];
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "processing",
    stage: "shot.boundary.turn_started",
    progress: 80,
    activeTurnReplay: { inputs: [{ type: "text", text: "retry job", text_elements: [] }] },
    agentRun: {
      threadId: "thread_old",
      turnId: "turn_old",
      currentAttemptId: "attempt_old",
      status: "collecting",
    },
  }]]);
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_old",
        ownerType: "processing-job",
        ownerId: "job_1",
        currentAttemptId: "attempt_old",
        stageName: "shot.boundary.turn_started",
        replayRef: { type: "processing-job-input", refId: "job_1", sourceTurnId: "turn_old" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "completed", threadId: payload.threadId, turnId: payload.turnId, ownerResult: { status: "completed" } };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { status: "submitted", threadId: payload.threadId, turnId: "turn_new" };
      },
    },
    jobStore: {
      getJob: (jobId) => jobs.get(jobId) ?? null,
      updateJob: (jobId, patch) => {
        calls.push({ type: "updateJob", jobId, patch });
        const next = { ...(jobs.get(jobId) ?? {}), ...patch };
        jobs.set(jobId, next);
        return next;
      },
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_job/retry", {});
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error, "active_turn_retry_source_not_canceled");
    assert.deepEqual(calls.map((call) => call.type), ["cancel"]);
    assert.equal(jobs.get("job_1").status, "processing");
    assert.equal(jobs.get("job_1").agentRun.turnId, "turn_old");
  } finally {
    await closeServer(server);
  }
});

test("active turn retry new thread releases newly acquired lease when start fails", async () => {
  const calls = [];
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "failed",
    stage: "shot.boundary.turn_started",
    progress: 80,
    activeTurnReplay: { inputs: [{ type: "text", text: "retry job", text_elements: [] }] },
    agentRun: {
      threadId: "thread_old",
      turnId: "turn_old",
      currentAttemptId: "attempt_old",
      status: "canceled",
    },
  }]]);
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_old",
        ownerType: "processing-job",
        ownerId: "job_1",
        currentAttemptId: "attempt_old",
        stageName: "shot.boundary.turn_started",
        replayRef: { type: "processing-job-input", refId: "job_1", sourceTurnId: "turn_old" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        throw Object.assign(new Error("start failed"), { code: "appserver_turn_start_failed", statusCode: 502 });
      },
    },
    jobStore: {
      getJob: (jobId) => jobs.get(jobId) ?? null,
      updateJob: (jobId, patch) => {
        calls.push({ type: "updateJob", jobId, patch });
        jobs.set(jobId, { ...jobs.get(jobId), ...patch });
      },
    },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { workspaceRoot: "C:/workspace" } }),
      acquireLease: async (payload) => {
        calls.push({ type: "acquire", payload });
        return { lease_id: "lease_new", thread_id: "thread_new" };
      },
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_job/retry", { mode: "new_thread", role: "script-segment-analyzer" });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "acquire", "start", "release"]);
    assert.equal(calls[3].payload.leaseId, "lease_new");
  } finally {
    await closeServer(server);
  }
});

test("active turn retry new thread releases newly acquired lease when start returns failure", async () => {
  const calls = [];
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "failed",
    stage: "shot.boundary.turn_started",
    progress: 80,
    activeTurnReplay: { inputs: [{ type: "text", text: "retry job", text_elements: [] }] },
    agentRun: {
      threadId: "thread_old",
      turnId: "turn_old",
      currentAttemptId: "attempt_old",
      status: "canceled",
    },
  }]]);
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_old",
        ownerType: "processing-job",
        ownerId: "job_1",
        currentAttemptId: "attempt_old",
        stageName: "shot.boundary.turn_started",
        replayRef: { type: "processing-job-input", refId: "job_1", sourceTurnId: "turn_old" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { ok: false, error: "appserver_turn_start_failed", message: "start returned failed" };
      },
    },
    jobStore: {
      getJob: (jobId) => jobs.get(jobId) ?? null,
      updateJob: (jobId, patch) => {
        calls.push({ type: "updateJob", jobId, patch });
        jobs.set(jobId, { ...jobs.get(jobId), ...patch });
      },
    },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { workspaceRoot: "C:/workspace" } }),
      acquireLease: async (payload) => {
        calls.push({ type: "acquire", payload });
        return { lease_id: "lease_new", thread_id: "thread_new" };
      },
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_job/retry", { mode: "new_thread", role: "script-segment-analyzer" });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "acquire", "start", "release"]);
    assert.equal(calls[3].payload.leaseId, "lease_new");
    assert.equal(jobs.get("job_1").status, "failed");
    assert.equal(jobs.get("job_1").agentRun.turnId, "turn_old");
  } finally {
    await closeServer(server);
  }
});

test("function slot auto-run enqueues deterministic storyboard pipeline", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-auto-run-active-turn-"));
  const calls = [];
  const server = createServer({
    rootDir,
    staticWorkbench: { handle: () => false },
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    shotStoryboardAutoPipelineService: {
      enqueue: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          processingJobId: "job_auto",
          sampleVideoId: payload.sampleVideoId,
          traceId: "trace_auto",
          runId: "run_auto",
          stageId: "stage_auto",
          artifactId: "artifact_auto",
          parentArtifactId: payload.parentArtifactId,
          status: "processing",
          role: "shot-storyboard-prep",
          message: "pipeline started",
        };
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/function-slot-workflow/storyboard-prep/auto-run", {
      sampleVideoId: "sample_auto",
      restructureFinalPath: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md",
      parentArtifactId: "artifact_parent",
      confirmationId: "confirm_1",
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.processingJobId, "job_auto");
    assert.equal(response.body.artifactId, "artifact_auto");
    assert.equal(response.body.status, "processing");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sampleVideoId, "sample_auto");
    assert.equal(calls[0].restructureFinalPath, "Artifacts/FunctionSlotRestructure/demo/restructure.final.md");
    assert.equal(calls[0].parentArtifactId, "artifact_parent");
    assert.equal(calls[0].confirmationId, "confirm_1");
  } finally {
    await closeServer(server);
  }
});

test("function slot auto-run rejects artifact-only source before pipeline enqueue", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-auto-run-thread-mismatch-"));
  const calls = [];
  const server = createServer({
    rootDir,
    staticWorkbench: { handle: () => false },
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/auto-run-thread-mismatch.json" }),
    },
    shotStoryboardAutoPipelineService: {
      enqueue: async (payload) => {
        calls.push(payload);
        throw new Error("pipeline should not start without restructureFinalPath");
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/function-slot-workflow/storyboard-prep/auto-run", {
      sampleVideoId: "sample_auto",
      restructureArtifactId: "artifact_restructure",
      parentArtifactId: "artifact_parent",
      confirmationId: "confirm_1",
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "storyboard_prep_restructure_required");
    assert.deepEqual(calls, []);
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
  let storedBatch = { ...fakeBatch };
  const server = createServer({
    fullAnalysisBatchQueue: {
      createBatch: ({ files, fields }) => {
        calls.push({ type: "create", fileNames: files.map((file) => file.filename), maxConcurrentRuns: fields.maxConcurrentRuns });
        storedBatch = { ...fakeBatch };
        return storedBatch;
      },
      advance: async (batchRunId) => calls.push({ type: "advance", batchRunId }),
      getBatch: (batchRunId) => batchRunId === "batch_1" ? storedBatch : null,
      getLatestBatch: () => {
        storedBatch = { ...storedBatch, restored: true };
        return storedBatch;
      },
      getLatestActiveBatch: () => {
        storedBatch = { ...storedBatch, status: "running", restored: true };
        return storedBatch;
      },
      retryItem: (batchRunId, queueItemId) => {
        calls.push({ type: "retry", batchRunId, queueItemId });
        storedBatch = { ...storedBatch, status: "running" };
        return storedBatch;
      },
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

    const latestActive = await makeRequest(server, "GET", "/api/workflows/full-analysis/batch-runs/latest?active=true");
    assert.equal(latestActive.statusCode, 200);
    assert.equal(latestActive.body.batchRunId, "batch_1");
    assert.equal(latestActive.body.status, "running");
    assert.equal(latestActive.body.restored, true);

    const latest = await makeRequest(server, "GET", "/api/workflows/full-analysis/batch-runs/latest");
    assert.equal(latest.statusCode, 200);
    assert.equal(latest.body.batchRunId, "batch_1");
    assert.equal(latest.body.restored, true);

    const retry = await makeRequest(server, "POST", "/api/workflows/full-analysis/batch-runs/batch_1/items/item_1/retry");
    assert.equal(retry.statusCode, 202);
    assert.equal(retry.body.batchRunId, "batch_1");
    assert.deepEqual(calls, [
      { type: "create", fileNames: ["a.mp4", "b.mp4"], maxConcurrentRuns: "2" },
      { type: "advance", batchRunId: "batch_1" },
      { type: "advance", batchRunId: "batch_1" },
      { type: "advance", batchRunId: "batch_1" },
      { type: "retry", batchRunId: "batch_1", queueItemId: "item_1" },
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
