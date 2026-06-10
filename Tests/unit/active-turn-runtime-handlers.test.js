const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createActiveTurnOwnerHandlers } = require("../../Apps/Api/lib/active-turns/owner-handlers");
const { createActiveTurnRuntime } = require("../../Apps/Api/lib/active-turns/runtime");
const { createJobStore } = require("../../Apps/Api/lib/stores/job-store");
const { createAppServerTurnRunner } = require("../../Apps/Api/lib/analysis-runtime-v2/appserver-turn-runner");

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
