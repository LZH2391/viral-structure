const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createArtifactIndex, hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createLineageResolver } = require("../../Apps/Api/lib/platform/lineage-resolver");

test("lineage resolver builds sample artifact tree lineage", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "platform-lineage-sample-"));
  try {
    const { lineageResolver } = await createHarness(tempRoot);
    const lineage = await lineageResolver.resolve({ resourceKind: "sample", resourceId: "sample_1" });

    assert.equal(lineage.schemaVersion, "resource_lineage.v1");
    assert.deepEqual(lineage.root, { resourceKind: "sample", resourceId: "sample_1" });
    assert.equal(lineage.nodes.some((node) => node.resourceKind === "sample" && node.resourceId === "sample_1"), true);
    assert.equal(lineage.nodes.some((node) => node.resourceKind === "artifact" && node.resourceId === "artifact_norm"), true);
    assert.equal(lineage.edges.some((edge) => edge.from.resourceKind === "sample" && edge.to.resourceId === "artifact_sample"), true);
    assert.equal(lineage.edges.some((edge) => edge.from.resourceId === "artifact_sample" && edge.to.resourceId === "artifact_norm"), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("lineage resolver builds artifact-root lineage from index", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "platform-lineage-artifact-"));
  try {
    const { lineageResolver } = await createHarness(tempRoot);
    const lineage = await lineageResolver.resolve({ resourceKind: "artifact", resourceId: "artifact_norm" });

    assert.deepEqual(lineage.root, { resourceKind: "artifact", resourceId: "artifact_norm" });
    assert.equal(lineage.nodes.some((node) => node.resourceId === "artifact_sample"), true);
    assert.equal(lineage.edges.some((edge) => edge.from.resourceId === "artifact_sample" && edge.to.resourceId === "artifact_norm"), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("lineage resolver returns null for unsupported or missing lineage", async () => {
  const lineageResolver = createLineageResolver({ artifactIndex: null });

  assert.equal(await lineageResolver.resolve({ resourceKind: "workflowRun", resourceId: "workflow_1" }), null);
  assert.equal(await lineageResolver.resolve({ resourceKind: "artifact", resourceId: "artifact_missing" }), null);
});

async function createHarness(tempRoot) {
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1" });
  await artifactIndex.registerSampleArtifact({
    artifact: createSampleArtifact(),
    fileHash: hashBuffer(Buffer.from("video")),
    traceId: "trace_index",
  });
  return {
    lineageResolver: createLineageResolver({ artifactIndex }),
  };
}

function createSampleArtifact() {
  return {
    sampleVideoId: "sample_1",
    workspaceId: "workspace_1",
    status: "processed",
    trace: { runId: "run_1", traceId: "trace_1", stageId: "stage_1" },
    processingOptions: { frameSampleRateFps: 1 },
    sampleVideo: {
      artifactId: "artifact_sample",
      parentArtifactId: null,
      original: { artifactId: "artifact_sample", parentArtifactId: null, type: "original-video", uri: "/runtime/source.mp4", summary: "sample.mp4" },
      normalized: { artifactId: "artifact_norm", parentArtifactId: "artifact_sample", type: "normalized-video", uri: "/runtime/sample.mp4", summary: "标准化视频" },
    },
    cover: { artifactId: "artifact_cover", parentArtifactId: "artifact_sample", type: "cover-frame", uri: "/runtime/cover.jpg", summary: "封面帧" },
    frames: [],
    metadata: { durationSeconds: 3, width: 720, height: 1280 },
  };
}
