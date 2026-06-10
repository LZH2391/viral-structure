const {
  test,
  assert,
  once,
  fsPromises,
  os,
  path,
  createServer,
  maybeAutoReviewShotDialogue,
  reviewShotDialogueForConversation,
  makeRequest,
  closeServer,
  waitFor,
  sampleShotDesignFinalMarkdown,
} = require("./server-test.helpers");

test("auto dialogue review skips duplicate while same shot design review is in progress", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-agent-chat-shot-dialogue-dedupe-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "shot-demo");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(path.join(planDir, "shot-design.final.md"), sampleShotDesignFinalMarkdown(), "utf8");

  let finishReview;
  const reviewTurns = [];
  const releases = [];
  const conversation = {
    conversationId: "conversation_shot_design",
    revision: 3,
    source: "direct",
    role: "function-slot-shot-design",
    status: "active",
    threadId: "thread_shot_design",
    latestTurnId: "turn_shot_1",
    messages: [],
  };
  const handlers = {
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/dialogue-review.json" }),
    },
    threadPool: {
      ensureRoleReady: async (role) => ({ ok: true, status: { role, skillPath: "dialogue-reviewer/SKILL.md" } }),
      acquireLease: async ({ role, ownerId }) => ({ ok: true, role, ownerId, thread_id: "thread_dialogue_review", lease_id: "lease_dialogue_review" }),
      releaseLease: async (payload) => {
        releases.push(payload);
        return { ok: true };
      },
    },
    appServer: {
      runTurnWithInputs: async (payload) => {
        reviewTurns.push(payload);
        await new Promise((resolve) => { finishReview = resolve; });
        return {
          threadId: payload.threadId,
          turnId: "turn_dialogue_review_1",
          status: "completed",
          finalMessage: JSON.stringify({ decision: "pass", reason: "台词自然", issues: [] }),
        };
      },
    },
    agentConversationStore: {
      get: async (conversationId) => conversationId === conversation.conversationId ? conversation : null,
    },
  };
  const payload = {
    status: "completed",
    turnId: "turn_shot_1",
    finalMessage: "已生成并落盘：Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md",
  };
  const traceContext = { traceId: "trace_dialogue", runId: "run_dialogue", stageId: "stage_dialogue" };

  const first = maybeAutoReviewShotDialogue({
    payload,
    handlers,
    traceContext,
    conversationId: conversation.conversationId,
  });
  await waitFor(() => reviewTurns.length === 1);
  const second = await maybeAutoReviewShotDialogue({
    payload,
    handlers,
    traceContext,
    conversationId: conversation.conversationId,
  });
  finishReview();
  const firstResult = await first;

  assert.equal(second.status, "skipped_in_progress");
  assert.equal(second.trigger, "review_in_progress");
  assert.equal(firstResult.status, "processed");
  assert.equal(reviewTurns.length, 1);
  assert.equal(releases.length, 1);
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
