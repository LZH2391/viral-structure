const test = require("node:test");
const assert = require("node:assert/strict");
const { createCommandDispatcher } = require("../../Apps/Api/lib/platform/command-dispatcher");

test("command dispatcher reruns full-analysis workflow stage", async () => {
  const calls = [];
  const dispatcher = createCommandDispatcher({
    workflowRunStore: {
      getRun: () => ({ workflowRunId: "workflow_1", workflowKey: "full-analysis" }),
    },
    fullAnalysisWorkflowService: {
      rerunStage: async (payload) => {
        calls.push({ service: "full", payload });
        return buildRun(payload.workflowRunId, payload.stageKey);
      },
    },
  });

  const result = await dispatcher.execute({
    command: "workflow.stage.rerun",
    target: { resourceKind: "workflowRun", resourceId: "workflow_1" },
    options: { stageKey: "scriptSegment" },
  });

  assert.deepEqual(calls, [{ service: "full", payload: { workflowRunId: "workflow_1", stageKey: "scriptSegment" } }]);
  assert.equal(result.ok, true);
  assert.equal(result.command, "workflow.stage.rerun");
  assert.equal(result.stageId, "stage_scriptSegment");
  assert.equal(result.traceId, "trace_workflow");
});

test("command dispatcher reruns material-recognition workflow stage", async () => {
  const calls = [];
  const dispatcher = createCommandDispatcher({
    workflowRunStore: {
      getRun: () => ({ workflowRunId: "workflow_material", workflowKey: "material-recognition" }),
    },
    fullAnalysisWorkflowService: {
      rerunStage: async () => {
        throw new Error("full service should not be called");
      },
    },
    materialRecognitionWorkflowService: {
      rerunStage: async (payload) => {
        calls.push({ service: "material", payload });
        return buildRun(payload.workflowRunId, payload.stageKey);
      },
    },
  });

  const result = await dispatcher.execute({
    command: "workflow.stage.rerun",
    target: { resourceKind: "workflowRun", resourceId: "workflow_material" },
    options: { stageKey: "userMaterialTagger" },
  });

  assert.equal(calls[0].service, "material");
  assert.equal(result.stageId, "stage_userMaterialTagger");
});

test("command dispatcher refreshes sample by starting full-analysis workflow", async () => {
  const calls = [];
  const dispatcher = createCommandDispatcher({
    fullAnalysisWorkflowService: {
      startFromSample: async (payload) => {
        calls.push(payload);
        return {
          workflowRunId: "workflow_new",
          status: "running",
          runId: "run_new",
          traceId: "trace_new",
          stages: [{ key: "upload", stageId: "stage_upload", artifactId: "artifact_upload" }],
        };
      },
    },
  });

  const result = await dispatcher.execute({
    command: "sample.full_analysis.refresh",
    target: { resourceKind: "sample", resourceId: "sample_1" },
  });

  assert.deepEqual(calls, [{ sampleVideoId: "sample_1" }]);
  assert.equal(result.ok, true);
  assert.equal(result.command, "sample.full_analysis.refresh");
  assert.equal(result.traceId, "trace_new");
  assert.deepEqual(result.resourceRefs, [
    { resourceKind: "sample", resourceId: "sample_1" },
    { resourceKind: "workflowRun", resourceId: "workflow_new" },
  ]);
});

test("command dispatcher rejects unsupported commands", async () => {
  const dispatcher = createCommandDispatcher();

  await assert.rejects(
    () => dispatcher.execute({ command: "job.unknown", target: { resourceKind: "job", resourceId: "job_1" } }),
    { code: "platform_command_unsupported", statusCode: 400, retryable: false },
);
});

