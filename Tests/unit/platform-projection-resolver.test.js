const test = require("node:test");
const assert = require("node:assert/strict");
const { createProjectionResolver } = require("../../Apps/Api/lib/platform/projection-resolver");

test("projection resolver reads analysis history without returning full artifacts", async () => {
  const resolver = createProjectionResolver({
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
    workflowRunStore: {
      listRuns: () => [
        { workflowRunId: "workflow_old", workflowKey: "full-analysis", sampleVideoId: "sample_1", updatedAt: "2026-05-31T00:00:00.000Z" },
        { workflowRunId: "workflow_latest", workflowKey: "full-analysis", sampleVideoId: "sample_1", updatedAt: "2026-06-02T00:00:00.000Z" },
      ],
    },
  });

  const resource = await resolver.read({ projectionId: "analysis-history" });
  const item = resource.summary.items[0];

  assert.equal(resource.schemaVersion, "platform_resource_summary.v1");
  assert.equal(resource.resourceKind, "projection");
  assert.equal(resource.resourceId, "analysis-history");
  assert.equal(resource.summary.schemaVersion, "analysis_history_projection.v1");
  assert.equal(item.sampleVideoId, "sample_1");
  assert.equal(item.workflowRunId, "workflow_latest");
  assert.equal(item.workflowKey, "full-analysis");
  assert.equal(item.videoUri, "/runtime/normalized.mp4");
  assert.equal(item.coverUri, "/runtime/cover.jpg");
  assert.equal(item.hasFunctionSlotAtomization, true);
  assert.equal(JSON.stringify(resource).includes("secretFieldThatShouldNotLeak"), false);
  assert.equal(JSON.stringify(resource).includes("slotMap"), false);
});

test("projection resolver returns null for unknown projection ids", async () => {
  const resolver = createProjectionResolver();

  assert.equal(await resolver.read({ projectionId: "missing" }), null);
});
