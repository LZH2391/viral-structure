const {
  test,
  assert,
  once,
  fsPromises,
  os,
  path,
  createServer,
  maybeAutoAuditMaterialGaps,
  makeRequest,
  buildMaterialGapMatrixFixture,
  buildMaterialGapAuditHandlers,
  closeServer,
} = require("./server-test.helpers");

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
    confirmPlan: async ({ conversationId, turnId, confirmationId, sourceRestructurePath, sourceShotDesignPath, displayArtifact, storyboardArtifact, status, expectedRevision }) => {
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
        status: status ?? (displayArtifact || storyboardArtifact ? "completed" : "confirmed"),
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

test("material gap audit repairs invalid matrix before creating conversation message", async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "material-gap-repair-"));
  try {
    const artifactDir = path.join(tempRoot, "Artifacts", "FunctionSlotRestructure", "case");
    await fsPromises.mkdir(artifactDir, { recursive: true });
    await fsPromises.writeFile(path.join(artifactDir, "restructure.final.md"), "# final\n", "utf8");
    await fsPromises.writeFile(path.join(artifactDir, "restructure.display.json"), "{}\n", "utf8");
    await fsPromises.writeFile(path.join(tempRoot, "material-pack.json"), JSON.stringify({ artifactId: "pack_1", schemaVersion: "user-material-pack.stable" }), "utf8");

    const createdMessages = [];
    const turns = [
      {
        status: "completed",
        turnId: "audit_turn",
        finalMessage: JSON.stringify(buildMaterialGapMatrixFixture({ missingMaterialTypes: [] })),
      },
      {
        status: "completed",
        turnId: "repair_turn",
        finalMessage: JSON.stringify(buildMaterialGapMatrixFixture({ missingMaterialTypes: ["usage_process_shot"] })),
      },
    ];
    const result = await maybeAutoAuditMaterialGaps({
      payload: { status: "completed", turnId: "turn_1" },
      traceContext: { runId: "run_1", traceId: "trace_1", stageId: "stage_1" },
      conversationId: "conversation_1",
      autoDisplayTransform: {
        artifactId: "artifact_display",
        restructureFinalPath: path.join(artifactDir, "restructure.final.md"),
        displayJsonPath: path.join(artifactDir, "restructure.display.json"),
        slotAtomDisplay: { status: "available" },
      },
      handlers: buildMaterialGapAuditHandlers({
        rootDir: tempRoot,
        createdMessages,
        turns,
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(createdMessages.length, 1);
    assert.equal(result.materialGapMatrix.validation.status, "passed");
    assert.equal(result.materialGapMatrix.validation.fallbackApplied, false);
    assert.equal(result.materialGapMatrix.repairAttemptCount, 1);
    assert.deepEqual(result.materialGapMatrix.rows[0].missingMaterialTypes, ["usage_process_shot"]);
    assert.equal(result.materialGapMatrix.turnId, "repair_turn");
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("material gap audit falls back after one failed repair", async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "material-gap-fallback-"));
  try {
    const artifactDir = path.join(tempRoot, "Artifacts", "FunctionSlotRestructure", "case");
    await fsPromises.mkdir(artifactDir, { recursive: true });
    await fsPromises.writeFile(path.join(artifactDir, "restructure.final.md"), "# final\n", "utf8");
    await fsPromises.writeFile(path.join(artifactDir, "restructure.display.json"), "{}\n", "utf8");
    await fsPromises.writeFile(path.join(tempRoot, "material-pack.json"), JSON.stringify({ artifactId: "pack_1", schemaVersion: "user-material-pack.stable" }), "utf8");

    const createdMessages = [];
    const invalid = buildMaterialGapMatrixFixture({ directSatisfaction: "missing", missingMaterialTypes: [] });
    const result = await maybeAutoAuditMaterialGaps({
      payload: { status: "completed", turnId: "turn_1" },
      traceContext: { runId: "run_1", traceId: "trace_1", stageId: "stage_1" },
      conversationId: "conversation_1",
      autoDisplayTransform: {
        artifactId: "artifact_display",
        restructureFinalPath: path.join(artifactDir, "restructure.final.md"),
        displayJsonPath: path.join(artifactDir, "restructure.display.json"),
        slotAtomDisplay: { status: "available" },
      },
      handlers: buildMaterialGapAuditHandlers({
        rootDir: tempRoot,
        createdMessages,
        turns: [
          { status: "completed", turnId: "audit_turn", finalMessage: JSON.stringify(invalid) },
          { status: "completed", turnId: "repair_turn", finalMessage: JSON.stringify(invalid) },
        ],
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(createdMessages.length, 1);
    assert.equal(result.materialGapMatrix.validation.status, "passed");
    assert.equal(result.materialGapMatrix.validation.fallbackApplied, true);
    assert.equal(result.materialGapMatrix.repairAttemptCount, 1);
    assert.deepEqual(result.materialGapMatrix.rows[0].missingMaterialTypes, ["critical_material_missing"]);
    assert.equal(result.materialGapMatrix.turnId, "audit_turn");
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
});
