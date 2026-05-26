const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createArtifactIndex, hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { loadCurrentSampleArtifact } = require("../../Apps/Api/lib/stores/artifact-reader");

test("loadCurrentSampleArtifact hydrates stale sample id from latest same-file artifact", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-artifact-reader-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1" });
  const fileHash = hashBuffer(Buffer.from("same-video"));
  const oldArtifact = createArtifact("sample_old", null);
  const latestArtifact = createArtifact("sample_latest", {
    artifactId: "artifact_shot_latest",
    parentArtifactId: "artifact_sample_sample_latest",
    type: "shot-boundary-analysis",
    status: "processed",
    validation: { status: "passed" },
    boundaries: [{ timestamp: 1 }],
    shots: [{ id: "shot_1", start: 0, end: 2 }],
    createdAt: "2026-05-22T00:00:00.000Z",
  });

  await writeArtifact(store, oldArtifact);
  await writeArtifact(store, latestArtifact);
  await artifactIndex.registerSampleArtifact({ artifact: oldArtifact, fileHash, traceId: "trace_old" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await artifactIndex.registerSampleArtifact({ artifact: latestArtifact, fileHash, traceId: "trace_latest" });

  const loaded = await loadCurrentSampleArtifact({ sampleVideoId: "sample_old", store, artifactIndex });

  assert.equal(loaded.sampleVideoId, "sample_latest");
  assert.equal(loaded.shotBoundaryAnalysis.artifactId, "artifact_shot_latest");
});

async function writeArtifact(store, artifact) {
  const sampleDir = await store.ensureSampleDirs(artifact.sampleVideoId);
  await store.writeJson(path.join(sampleDir, "artifact.json"), artifact);
}

function createArtifact(sampleVideoId, shotBoundaryAnalysis) {
  return {
    sampleVideoId,
    workspaceId: "workspace_1",
    status: "processed",
    trace: { traceId: `trace_${sampleVideoId}` },
    processingOptions: { frameSampleRateFps: 1 },
    sampleVideo: {
      artifactId: `artifact_sample_${sampleVideoId}`,
      parentArtifactId: null,
      original: { artifactId: `artifact_original_${sampleVideoId}`, parentArtifactId: null, type: "original-video", uri: "/runtime/source.mp4", summary: "sample.mp4" },
      normalized: { artifactId: `artifact_normalized_${sampleVideoId}`, parentArtifactId: `artifact_sample_${sampleVideoId}`, type: "normalized-video", uri: "/runtime/source.mp4", summary: "normalized" },
    },
    cover: null,
    frames: [{ frameId: "frame_1", artifactId: `artifact_frame_${sampleVideoId}`, parentArtifactId: `artifact_sample_${sampleVideoId}`, timestamp: 0, imageUri: "/runtime/frame.jpg" }],
    audio: null,
    metadata: { durationSeconds: 2, width: 720, height: 1280 },
    shotBoundaryAnalysis,
  };
}
