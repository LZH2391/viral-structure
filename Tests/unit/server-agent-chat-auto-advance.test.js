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
  exists,
  sampleRestructureFinalMarkdown,
} = require("./server-test.helpers");

test("agent chat auto advance submits a shot design turn with source capsule metadata", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-auto-advance-submit-"));
  const conversation = {
    conversationId: "conversation_restructure",
    revision: 7,
    role: "function-slot-restructure",
    source: "threadpool-role",
    status: "active",
    threadId: "thread_restructure",
    workspaceRoot: rootDir,
    skillPath: "function-slot-restructure/SKILL.md",
    latestTurnId: "turn_slot",
    messages: [
      {
        id: "assistant-turn_slot",
        turnId: "turn_slot",
        role: "assistant",
        text: "已生成并落盘：Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md",
        status: "completed",
      },
    ],
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
        return { threadId: "thread_restructure", turnId: "turn_auto_shot", status: "submitted" };
      },
    },
    activeTurnRuntime: {
      register: async (binding) => {
        calls.push({ type: "activeTurn", payload: binding });
        return binding;
      },
    },
    agentConversationStore: {
      assertActive: async () => conversation,
      recordUserTurn: async (payload) => {
        calls.push({ type: "recordUser", payload });
        conversation.latestTurnId = payload.turnId;
        conversation.revision += 1;
        conversation.messages.push({
          id: `user-${payload.turnId}`,
          turnId: payload.turnId,
          role: "user",
          text: payload.text,
          status: "completed",
          userInputOrigin: payload.userInputOrigin,
          autoAdvanceKey: payload.autoAdvanceKey,
          sourceRestructurePath: payload.sourceRestructurePath,
          sourceRestructureFingerprint: payload.sourceRestructureFingerprint,
          sourceDisplayFingerprint: payload.sourceDisplayFingerprint,
        });
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/conversations/conversation_restructure/auto-advance", {
      threadId: "thread_restructure",
      sourceTurnId: "turn_slot",
      restructureFinalPath: "Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md",
      restructureFingerprint: { path: "Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md", size: 123, mtimeMs: 456 },
      displayFingerprint: { path: "Artifacts/FunctionSlotRestructure/auto-demo/display.json", size: 78, mtimeMs: 90 },
      parentArtifactId: "turn_slot",
      expectedRevision: 7,
      workspaceRoot: rootDir,
    });

    assert.equal(response.statusCode, 202);
    assert.equal(response.body.turnId, "turn_auto_shot");
    assert.equal(response.body.userTurnText, "继续完善 Shot 设计");
    assert.equal(calls.find((call) => call.type === "startTurn").payload.inputs[0].text, "继续完善 Shot 设计");
    assert.equal(calls.find((call) => call.type === "recordUser").payload.userInputOrigin, "auto_advance");
    assert.equal(Boolean(calls.find((call) => call.type === "recordUser").payload.autoAdvanceKey), true);
    assert.equal(calls.find((call) => call.type === "recordUser").payload.sourceDisplayFingerprint.path, "Artifacts/FunctionSlotRestructure/auto-demo/display.json");
    assert.equal(conversation.messages.at(-1).userInputOrigin, "auto_advance");
    assert.equal(calls.find((call) => call.type === "activeTurn").payload.parentArtifactId, "turn_slot");
  } finally {
    await closeServer(server);
    await fsPromises.rm(rootDir, { recursive: true, force: true });
  }
});

