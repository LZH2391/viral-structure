const test = require("node:test");
const assert = require("node:assert/strict");
const { createResourceResolver } = require("../../Apps/Api/lib/platform/resource-resolver");

test("resource resolver lists sample summaries from artifact index", async () => {
  const resolver = createResourceResolver({
    artifactIndex: {
      listItems: async () => [{
        sampleVideoId: "sample_1",
        filename: "sample.mp4",
        updatedAt: "2026-06-01T00:00:00.000Z",
        durationSeconds: 3,
        width: 720,
        height: 1280,
        tags: ["抽帧"],
        traceId: "trace_sample",
        sourceArtifactId: "artifact_script",
      }],
    },
  });

  const result = await resolver.list({ resourceKind: "sample" });

  assert.equal(result.schemaVersion, "platform_resource_list.v1");
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].resourceKind, "sample");
  assert.equal(result.resources[0].resourceId, "sample_1");
  assert.equal(result.resources[0].artifactId, "artifact_script");
  assert.equal(result.resources[0].source.indexSource, "Infrastructure/ArtifactIndex");
});

test("resource resolver reads sample detail without returning full artifact", async () => {
  const resolver = createResourceResolver({
    artifactIndex: {
      getItem: async () => ({
        sampleVideoId: "sample_1",
        filename: "sample.mp4",
        updatedAt: "2026-06-01T00:00:00.000Z",
        traceId: "trace_sample",
        artifact: {
          status: "processed",
          sampleVideo: { artifactId: "artifact_sample" },
          secretFieldThatShouldNotLeak: "nope",
        },
      }),
    },
  });

  const resource = await resolver.read({ resourceKind: "sample", resourceId: "sample_1" });

  assert.equal(resource.resourceId, "sample_1");
  assert.equal(resource.status, "processed");
  assert.equal(resource.artifactId, "artifact_sample");
  assert.equal(JSON.stringify(resource).includes("secretFieldThatShouldNotLeak"), false);
});

test("resource resolver reads analysis history projection without returning full artifacts", async () => {
  const resolver = createResourceResolver({
    artifactIndex: {
      listItems: async () => [{
        sampleVideoId: "sample_1",
        filename: "sample.mp4",
        updatedAt: "2026-06-01T00:00:00.000Z",
        durationSeconds: 3,
        width: 720,
        height: 1280,
        traceId: "trace_sample",
        sourceArtifactId: "artifact_function_slot",
      }],
      getItem: async () => ({
        sampleVideoId: "sample_1",
        artifact: {
          status: "processed",
          trace: { runId: "run_sample", traceId: "trace_sample", stageId: "stage_sample" },
          metadata: { durationSeconds: 3, width: 720, height: 1280 },
          sampleVideo: {
            artifactId: "artifact_video",
            original: { summary: "sample.mp4", uri: "/runtime/source.mp4" },
            normalized: { uri: "/runtime/normalized.mp4" },
          },
          cover: { uri: "/runtime/cover.jpg" },
          functionSlotAtomizationAnalysis: {
            artifactId: "artifact_function_slot",
            traceId: "trace_function_slot",
            slotMap: { secretFieldThatShouldNotLeak: "nope" },
          },
        },
      }),
    },
  });

  const resource = await resolver.read({ resourceKind: "projection", resourceId: "analysis-history" });
  const item = resource.summary.items[0];

  assert.equal(resource.schemaVersion, "platform_resource_summary.v1");
  assert.equal(resource.resourceKind, "projection");
  assert.equal(resource.resourceId, "analysis-history");
  assert.equal(resource.summary.schemaVersion, "analysis_history_projection.v1");
  assert.equal(item.sampleVideoId, "sample_1");
  assert.equal(item.videoUri, "/runtime/normalized.mp4");
  assert.equal(item.coverUri, "/runtime/cover.jpg");
  assert.equal(item.hasFunctionSlotAtomization, true);
  assert.equal(JSON.stringify(resource).includes("secretFieldThatShouldNotLeak"), false);
  assert.equal(JSON.stringify(resource).includes("slotMap"), false);
});