test("command dispatcher resolves job cache decisions through module registry", async () => {
  const calls = [];
  const advances = [];
  const dispatcher = createCommandDispatcher({
    jobStore: {
      getJob: () => ({ jobId: "job_1", status: "cache_waiting", cachePrompt: { cacheKind: "script_segment" }, traceId: "trace_job" }),
    },
    workflowRunStore: {
      listRuns: () => [
        { workflowRunId: "workflow_1", workflowKey: "full-analysis", stages: [{ key: "scriptSegment", childJobId: "job_1" }] },
      ],
    },
    fullAnalysisWorkflowService: {
      advance: async (workflowRunId) => {
        advances.push(workflowRunId);
      },
    },
    moduleRegistry: {
      resolveModuleCacheDecision: async (payload) => {
        calls.push(payload);
        return { jobId: payload.jobId, status: "processing", traceId: "trace_after_cache", artifactId: "artifact_cache" };
      },
    },
  });

  const result = await dispatcher.execute({
    command: "job.cache.resolve",
    target: { resourceKind: "job", resourceId: "job_1" },
    options: { decision: "refresh" },
  });

  assert.deepEqual(calls, [{ cacheKind: "script_segment", jobId: "job_1", decision: "refresh" }]);
  assert.deepEqual(advances, ["workflow_1"]);
  assert.equal(result.ok, true);
  assert.equal(result.command, "job.cache.resolve");
  assert.equal(result.status, "processing");
  assert.equal(result.traceId, "trace_after_cache");
  assert.equal(result.artifactId, "artifact_cache");
});

test("command dispatcher stops active turns through active turn runtime", async () => {
  const calls = [];
  const dispatcher = createCommandDispatcher({
    rootDir: "C:\\ByteDanceFullStack",
    activeTurnRuntime: {
      getByBindingId: async () => ({
        bindingId: "binding_1",
        threadId: "thread_1",
        turnId: "turn_1",
        traceId: "trace_turn",
        runId: "run_turn",
        stageId: "stage_turn",
        artifactId: "artifact_turn",
        parentArtifactId: "artifact_parent",
      }),
      cancel: async (payload) => {
        calls.push(payload);
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
    },
  });

  const result = await dispatcher.execute({
    command: "agent.turn.stop",
    target: { resourceKind: "activeTurn", resourceId: "binding_1" },
  });

  assert.equal(calls[0].threadId, "thread_1");
  assert.equal(calls[0].turnId, "turn_1");
  assert.deepEqual(calls[0].traceContext, {
    runId: "run_turn",
    traceId: "trace_turn",
    stageId: "stage_turn",
  });
  assert.equal(result.ok, true);
  assert.equal(result.command, "agent.turn.stop");
  assert.equal(result.status, "canceled");
  assert.equal(result.traceId, "trace_turn");
  assert.equal(result.artifactId, "artifact_turn");
});

test("command dispatcher archives conversations through conversation store", async () => {
  const calls = [];
  const dispatcher = createCommandDispatcher({
    agentConversationStore: {
      archive: async (conversationId, options) => {
        calls.push({ conversationId, options });
        return {
          conversationId,
          status: "archived",
          runId: "run_conversation",
          traceId: "trace_conversation",
          stageId: "stage_conversation",
          confirmedPlan: { displayArtifact: { artifactId: "artifact_display" } },
        };
      },
    },
  });

  const result = await dispatcher.execute({
    command: "conversation.archive",
    target: { resourceKind: "conversation", resourceId: "conversation_1" },
    expectedRevision: 3,
  });

  assert.deepEqual(calls, [{ conversationId: "conversation_1", options: { expectedRevision: 3 } }]);
  assert.equal(result.ok, true);
  assert.equal(result.status, "archived");
  assert.equal(result.artifactId, "artifact_display");
  assert.equal(result.traceId, "trace_conversation");
});

test("command dispatcher reports missing conversations", async () => {
  const dispatcher = createCommandDispatcher({
    agentConversationStore: {
      archive: async () => null,
    },
  });

  await assert.rejects(
    () => dispatcher.execute({
      command: "conversation.archive",
      target: { resourceKind: "conversation", resourceId: "conversation_missing" },
    }),
    { code: "conversation_not_found", statusCode: 404, retryable: false },
  );
});

test("command dispatcher validates workflow rerun input", async () => {
  const dispatcher = createCommandDispatcher({
    workflowRunStore: {
      getRun: () => ({ workflowRunId: "workflow_1", workflowKey: "full-analysis" }),
    },
  });

  await assert.rejects(
    () => dispatcher.execute({
      command: "workflow.stage.rerun",
      target: { resourceKind: "workflowRun", resourceId: "workflow_1" },
      options: {},
    }),
    { code: "platform_command_input_invalid", statusCode: 400 },
  );
});

function buildRun(workflowRunId, stageKey) {
  return {
    workflowRunId,
    status: "running",
    runId: "run_workflow",
    traceId: "trace_workflow",
    stages: [
      {
        key: stageKey,
        stageId: `stage_${stageKey}`,
        artifactId: null,
        parentArtifactId: "artifact_parent",
      },
    ],
  };
}