test("agent chat auto advance skips duplicate restructure fingerprint", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-auto-advance-dedupe-"));
  const conversation = {
    conversationId: "conversation_restructure",
    revision: 8,
    role: "function-slot-restructure",
    source: "threadpool-role",
    status: "active",
    threadId: "thread_restructure",
    workspaceRoot: rootDir,
    skillPath: "function-slot-restructure/SKILL.md",
    latestTurnId: "turn_auto_shot",
    messages: [
      {
        id: "user-turn_auto_shot",
        turnId: "turn_auto_shot",
        role: "user",
        text: "继续完善 Shot 设计",
        status: "completed",
        userInputOrigin: "auto_advance",
        sourceRestructurePath: "Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md",
        sourceRestructureFingerprint: { path: "Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md", size: 123, mtimeMs: 456 },
        sourceDisplayFingerprint: { path: "Artifacts/FunctionSlotRestructure/auto-demo/display.json", size: 78, mtimeMs: 90 },
      },
      {
        id: "assistant-turn_auto_shot",
        turnId: "turn_auto_shot",
        role: "assistant",
        text: "生成中",
        status: "running",
      },
    ],
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
        return { threadId: "thread_restructure", turnId: "turn_should_not_start", status: "submitted" };
      },
    },
    agentConversationStore: {
      assertActive: async () => conversation,
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/conversations/conversation_restructure/auto-advance", {
      threadId: "thread_restructure",
      sourceTurnId: "turn_slot",
      restructureFinalPath: "Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md",
      restructureFingerprint: { path: "Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md", size: 123, mtimeMs: 456 },
      displayFingerprint: { path: "Artifacts/FunctionSlotRestructure/auto-demo/display.json", size: 78, mtimeMs: 90 },
      parentArtifactId: "turn_slot",
      expectedRevision: 8,
      workspaceRoot: rootDir,
    });

    assert.equal(response.statusCode, 202);
    assert.equal(response.body.status, "skipped_duplicate");
    assert.equal(response.body.turnId, "turn_auto_shot");
    assert.equal(response.body.autoAdvanceState.status, "skipped_duplicate");
    assert.equal(calls.length, 0);
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

test("agent chat collect auto transforms multi-version restructure displays", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-restructure-multi-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "multi-display-demo");
  await fsPromises.mkdir(path.join(planDir, "versions", "V1_click"), { recursive: true });
  await fsPromises.mkdir(path.join(planDir, "versions", "V2_conversion"), { recursive: true });
  await fsPromises.writeFile(path.join(planDir, "restructure.final.md"), [
    "# 多版本索引",
    "",
    "| versionId | versionName | path |",
    "|---|---|---|",
    "| `V1_click` | 高点击版 | [restructure.final.md](versions/V1_click/restructure.final.md) |",
    "| `V2_conversion` | 高转化版 | [restructure.final.md](versions/V2_conversion/restructure.final.md) |",
  ].join("\n"), "utf8");
  await fsPromises.writeFile(path.join(planDir, "versions", "V1_click", "restructure.final.md"), sampleRestructureFinalMarkdown()
    .replaceAll("auto-demo", "multi-display-demo/versions/V1_click")
    .replaceAll("SUB_auto_demo", "SUB_click_demo"), "utf8");
  await fsPromises.writeFile(path.join(planDir, "versions", "V2_conversion", "restructure.final.md"), sampleRestructureFinalMarkdown()
    .replaceAll("auto-demo", "multi-display-demo/versions/V2_conversion")
    .replaceAll("SUB_auto_demo", "SUB_conversion_demo"), "utf8");
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
        finalMessage: "已生成并落盘：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/multi-display-demo/restructure.final.md)",
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
    assert.equal(collected.body.autoDisplayTransform.mode, "multi_version");
    assert.equal(collected.body.autoDisplayTransform.defaultVersionId, "V2_conversion");
    assert.equal(collected.body.autoDisplayTransform.slotAtomDisplays.length, 2);
    assert.deepEqual(collected.body.autoDisplayTransform.slotAtomDisplays.map((item) => item.versionName), ["高点击版", "高转化版"]);
    assert.equal(collected.body.autoDisplayTransform.slotAtomDisplays[0].slots[0].slotSubtypeId, "SUB_click_demo");
    assert.equal(collected.body.autoDisplayTransform.slotAtomDisplays[1].slots[0].slotSubtypeId, "SUB_conversion_demo");
    assert.equal(collected.body.autoDisplayTransform.slotAtomDisplay.versionId, "V2_conversion");
    assert.equal(conversations.get("conversation_restructure").messages[0].slotAtomDisplay.versionDisplays.length, 2);
    assert.equal(await exists(path.join(planDir, "versions", "V1_click", "restructure.display.json")), true);
    assert.equal(await exists(path.join(planDir, "versions", "V2_conversion", "restructure.display.json")), true);
  } finally {
    await closeServer(server);
  }
});
