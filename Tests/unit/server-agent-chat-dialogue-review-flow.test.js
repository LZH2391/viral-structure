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
  sampleRestructureFinalMarkdown,
  sampleShotDesignFinalMarkdown,
} = require("./server-test.helpers");

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
    assert.equal(conversations.get("conversation_shot_design").messages[0].slotAtomDisplay, undefined);
    assert.equal(conversations.get("conversation_shot_design").messages[1].id, "user-turn_dialogue_rework_auto_1");
    assert.equal(conversations.get("conversation_shot_design").messages[0].dialogueRoboticReview.fileFingerprint.path, "Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md");
  } finally {
    await closeServer(server);
  }
});

test("agent chat auto advance confirms and starts storyboard prep after dialogue review pass", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-auto-advance-confirm-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "auto-confirm");
  await fsPromises.mkdir(planDir, { recursive: true });
  await fsPromises.writeFile(path.join(planDir, "restructure.final.md"), sampleRestructureFinalMarkdown().replaceAll("auto-demo", "auto-confirm"), "utf8");
  await fsPromises.writeFile(path.join(planDir, "shot-design.final.md"), [
    "# Shot 设计",
    "",
    "| Shot | 台词 |",
    "|---|---|",
    "| shot_001 | 这瓶喷雾上脸很轻，夏天补一下也不黏。 |",
    "",
  ].join("\n"), "utf8");
  const conversations = new Map();
  conversations.set("conversation_restructure", {
    conversationId: "conversation_restructure",
    revision: 3,
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    threadId: "thread_restructure",
    latestTurnId: "turn_auto_shot",
    messages: [
      {
        id: "assistant-turn_slot",
        turnId: "turn_slot",
        role: "assistant",
        text: "已生成并落盘：Artifacts/FunctionSlotRestructure/auto-confirm/restructure.final.md",
        status: "completed",
      },
      {
        id: "user-turn_auto_shot",
        turnId: "turn_auto_shot",
        role: "user",
        text: [
          "自动推进：基于已完成的槽位方案完善具体 Shot 设计。",
          "sourceRestructureFinalPath: Artifacts/FunctionSlotRestructure/auto-confirm/restructure.final.md",
          "sourceTurnId: turn_slot",
        ].join("\n"),
        status: "completed",
        userInputOrigin: "auto_advance",
      },
    ],
  });
  const confirmations = [];
  const storyboardRuns = [];
  const server = createServer({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/auto-confirm.json" }),
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
      releaseLease: async () => ({ ok: true }),
    },
    appServer: {
      collectTurnResult: async () => ({
        threadId: "thread_restructure",
        turnId: "turn_auto_shot",
        status: "completed",
        finalMessage: "已生成并落盘：Artifacts/FunctionSlotRestructure/auto-confirm/shot-design.final.md",
      }),
      runTurnWithInputs: async (payload) => ({
        threadId: payload.threadId,
        turnId: "turn_dialogue_review_pass",
        status: "completed",
        finalMessage: JSON.stringify({
          decision: "pass",
          reason: "台词自然，可以进入确认。",
          issues: [],
        }),
      }),
    },
    shotStoryboardAutoPipelineService: {
      enqueue: async (payload) => {
        storyboardRuns.push(payload);
        return {
          artifactId: "artifact_storyboard_auto",
          traceId: "trace_storyboard_auto",
          runId: "run_storyboard_auto",
          stageId: "stage_storyboard_auto",
          status: "submitted",
        };
      },
    },
    agentConversationStore: {
      get: async (conversationId) => conversations.get(conversationId) ?? null,
      recordAssistantTurn: async ({ conversationId, turnId, text, status, dialogueRoboticReview }) => {
        const conversation = conversations.get(conversationId);
        conversation.messages.push({ id: `assistant-${turnId}`, turnId, role: "assistant", text, status, dialogueRoboticReview });
        conversation.revision += 1;
        return conversation;
      },
      confirmPlan: async (payload) => {
        confirmations.push(payload);
        const conversation = conversations.get(payload.conversationId);
        conversation.revision += 1;
        conversation.confirmedPlan = {
          status: payload.status ?? (payload.storyboardArtifact ? "completed" : "confirmed"),
          turnId: payload.turnId,
          confirmationId: payload.confirmationId,
          sourceRestructurePath: payload.sourceRestructurePath,
          sourceShotDesignPath: payload.sourceShotDesignPath,
          storyboardArtifact: payload.storyboardArtifact ?? null,
        };
        return conversation;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const collected = await makeRequest(server, "GET", "/api/agent-chat/threads/thread_restructure/turns/turn_auto_shot?conversationId=conversation_restructure");

    assert.equal(collected.statusCode, 200);
    assert.equal(collected.body.autoDialogueRoboticReview.status, "processed");
    assert.equal(collected.body.autoDialogueRoboticReview.decision, "pass");
    assert.equal(collected.body.autoAdvanceConfirmation.ok, true);
    assert.equal(collected.body.autoAdvanceConfirmation.status, "storyboard_processing");
    assert.equal(confirmations.length, 2);
    assert.equal(confirmations[0].note.includes("自动推进"), true);
    assert.equal(confirmations[1].storyboardArtifact.artifactId, "artifact_storyboard_auto");
    assert.equal(storyboardRuns.length, 1);
    assert.equal(storyboardRuns[0].restructureFinalPath, "Artifacts/FunctionSlotRestructure/auto-confirm/restructure.final.md");
    assert.equal(storyboardRuns[0].shotDesignFinalPath, "Artifacts/FunctionSlotRestructure/auto-confirm/shot-design.final.md");
    assert.equal(storyboardRuns[0].parentArtifactId, "turn_auto_shot");
    assert.equal(storyboardRuns[0].runPdfAgent, false);
  } finally {
    await closeServer(server);
    await fsPromises.rm(rootDir, { recursive: true, force: true });
  }
});
