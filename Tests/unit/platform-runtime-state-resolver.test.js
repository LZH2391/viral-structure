const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntimeStateResolver, normalizeRuntimeStatus } = require("../../Apps/Api/lib/platform/runtime-state-resolver");

test("runtime state resolver maps workflow run state", async () => {
  const resolver = createRuntimeStateResolver({
    workflowRunStore: {
      getRun: () => ({
        workflowRunId: "workflow_1",
        status: "running",
        currentStageKeys: ["scriptSegment"],
        stages: [
          { key: "upload", stageName: "sample.ingest", status: "processed", artifactId: "artifact_sample" },
          { key: "scriptSegment", stageName: "script.segment.analyze", status: "running", stageId: "stage_script", childTraceId: "trace_script" },
          { key: "rhythmStructure", stageName: "rhythm.structure.analyze", status: "pending" },
        ],
        errorSummary: null,
      }),
    },
  });

  const state = await resolver.resolve({ resourceKind: "workflowRun", resourceId: "workflow_1" });

  assert.equal(state.status, "running");
  assert.equal(state.rawStatus, "running");
  assert.equal(state.progress, 33);
  assert.equal(state.currentStages.length, 1);
  assert.equal(state.currentStages[0].key, "scriptSegment");
  assert.equal(state.currentStages[0].traceId, "trace_script");
});

test("runtime state resolver maps job state and clamps progress", async () => {
  const resolver = createRuntimeStateResolver({
    jobStore: {
      getJob: () => ({
        jobId: "job_1",
        status: "processing",
        stage: "shot.boundary_merge",
        progress: 128,
        traceId: "trace_job",
        errorSummary: null,
      }),
    },
  });

  const state = await resolver.resolve({ resourceKind: "job", resourceId: "job_1" });

  assert.equal(state.status, "running");
  assert.equal(state.rawStatus, "processing");
  assert.equal(state.progress, 100);
  assert.equal(state.currentStages[0].stageName, "shot.boundary_merge");
  assert.equal(state.currentStages[0].traceId, "trace_job");
});

test("runtime state resolver maps active turn by binding id or turn id", async () => {
  const binding = {
    bindingId: "binding_1",
    turnId: "turn_1",
    status: "submitted",
    stageName: "function.slot.restructure",
    traceId: "trace_turn",
    runId: "run_turn",
    stageId: "stage_turn",
    artifactId: "artifact_turn",
    parentArtifactId: "artifact_parent",
  };
  const resolver = createRuntimeStateResolver({
    activeTurnRuntime: {
      getByBindingId: async (id) => id === "binding_1" ? binding : null,
      getByTurnId: async (id) => id === "turn_1" ? binding : null,
    },
  });

  const byBinding = await resolver.resolve({ resourceKind: "activeTurn", resourceId: "binding_1" });
  const byTurn = await resolver.resolve({ resourceKind: "activeTurn", resourceId: "turn_1" });

  assert.equal(byBinding.status, "queued");
  assert.equal(byBinding.rawStatus, "submitted");
  assert.equal(byBinding.resource.resourceId, "binding_1");
  assert.equal(byBinding.currentStages[0].artifactId, "artifact_turn");
  assert.equal(byTurn.resource.resourceId, "binding_1");
});

test("runtime status normalization preserves unknown statuses", () => {
  assert.equal(normalizeRuntimeStatus("cache_waiting"), "waiting");
  assert.equal(normalizeRuntimeStatus("cancelled"), "canceled");
  assert.equal(normalizeRuntimeStatus("custom_status"), "custom_status");
});
