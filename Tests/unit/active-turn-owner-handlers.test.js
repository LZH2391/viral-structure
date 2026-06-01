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
