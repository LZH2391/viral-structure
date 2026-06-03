const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createActiveTurnOwnerHandlers } = require("../../Apps/Api/lib/active-turns/owner-handlers");
const { createActiveTurnRuntime } = require("../../Apps/Api/lib/active-turns/runtime");
const { createJobStore } = require("../../Apps/Api/lib/stores/job-store");
const { createAppServerTurnRunner } = require("../../Apps/Api/lib/analysis-runtime-v2/appserver-turn-runner");

test("processing job owner cancel updates only current agent turn", async () => {
  const updates = [];
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "processing",
    agentRun: { turnId: "turn_current", status: "collecting" },
  }]]);
  const handlers = createActiveTurnOwnerHandlers({
    jobStore: {
      getJob: (jobId) => jobs.get(jobId),
      updateJob: (jobId, patch) => {
        updates.push({ jobId, patch });
        jobs.set(jobId, { ...jobs.get(jobId), ...patch });
      },
    },
  });

  const stale = await handlers.onCancel({ ownerType: "processing-job", ownerId: "job_1", turnId: "turn_old", currentAttemptId: "old", stageName: "stage.old" }, { status: "canceled" });
  assert.equal(stale.status, "stale");
  assert.equal(updates.length, 0);

  const current = await handlers.onCancel({ ownerType: "processing-job", ownerId: "job_1", turnId: "turn_current", currentAttemptId: "turn_current", stageName: "stage.current" }, { status: "canceled" });
  assert.equal(current.status, "canceled");
  assert.equal(updates[0].patch.agentRun.status, "canceled");
  assert.equal(updates[0].patch.agentRun.turnId, "turn_current");
  assert.equal(updates[0].patch.errorSummary.code, "active_turn_canceled");
});

test("workflow stage owner updates only matching active turn attempt", async () => {
  const calls = [];
  const handlers = createActiveTurnOwnerHandlers({
    workflowRunStore: {
      updateStageTurnState: (workflowRunId, payload) => {
        calls.push({ workflowRunId, payload });
        if (payload.currentAttemptId !== "attempt_current") return { status: "stale" };
        return { status: payload.status, workflowRunId, turnId: payload.turnId };
      },
    },
  });

  const stale = await handlers.onCollect({ ownerType: "workflow-stage", ownerId: "workflow_1", turnId: "turn_old", currentAttemptId: "attempt_old", stageName: "stage" }, { status: "completed" });
  assert.equal(stale.status, "stale");

  const current = await handlers.onCollect({ ownerType: "workflow-stage", ownerId: "workflow_1", turnId: "turn_current", currentAttemptId: "attempt_current", stageName: "stage" }, { status: "completed" });
  assert.equal(current.status, "completed");
  assert.equal(calls.length, 2);
});

