const test = require("node:test");
const assert = require("node:assert/strict");
const { createArtifactRef, createFrameArtifact } = require("../../Core/Workspace/sample-video-contracts");

test("frame artifact requires timestamp and parent artifact", () => {
  const frame = createFrameArtifact({
    frameId: "frame_1",
    artifactId: "artifact_frame",
    parentArtifactId: "artifact_sample",
    timestamp: 1.2,
    imageUri: "/runtime/frames/1.jpg",
  });
  assert.equal(frame.timestamp, 1.2);
  assert.equal(frame.parentArtifactId, "artifact_sample");
});

test("artifact ref keeps parent relation", () => {
  const ref = createArtifactRef({
    artifactId: "artifact_audio",
    parentArtifactId: "artifact_sample",
    type: "audio-track",
    uri: "/runtime/audio.m4a",
    summary: "音频轨",
  });
  assert.equal(ref.parentArtifactId, "artifact_sample");
});

test("sample artifact keeps processing options and frame summary", () => {
  const artifact = {
    processingOptions: { frameSampleRateFps: 1 },
    frameOutputSummary: { frameSampleRateFps: 1, targetFrameCount: 5, actualFrameCount: 5, maxFrames: 120 },
    frames: [
      createFrameArtifact({
        frameId: "frame_1",
        artifactId: "artifact_frame",
        parentArtifactId: "artifact_sample",
        timestamp: 0,
        imageUri: "/runtime/frames/1.jpg",
      }),
    ],
  };
  assert.equal(artifact.processingOptions.frameSampleRateFps, 1);
  assert.equal(artifact.frameOutputSummary.actualFrameCount, 5);
  assert.equal(artifact.frames[0].parentArtifactId, "artifact_sample");
});
