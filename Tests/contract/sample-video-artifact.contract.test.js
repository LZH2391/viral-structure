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
      energyFrames: [{ time: 0.25, rms: 0.4, dbfs: -7.96 }],
      loudnessSummary: { rmsP50Dbfs: -16, rmsP95Dbfs: -8, peakP95Dbfs: -7, noiseFloorDbfs: -40, activeRatio: 0.6, lowSignal: false, gateReason: null },
      beatFrames: [{ time: 0.25, rms: 0.4, dbfs: -7.96, energyRank: 0.9, valid: true, reason: null }],
      onsetFrames: [{ time: 0.5, rms: 0.3, dbfs: -10.46, energyRank: 0.7, valid: true, reason: null }],
      spectralSummary: { centroidMean: 1000 },
      analysisParams: { librosaVersion: "0.11.0", sampleRate: 22050, hopLength: 512, nFft: 2048, sourceRole: "music", energyGate: { markerThresholdDbfs: -45 } },
    },
  };
  assert.equal(artifact.processingOptions.enableAudioFeatureAnalysis, true);
  assert.equal(artifact.audioFeatures.parentArtifactId, "artifact_music");
  assert.equal(artifact.audioFeatures.sourceAudioArtifactId, "artifact_music");
  assert.deepEqual(artifact.audioFeatures.beats, [0.25, 1.25]);
  assert.equal(artifact.audioFeatures.beatFrames[0].valid, true);
  assert.equal(artifact.audioFeatures.loudnessSummary.lowSignal, false);
});

test("shot boundary artifact keeps shotNo while remaining compatible with legacy fields", () => {
  const artifact = {
    shotBoundaryAnalysis: {
      artifactId: "artifact_shot_boundary",
      parentArtifactId: "artifact_sample",
      type: "shot-boundary-analysis",
      status: "processed",
      sourceFrameArtifactIds: ["artifact_frame_0", "artifact_frame_1"],
      extractSampling: { requestedFps: 3, targetFrameCount: 6, actualFrameCount: 6, maxFrames: 120 },
      analysisSampling: { fps: 1, stride: 3 },
      shots: [
        {
          id: "shot_1",
          index: 0,
          shotNo: "S001",
          start: 0,
          end: 1.2,
          representativeFrameId: "frame_0",
          confidence: 0.8,
          reason: "视觉变化摘要",
        },
      ],
      createdAt: new Date().toISOString(),
    },
  };
  assert.equal(artifact.shotBoundaryAnalysis.parentArtifactId, "artifact_sample");
  assert.equal(artifact.shotBoundaryAnalysis.shots[0].shotNo, "S001");
  assert.equal(artifact.shotBoundaryAnalysis.shots[0].index, 0);
  assert.equal(artifact.shotBoundaryAnalysis.shots[0].representativeFrameId, "frame_0");
});
