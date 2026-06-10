const {
  test,
  assert,
  once,
  fsPromises,
  os,
  path,
  createHash,
  createServer,
  makeRequest,
  closeServer,
  exists,
  sampleRestructureFinalMarkdown,
} = require("./server-test.helpers");

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
