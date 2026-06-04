const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createArtifactIndex, hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createArtifactResolver } = require("../../Apps/Api/lib/platform/artifact-resolver");

test("artifact resolver resolves artifact index tree nodes safely", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "platform-artifact-resolver-tree-"));
  try {
    const store = createLocalStore(tempRoot);
    await store.ensureRuntimeDirs();
    const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1" });
    await artifactIndex.registerSampleArtifact({
      artifact: createSampleArtifact(),
      fileHash: hashBuffer(Buffer.from("video")),
      traceId: "trace_index",
    });

    const resolver = createArtifactResolver({ artifactIndex });
    const resolution = await resolver.resolve({ artifactId: "artifact_norm", sampleVideoId: "sample_1" });

    assert.equal(resolution.exists, true);
    assert.equal(resolution.readable, true);
    assert.equal(resolution.artifactType, "normalized-video");
    assert.equal(resolution.stageName, "sample.artifact.written");
    assert.equal(resolution.parentArtifactId, "artifact_sample");
    assert.equal(resolution.sampleVideoId, "sample_1");
    assert.equal(resolution.traceId, "trace_1");
    assert.equal(resolution.runId, "run_1");
    assert.equal(resolution.uri, "/runtime/sample.mp4");
    assert.equal(resolution.mediaKind, "video");
    assert.equal(resolution.source.sourceOfTruth, "Runtime/Artifacts/sample_1/artifact.json");
    assert.equal(resolution.source.indexSource, "Infrastructure/ArtifactIndex");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("artifact resolver falls back to embedded artifact refs", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "platform-artifact-resolver-ref-"));
  try {
    const store = createLocalStore(tempRoot);
    await store.ensureRuntimeDirs();
    const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1" });
    await artifactIndex.registerSampleArtifact({
      artifact: createSampleArtifact(),
      fileHash: hashBuffer(Buffer.from("video-ref")),
      traceId: "trace_index",
    });

    const resolver = createArtifactResolver({ artifactIndex });
    const resolution = await resolver.resolve({ artifactId: "artifact_frame_1" });

    assert.equal(resolution.exists, true);
    assert.equal(resolution.artifactType, null);
    assert.equal(resolution.stageName, null);
    assert.equal(resolution.parentArtifactId, "artifact_sample");
    assert.equal(resolution.uri, "/runtime/frame-00001.jpg");
    assert.equal(resolution.mediaKind, "image");
    assert.equal(resolution.source.indexSource, null);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("artifact resolver returns missing resolution for unknown artifact", async () => {
  const resolver = createArtifactResolver({ artifactIndex: null });
  const resolution = await resolver.resolve({ artifactId: "artifact_missing" });

  assert.equal(resolution.exists, false);
  assert.equal(resolution.readable, false);
  assert.equal(resolution.artifactId, "artifact_missing");
  assert.equal(resolution.mediaKind, "unknown");
});

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
    frames: [{ frameId: "frame_1", artifactId: "artifact_frame_1", parentArtifactId: "artifact_sample", timestamp: 0, imageUri: "/runtime/frame-00001.jpg" }],
    metadata: { durationSeconds: 3, width: 720, height: 1280 },
  };
}