test("workflow stage validation rejects stale turn even when attempt matches", async () => {
  const handlers = createActiveTurnOwnerHandlers({
    workflowRunStore: {
      getRun: () => ({
        workflowRunId: "workflow_1",
        stages: [{
          key: "scriptSegment",
          status: "running",
          activeTurn: { turnId: "turn_current", currentAttemptId: "attempt_shared" },
        }],
      }),
    },
  });

  const stale = await handlers.validateActiveBinding({
    ownerType: "workflow-stage",
    ownerId: "workflow_1",
    turnId: "turn_old",
    currentAttemptId: "attempt_shared",
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "stale");

  const current = await handlers.validateActiveBinding({
    ownerType: "workflow-stage",
    ownerId: "workflow_1",
    turnId: "turn_current",
    currentAttemptId: "attempt_shared",
  });
  assert.equal(current.ok, true);
});

test("agent chat owner cancel writes conversation only for current turn", async () => {
  const calls = [];
  const handlers = createActiveTurnOwnerHandlers({
    agentConversationStore: {
      get: async () => ({ conversationId: "conversation_1", latestTurnId: "turn_current" }),
      recordTurnStopped: async (payload) => calls.push(payload),
    },
  });

  const stale = await handlers.onCancel({ ownerType: "agent-chat", ownerId: "conversation_1", turnId: "turn_old", currentAttemptId: "turn_old" }, { status: "canceled" });
  assert.equal(stale.status, "stale");
  assert.equal(calls.length, 0);

  const current = await handlers.onCancel({ ownerType: "agent-chat", ownerId: "conversation_1", turnId: "turn_current", currentAttemptId: "turn_current" }, { status: "canceled" });
  assert.equal(current.status, "canceled");
  assert.equal(calls[0].conversationId, "conversation_1");
  assert.equal(calls[0].turnId, "turn_current");
});

test("runtime list prunes orphan and stale active bindings before projection", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-active-turn-reconcile-"));
  const store = { runtimeRoot: path.join(root, "Runtime") };
  try {
    const runtime = createActiveTurnRuntime({
      store,
      appServer: {},
      ownerHandlers: createActiveTurnOwnerHandlers({
        agentConversationStore: {
          get: async (conversationId) => {
            if (conversationId === "conversation_current") return { conversationId, status: "active", latestTurnId: "turn_current" };
            if (conversationId === "conversation_stale") return { conversationId, status: "active", latestTurnId: "turn_latest" };
            return null;
          },
        },
      }),
    });
    await runtime.register({
      threadId: "thread_orphan",
      turnId: "turn_orphan",
      ownerType: "agent-chat",
      ownerId: "conversation_missing",
      currentAttemptId: "turn_orphan",
      stageName: "agentChat.turn.submit",
      replayRef: { type: "agent-chat-message", refId: "user-turn_orphan" },
      status: "submitted",
    });
    await runtime.register({
      threadId: "thread_stale",
      turnId: "turn_stale",
      ownerType: "agent-chat",
      ownerId: "conversation_stale",
      currentAttemptId: "turn_stale",
      stageName: "agentChat.turn.submit",
      replayRef: { type: "agent-chat-message", refId: "user-turn_stale" },
      status: "submitted",
    });
    await runtime.register({
      threadId: "thread_current",
      turnId: "turn_current",
      ownerType: "agent-chat",
      ownerId: "conversation_current",
      currentAttemptId: "turn_current",
      stageName: "agentChat.turn.submit",
      replayRef: { type: "agent-chat-message", refId: "user-turn_current" },
      status: "submitted",
    });

    const active = await runtime.listActive();
    assert.deepEqual(active.map((binding) => binding.turnId), ["turn_current"]);
    assert.equal(await runtime.getByTurnId("turn_orphan"), null);
    assert.equal(await runtime.getByTurnId("turn_stale"), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runtime keeps active binding when terminal collect activity regresses", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-active-turn-regressed-terminal-"));
  const store = { runtimeRoot: path.join(root, "Runtime") };
  const ownerCalls = [];
  try {
    const runtime = createActiveTurnRuntime({
      store,
      appServer: {
        collectTurnResult: async () => ({
          ok: true,
          threadId: "thread_1",
          turnId: "turn_1",
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
      ownerHandlers: {
        onCollect: async (...args) => {
          ownerCalls.push(args);
          return { status: "completed" };
        },
      },
    });
    await runtime.register({
      threadId: "thread_1",
      turnId: "turn_1",
      ownerType: "agent-chat",
      ownerId: "conversation_1",
      currentAttemptId: "turn_1",
      stageName: "agentChat.turn.submit",
      replayRef: { type: "agent-chat-message", refId: "user-turn_1" },
      status: "running",
    });
    await runtime.markCollectResult({
      turnId: "turn_1",
      result: {
        ok: false,
        threadId: "thread_1",
        turnId: "turn_1",
        status: "inProgress",
        turnActivity: {
          status: "inProgress",
          itemCount: 40,
          effectiveItemCount: 40,
          latestItemType: "tool_call",
        },
      },
    });

    const collected = await runtime.collect({ workspaceRoot: root, threadId: "thread_1", turnId: "turn_1" });
    assert.equal(collected.status, "in_progress");
    assert.equal(collected.terminalConfidence, "uncertain");
    assert.equal(collected.statusReason, "terminal_activity_regressed");
    assert.equal(collected.finalMessage, null);
    assert.equal(ownerCalls.length, 0);
    const active = await runtime.getByTurnId("turn_1");
    assert.equal(active.status, "in_progress");
    assert.equal(active.lastResultSummary.turnActivity.itemCount, 18);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runtime startup recovery collects terminal turns, cancels missing turns, and keeps running turns", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-active-turn-startup-recovery-"));
  const store = { runtimeRoot: path.join(root, "Runtime") };
  const collectCalls = [];
  const ownerCalls = [];
  try {
    const runtime = createActiveTurnRuntime({
      store,
      appServer: {
        collectTurnResult: async (payload) => {
          collectCalls.push(payload);
          if (payload.turnId === "turn_completed") return { status: "completed", threadId: payload.threadId, turnId: payload.turnId, finalMessage: "done" };
          if (payload.turnId === "turn_missing") throw new Error("unknown turn");
          return { status: "running", threadId: payload.threadId, turnId: payload.turnId };
        },
      },
      ownerHandlers: {
        validateActiveBinding: async () => ({ ok: true }),
        onCollect: async (binding, result) => ownerCalls.push({ type: "collect", turnId: binding.turnId, status: result.status }),
        onCancel: async (binding, result) => ownerCalls.push({ type: "cancel", turnId: binding.turnId, status: result.status }),
      },
    });
    await runtime.register({
      workspaceRoot: "C:\\role-workspace",
      threadId: "thread_completed",
      turnId: "turn_completed",
      ownerType: "agent-chat",
      ownerId: "conversation_completed",
      currentAttemptId: "turn_completed",
      stageName: "agentChat.turn.submit",
      replayRef: { type: "agent-chat-message", refId: "user-turn_completed" },
      status: "running",
    });
    await runtime.register({
      threadId: "thread_missing",
      turnId: "turn_missing",
      ownerType: "agent-chat",
      ownerId: "conversation_missing",
      currentAttemptId: "turn_missing",
      stageName: "agentChat.turn.submit",
      replayRef: { type: "agent-chat-message", refId: "user-turn_missing" },
      status: "running",
    });
    await runtime.register({
      threadId: "thread_running",
      turnId: "turn_running",
      ownerType: "agent-chat",
      ownerId: "conversation_running",
      currentAttemptId: "turn_running",
      stageName: "agentChat.turn.submit",
      replayRef: { type: "agent-chat-message", refId: "user-turn_running" },
      status: "running",
    });

    const summary = await runtime.recoverActiveBindings({ workspaceRoot: root, timeoutSeconds: 2 });
    const active = await runtime.listActive();

    assert.deepEqual(summary, { checked: 3, collected: 1, canceled: 1, kept: 1, removed: 0, failed: 0 });
    assert.deepEqual(active.map((binding) => binding.turnId), ["turn_running"]);
    assert.equal(collectCalls.find((call) => call.turnId === "turn_completed").workspaceRoot, "C:\\role-workspace");
    const byCallKey = (a, b) => `${a.type}:${a.turnId}`.localeCompare(`${b.type}:${b.turnId}`);
    assert.deepEqual([...ownerCalls].sort(byCallKey), [
      { type: "collect", turnId: "turn_completed", status: "completed" },
      { type: "cancel", turnId: "turn_missing", status: "canceled" },
    ].sort(byCallKey));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runtime cancel falls back to terminal collect when appserver cancel errors", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-active-turn-cancel-terminal-"));
  const store = { runtimeRoot: path.join(root, "Runtime") };
  const calls = [];
  try {
    const runtime = createActiveTurnRuntime({
      store,
      appServer: {
        cancelTurn: async () => {
          const error = new Error("request failed: turn/cancel");
          error.code = "appserver_bridge_failed";
          throw error;
        },
        collectTurnResult: async (payload) => {
          calls.push({ type: "collect", payload });
          return { status: "completed", threadId: payload.threadId, turnId: payload.turnId };
        },
      },
      ownerHandlers: {
        onCancel: async (binding, result) => {
          calls.push({ type: "cancelOwner", binding, result });
          return { status: "canceled" };
        },
      },
    });
    await runtime.register({
      threadId: "thread_1",
      turnId: "turn_1",
      ownerType: "processing-job",
      ownerId: "job_1",
      currentAttemptId: "attempt_1",
      stageName: "stage",
      replayRef: { type: "processing-job-input", refId: "job_1" },
      status: "running",
    });

    const result = await runtime.cancel({ workspaceRoot: root, threadId: "thread_1", turnId: "turn_1" });
    assert.equal(result.status, "completed");
    assert.deepEqual(calls.map((call) => call.type), ["collect"]);
    assert.equal(await runtime.getByTurnId("turn_1"), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runtime cancel fallback collect writes successful terminal result through collect owner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-active-turn-cancel-collect-owner-"));
  const store = { runtimeRoot: path.join(root, "Runtime") };
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "processing",
    agentRun: { turnId: "turn_1", currentAttemptId: "attempt_1", status: "collecting" },
  }]]);
  try {
    const runtime = createActiveTurnRuntime({
      store,
      appServer: {
        cancelTurn: async () => {
          throw new Error("bridge timeout while canceling");
        },
        collectTurnResult: async (payload) => ({ status: "completed", threadId: payload.threadId, turnId: payload.turnId }),
      },
      ownerHandlers: createActiveTurnOwnerHandlers({
        jobStore: {
          getJob: (jobId) => jobs.get(jobId),
          updateJob: (jobId, patch) => jobs.set(jobId, { ...jobs.get(jobId), ...patch }),
        },
      }),
    });
    await runtime.register({
      threadId: "thread_1",
      turnId: "turn_1",
      ownerType: "processing-job",
      ownerId: "job_1",
      currentAttemptId: "attempt_1",
      stageName: "stage",
      replayRef: { type: "processing-job-input", refId: "job_1" },
      status: "running",
    });

    const result = await runtime.cancel({ workspaceRoot: root, threadId: "thread_1", turnId: "turn_1" });

    assert.equal(result.status, "completed");
    assert.equal(result.ownerResult.status, "completed");
    assert.equal(jobs.get("job_1").status, "processing");
    assert.equal(jobs.get("job_1").agentRun.status, "completed");
    assert.equal(jobs.get("job_1").errorSummary, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runtime cancel rejects failed cancel result without marking owner canceled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-active-turn-cancel-failed-result-"));
  const store = { runtimeRoot: path.join(root, "Runtime") };
  const ownerCalls = [];
  try {
    const runtime = createActiveTurnRuntime({
      store,
      appServer: {
        cancelTurn: async () => ({ ok: false, error: "appserver_turn_cancel_failed", message: "cancel rejected" }),
        collectTurnResult: async (payload) => ({ status: "running", threadId: payload.threadId, turnId: payload.turnId }),
      },
      ownerHandlers: {
        onCancel: async (binding, result) => ownerCalls.push({ binding, result }),
      },
    });
    await runtime.register({
      threadId: "thread_1",
      turnId: "turn_1",
      ownerType: "processing-job",
      ownerId: "job_1",
      currentAttemptId: "attempt_1",
      stageName: "stage",
      replayRef: { type: "processing-job-input", refId: "job_1" },
      status: "running",
    });

    await assert.rejects(
      () => runtime.cancel({ workspaceRoot: root, threadId: "thread_1", turnId: "turn_1" }),
      { code: "appserver_turn_cancel_failed" },
    );

    assert.equal(ownerCalls.length, 0);
    assert.equal((await runtime.getByTurnId("turn_1")).status, "running");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runtime collect rejects mismatched turn result without touching owner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-active-turn-collect-mismatch-"));
  const store = { runtimeRoot: path.join(root, "Runtime") };
  const ownerCalls = [];
  try {
    const runtime = createActiveTurnRuntime({
      store,
      appServer: {
        collectTurnResult: async (payload) => ({ status: "completed", threadId: payload.threadId, turnId: "turn_other" }),
      },
      ownerHandlers: {
        onCollect: async (binding, result) => ownerCalls.push({ binding, result }),
      },
    });
    await runtime.register({
      threadId: "thread_1",
      turnId: "turn_1",
      ownerType: "processing-job",
      ownerId: "job_1",
      currentAttemptId: "attempt_1",
      stageName: "stage",
      replayRef: { type: "processing-job-input", refId: "job_1" },
      status: "running",
    });

    await assert.rejects(
      () => runtime.collect({ workspaceRoot: root, threadId: "thread_1", turnId: "turn_1" }),
      { code: "appserver_turn_collect_mismatch" },
    );

    assert.equal(ownerCalls.length, 0);
    assert.equal((await runtime.getByTurnId("turn_1")).status, "running");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("analysis turn runner registers active binding and terminal collect writes current processing job", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-active-turn-runner-"));
  const store = { runtimeRoot: path.join(root, "Runtime") };
  const jobStore = createJobStore({ filePath: path.join(store.runtimeRoot, "Jobs", "active-jobs.json") });
  const job = jobStore.createJob({ sampleVideoId: "sample_1", traceId: "trace_runner" });
  jobStore.updateJob(job.jobId, {
    status: "processing",
    agentRun: {
      turnId: "turn_runner",
      currentAttemptId: `${job.jobId}:turn_runner`,
      status: "collecting",
    },
  });
  const runtime = createActiveTurnRuntime({
    store,
    appServer: {
      async startTurnWithInputs({ threadId }) {
        return { status: "submitted", threadId, turnId: "turn_runner" };
      },
      async collectTurnResult({ threadId, turnId }) {
        return { status: "completed", threadId, turnId, finalMessage: "done" };
      },
    },
    ownerHandlers: createActiveTurnOwnerHandlers({ jobStore }),
  });
  const runner = createAppServerTurnRunner({
    role: "test-role",
    codedError: (code, message, payload) => Object.assign(new Error(message), { code, debugPayload: payload }),
    collectFailedMessage: "collect failed",
    collectTimeoutMessage: "collect timeout",
  });

  await runner.executeAnalyzeTurn({
    context: {
      sampleVideoId: "sample_1",
      job,
      traceContext: { traceId: "trace_runner", runId: "run_runner", stageId: "stage_runner" },
      activeStage: { stageName: "test.analyze", artifactId: "artifact_runner", parentArtifactId: "artifact_parent" },
      artifactId: "artifact_runner",
      agentRun: { turnId: "turn_runner" },
    },
    turnInputs: { promptTemplateId: "prompt_test", inputs: [{ type: "text", text: "safe" }] },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { role: "test-role", readyForLeases: true, canAcquire: true } }),
      acquireLease: async () => ({ lease_id: "lease_runner", thread_id: "thread_runner" }),
    },
    appServer: null,
    activeTurnRuntime: runtime,
    rootDir: root,
    pollIntervalMs: 1,
    collectIdleTimeoutMs: 1000,
    collectHardTimeoutMs: 1000,
  });

  assert.equal(jobStore.getJob(job.jobId).agentRun.status, "completed");
  assert.deepEqual(await runtime.listActive(), []);
});

test("analysis turn runner direct collect ignores mismatched turn before marking active turn", async () => {
  const markCalls = [];
  const runner = createAppServerTurnRunner({
    role: "test-role",
    codedError: (code, message, payload) => Object.assign(new Error(message), { code, debugPayload: payload }),
    collectFailedMessage: "collect failed",
    collectTimeoutMessage: "collect timeout",
  });

  await assert.rejects(
    () => runner.collectTurnToCompletion({
      appServer: {
        collectTurnResult: async (payload) => ({
          status: "completed",
          threadId: payload.threadId,
          turnId: "turn_other",
          finalMessage: "wrong turn",
        }),
      },
      activeTurnRuntime: {
        markCollectResult: async (payload) => markCalls.push(payload),
      },
      rootDir: "C:/workspace",
      threadId: "thread_1",
      turnId: "turn_expected",
      pollIntervalMs: 0,
      collectIdleTimeoutMs: 1,
      collectHardTimeoutMs: 1,
    }),
    { code: "appserver_turn_collect_timeout" },
  );

  assert.deepEqual(markCalls, []);
});

test("active turn runtime rejects failed start result before registering binding", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-active-turn-start-failed-"));
  const store = { runtimeRoot: path.join(root, "Runtime") };
  const runtime = createActiveTurnRuntime({
    store,
    appServer: {
      async startTurnWithInputs() {
        return { ok: false, error: "appserver_turn_start_failed", message: "start returned failed" };
      },
    },
  });

  try {
    await assert.rejects(
      () => runtime.start({
        workspaceRoot: root,
        threadId: "thread_1",
        inputs: [{ type: "text", text: "safe" }],
        binding: {
          ownerType: "processing-job",
          ownerId: "job_1",
          currentAttemptId: "attempt_1",
          stageName: "content.model",
          replayRef: { type: "processing-job-input", refId: "job_1" },
        },
      }),
      { code: "appserver_turn_start_failed" },
    );
    assert.deepEqual(await runtime.listActive(), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("active turn runtime keeps requested thread when start result reports a different thread unless enforced", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-active-turn-start-thread-mismatch-"));
  const store = { runtimeRoot: path.join(root, "Runtime") };
  const runtime = createActiveTurnRuntime({
    store,
    appServer: {
      async startTurnWithInputs() {
        return { ok: true, threadId: "thread_other", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  try {
    const started = await runtime.start({
      workspaceRoot: root,
      threadId: "thread_expected",
      inputs: [{ type: "text", text: "safe" }],
      binding: {
        ownerType: "processing-job",
        ownerId: "job_1",
        currentAttemptId: "attempt_1",
        stageName: "content.model",
        replayRef: { type: "processing-job-input", refId: "job_1" },
      },
    });
    assert.equal(started.threadId, "thread_other");
    assert.equal((await runtime.getByTurnId("turn_1")).threadId, "thread_expected");
    await assert.rejects(
      () => runtime.start({
        workspaceRoot: root,
        threadId: "thread_expected",
        inputs: [{ type: "text", text: "safe" }],
        enforceThreadId: true,
        binding: {
          ownerType: "processing-job",
          ownerId: "job_1",
          currentAttemptId: "attempt_1",
          stageName: "content.model",
          replayRef: { type: "processing-job-input", refId: "job_1" },
        },
      }),
      { code: "appserver_turn_start_thread_mismatch" },
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