test("resource resolver returns null for unknown projection ids", async () => {
  const resolver = createResourceResolver();

  assert.equal(await resolver.read({ resourceKind: "projection", resourceId: "missing" }), null);
});

test("resource resolver lists workflow runs, jobs, active turns, conversations, and modules", async () => {
  const resolver = createResourceResolver({
    workflowRunStore: {
      listRuns: () => [{ workflowRunId: "workflow_1", workflowKey: "full-analysis", status: "running", traceId: "trace_workflow", runId: "run_workflow", stages: [] }],
    },
    jobStore: {
      listJobs: () => [{ jobId: "job_1", status: "processing", stage: "sample.frames.extracted", progress: 50, traceId: "trace_job" }],
    },
    activeTurnRuntime: {
      listActive: async () => [{ bindingId: "binding_1", status: "submitted", threadId: "thread_1", turnId: "turn_1", replayRef: { type: "text" } }],
    },
    agentConversationStore: {
      list: async () => [{ conversationId: "conversation_1", status: "active", title: "对话", revision: 1, messages: [{ id: "m1" }] }],
    },
    moduleRegistry: {
      list: () => [{ moduleId: "script-segments", moduleKind: "analysis", executorKind: "local", supportsCacheReuse: true }],
    },
  });

  assert.equal((await resolver.list({ resourceKind: "workflowRun" })).resources[0].resourceId, "workflow_1");
  assert.equal((await resolver.list({ resourceKind: "job" })).resources[0].summary.progress, 50);
  assert.equal((await resolver.list({ resourceKind: "activeTurn" })).resources[0].resourceId, "binding_1");
  assert.equal((await resolver.list({ resourceKind: "conversation" })).resources[0].summary.messageCount, 1);
  assert.equal((await resolver.list({ resourceKind: "module" })).resources[0].resourceId, "script-segments");
});

test("resource resolver maps trace list and detail to safe summaries", async () => {
  const resolver = createResourceResolver({
    runtimeRoot: "Runtime",
    readDebugTracesImpl: async (runtimeRoot) => {
      assert.equal(runtimeRoot, "Runtime");
      return {
        traces: [{
          traceId: "trace_1",
          logUri: "/runtime/DebugSnapshots/trace_1.log.jsonl",
          updatedAt: "2026-06-01T00:00:00.000Z",
          latestEvent: "stage.end",
          latestStageName: "workflow.aggregate",
          errorSummary: null,
        }],
      };
    },
    readDebugTraceDetailImpl: async (runtimeRoot, traceId) => {
      assert.equal(runtimeRoot, "Runtime");
      assert.equal(traceId, "trace_1");
      return {
        traceId,
        logUri: "/runtime/DebugSnapshots/trace_1.log.jsonl",
        updatedAt: "2026-06-01T00:00:00.000Z",
        latestEvent: "stage.fail",
        latestStageName: "script.segment.analyze",
        errorSummary: { code: "failed" },
        events: [{ event: "stage.start", inputSummary: { hidden: "do not return full events" } }],
      };
    },
  });

  const listed = await resolver.list({ resourceKind: "trace" });
  const detail = await resolver.read({ resourceKind: "trace", resourceId: "trace_1" });

  assert.equal(listed.resources[0].resourceId, "trace_1");
  assert.equal(listed.resources[0].status, "stage.end");
  assert.equal(detail.status, "failed");
  assert.equal(detail.summary.eventCount, 1);
  assert.equal(JSON.stringify(detail).includes("do not return full events"), false);
});

test("resource resolver returns null for missing resource kinds and ids", async () => {
  const resolver = createResourceResolver({
    workflowRunStore: {
      getRun: () => null,
    },
  });

  assert.equal(await resolver.list({ resourceKind: "unknown" }), null);
  assert.equal(await resolver.read({ resourceKind: "workflowRun", resourceId: "workflow_missing" }), null);
});
