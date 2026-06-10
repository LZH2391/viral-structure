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
