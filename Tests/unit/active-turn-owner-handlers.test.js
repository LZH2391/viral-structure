const test = require("node:test");
const assert = require("node:assert/strict");
const { createActiveTurnOwnerHandlers } = require("../../Apps/Api/lib/active-turns/owner-handlers");

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
