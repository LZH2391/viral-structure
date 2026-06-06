const test = require("node:test");
const assert = require("node:assert/strict");
const { createProjectionResolver } = require("../../Apps/Api/lib/platform/projection-resolver");

test("projection resolver reads analysis history without returning full artifacts", async () => {
  const resolver = createProjectionResolver({
    artifactIndex: {
      listItems: async () => [{
        sampleVideoId: "sample_1",
        filename: "sample.mp4",
        status: "processed",
        updatedAt: "2026-06-01T00:00:00.000Z",
        durationSeconds: 3,
        width: 720,
        height: 1280,
        coverUri: "/runtime/cover.jpg",
        videoUri: "/runtime/normalized.mp4",
        traceId: "trace_sample",
        sourceTraceId: "trace_function_slot",
        sourceArtifactId: "artifact_function_slot",
        hasFunctionSlotAtomization: true,
        secretFieldThatShouldNotLeak: "nope",
      }],
      getItem: async () => {
        throw new Error("analysis-history projection should not load full artifacts");
      },
    },
  });

  const resource = await resolver.read({ projectionId: "analysis-history" });
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

test("projection resolver marks incomplete items without loading full artifacts", async () => {
  const resolver = createProjectionResolver({
    artifactIndex: {
      listItems: async () => [{
        sampleVideoId: "sample_partial",
        filename: "partial.mp4",
        coverUri: "/runtime/partial-cover.jpg",
        isIncomplete: true,
      }],
      getItem: async () => {
        throw new Error("analysis-history projection should not load full artifacts");
      },
    },
  });

  const resource = await resolver.read({ projectionId: "analysis-history" });
  const item = resource.summary.items[0];

  assert.equal(item.hasFunctionSlotAtomization, false);
  assert.equal(item.hasUserMaterialPack, false);
  assert.equal(item.isIncomplete, true);
  assert.equal(item.coverUri, "/runtime/partial-cover.jpg");
});

test("projection resolver returns null for unknown projection ids", async () => {
  const resolver = createProjectionResolver();

  assert.equal(await resolver.read({ projectionId: "missing" }), null);
});
