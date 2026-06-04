const test = require("node:test");
const assert = require("node:assert/strict");
const { createActionRegistry } = require("../../Apps/Api/lib/platform/action-registry");

test("action registry declares workflow rerun action with stage enum", async () => {
  const registry = createActionRegistry({
    workflowRunStore: {
      getRun: () => ({
        workflowRunId: "workflow_1",
        sampleVideoId: "sample_1",
        stages: [
          { key: "upload", status: "processed" },
          { key: "scriptSegment", status: "processed" },
          { key: "rhythmStructure", status: "failed" },
        ],
      }),
    },
  });

  const result = await registry.listActions({ resourceKind: "workflowRun", resourceId: "workflow_1" });
  const rerun = result.actions.find((item) => item.actionKey === "workflow.stage.rerun");

  assert.ok(rerun);
  assert.equal(rerun.enabled, true);
  assert.deepEqual(rerun.inputSchema.properties.stageKey.enum, ["scriptSegment", "rhythmStructure"]);
  assert.equal(rerun.effects.createsArtifact, true);
  assert.equal(rerun.effects.mayInvalidateDownstream, true);
});

test("action registry disables job cache action when job is not cache waiting", async () => {
  const registry = createActionRegistry({
    jobStore: {
      getJob: () => ({ jobId: "job_1", status: "processing", stage: "script.segment.analyze" }),
    },
  });

  const result = await registry.listActions({ resourceKind: "job", resourceId: "job_1" });
  const action = result.actions.find((item) => item.actionKey === "job.cache.resolve");

  assert.equal(action.enabled, false);
  assert.equal(action.disabledReason, "job_cache_decision_unavailable");
});

test("action registry enables job cache action for cache waiting jobs", async () => {
  const registry = createActionRegistry({
    jobStore: {
      getJob: () => ({ jobId: "job_1", status: "cache_waiting", cachePrompt: { cacheKind: "script_segment" } }),
    },
  });

  const result = await registry.listActions({ resourceKind: "job", resourceId: "job_1" });
  const action = result.actions.find((item) => item.actionKey === "job.cache.resolve");

  assert.equal(action.enabled, true);
  assert.deepEqual(action.inputSchema.properties.decision.enum, ["reuse", "refresh"]);
});

test("action registry declares active turn actions", async () => {
  const registry = createActionRegistry({
    activeTurnRuntime: {
      getByBindingId: async () => ({
        bindingId: "binding_1",
        threadId: "thread_1",
        turnId: "turn_1",
      }),
    },
  });

  const result = await registry.listActions({ resourceKind: "activeTurn", resourceId: "binding_1" });
  const keys = result.actions.map((item) => item.actionKey);
  const stop = result.actions.find((item) => item.actionKey === "agent.turn.stop");
  const retry = result.actions.find((item) => item.actionKey === "agent.turn.retry");

  assert.deepEqual(keys, ["agent.turn.stop", "agent.turn.retry"]);
  assert.equal(stop.enabled, true);
  assert.equal(retry.enabled, false);
  assert.equal(retry.disabledReason, "active_turn_retry_requires_legacy_replay_route");
});

test("action registry declares conversation archive action", async () => {
  const registry = createActionRegistry({
    agentConversationStore: {
      get: async () => ({ conversationId: "conversation_1", status: "archived" }),
    },
  });

  const result = await registry.listActions({ resourceKind: "conversation", resourceId: "conversation_1" });
  const action = result.actions.find((item) => item.actionKey === "conversation.archive");

  assert.equal(action.enabled, false);
  assert.equal(action.disabledReason, "conversation_archive_unavailable");
});
