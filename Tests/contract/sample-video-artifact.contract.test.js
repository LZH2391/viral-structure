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
    frameOutputSummary: {
      frameSampleRateFps: 1,
      targetFrameCount: 5,
      actualFrameCount: 5,
      maxFrames: 6000,
      samplingPolicy: "fixed_interval_from_zero",
      cappedByMaxFrames: false,
    },
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
  assert.equal(artifact.frameOutputSummary.samplingPolicy, "fixed_interval_from_zero");
  assert.equal(artifact.frameOutputSummary.cappedByMaxFrames, false);
  assert.equal(artifact.frames[0].parentArtifactId, "artifact_sample");
});

test("audio feature artifact keeps source lineage and raw feature arrays", () => {
  const artifact = {
    processingOptions: { frameSampleRateFps: 1, enableAudioFeatureAnalysis: true },
    audioFeatures: {
      artifactId: "artifact_audio_features",
      parentArtifactId: "artifact_music",
      type: "audio-feature-analysis",
      status: "processed",
      sourceAudioArtifactId: "artifact_music",
      durationSeconds: 2,
      tempoBpm: 120,
      beats: [0.25, 1.25],
      onsets: [0.5],
      energyFrames: [{ time: 0.25, rms: 0.4 }],
      spectralSummary: { centroidMean: 1000 },
      analysisParams: { librosaVersion: "0.11.0", sampleRate: 22050, hopLength: 512, nFft: 2048, sourceRole: "music" },
    },
  };
  assert.equal(artifact.processingOptions.enableAudioFeatureAnalysis, true);
  assert.equal(artifact.audioFeatures.parentArtifactId, "artifact_music");
  assert.equal(artifact.audioFeatures.sourceAudioArtifactId, "artifact_music");
  assert.deepEqual(artifact.audioFeatures.beats, [0.25, 1.25]);
});

test("subtitle artifact can carry revision lineage and history", () => {
  const artifact = {
    subtitles: {
      artifactId: "artifact_subtitle_revision_1",
      parentArtifactId: "artifact_subtitle_recognition",
      revisionOfArtifactId: "artifact_subtitle_recognition",
      source: "manual_edit",
      revisionIndex: 1,
      textHash: "abcd1234efgh5678",
      type: "subtitle-track",
      segments: [{ id: "subtitle_1", start: 0, end: 1, text: "手改字幕" }],
      status: "processed",
    },
    subtitlesRevisionHistory: [
      {
        artifactId: "artifact_subtitle_recognition",
        parentArtifactId: "artifact_audio",
        revisionOfArtifactId: "artifact_subtitle_recognition",
        segmentCount: 1,
        textHash: "sourcehash1234567",
        traceId: "trace_1",
        createdAt: "2026-05-22T00:00:00.000Z",
      },
    ],
  };
  assert.equal(artifact.subtitles.source, "manual_edit");
  assert.equal(artifact.subtitles.parentArtifactId, "artifact_subtitle_recognition");
  assert.equal(artifact.subtitles.revisionOfArtifactId, "artifact_subtitle_recognition");
  assert.equal(artifact.subtitles.revisionIndex, 1);
  assert.equal(artifact.subtitlesRevisionHistory[0].artifactId, "artifact_subtitle_recognition");
});
