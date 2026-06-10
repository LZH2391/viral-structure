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
  sampleShotDesignFinalMarkdown,
  sampleShotDesignDialogueFingerprint,
} = require("./server-test.helpers");

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

test("agent chat collect does not attach remembered review when later replies leave dialogue unchanged", async () => {
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
    assert.equal(conversations.get("conversation_shot_design").messages.at(-1).dialogueRoboticReview, null);
  } finally {
    await closeServer(server);
  }
});

test("agent chat timeline backfills token and compact events from codex rollout", async () => {
  const { createCodexRolloutReader } = require("../../Apps/Api/lib/observability/codex-rollout-reader");
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-rollout-agent-chat-"));
  const threadId = "019e8dc4-5633-79e0-ac38-6deb9d2a9003";
  const turnId = "019e8dc5-8b2d-7a42-b1d4-5f9dc845fa7d";
  const shortTurnId = "c845fa7d";
  const listedTurnIds = [];
  await writeRollout(tempRoot, threadId, [
    rolloutEvent("2026-06-03T13:56:39.801Z", "session_meta", { id: threadId }),
    rolloutEvent("2026-06-03T13:56:39.816Z", "event_msg", { type: "task_started", turn_id: turnId, model_context_window: 10000 }),
    rolloutEvent("2026-06-03T13:57:22.957Z", "response_item", { type: "function_call", name: "shell_command", call_id: "call_1", arguments: JSON.stringify({ command: "Get-ChildItem" }) }),
    rolloutEvent("2026-06-03T13:57:23.278Z", "event_msg", { type: "token_count", info: { last_token_usage: { input_tokens: 987, output_tokens: 13, total_tokens: 1000 }, model_context_window: 10000 } }),
    rolloutEvent("2026-06-03T13:57:24.000Z", "event_msg", { type: "context_compacted" }),
  ]);
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    codexRolloutReader: createCodexRolloutReader({ codexHome: tempRoot }),
    appServer: {
      readThread: async () => ({
        thread: {
          id: threadId,
          turns: [{
            id: turnId,
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
    const response = await makeRequest(server, "GET", `/api/agent-chat/threads/${threadId}/turns/${shortTurnId}/timeline`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(listedTurnIds, [turnId]);
    assert.equal(response.body.turnId, turnId);
    assert.equal(response.body.source, "thread/turns/items/list+codex-rollout");
    assert.deepEqual(response.body.items.map((item) => item.kind), ["agent_message", "tool_call", "token_usage", "context_compacted"]);
    assert.equal(response.body.activity.tokenUsage.inputTokens, 987);
    assert.equal(response.body.activity.tokenUsage.contextThresholdTokens, 8000);
  } finally {
    await closeServer(server);
  }
});
