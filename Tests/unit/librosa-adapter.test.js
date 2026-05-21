const test = require("node:test");
const assert = require("node:assert/strict");
const {
  audioFeaturesDegraded,
  buildAudioFeaturesArtifact,
  extractAudioFeatures,
  isLibrosaAvailable,
  validateLibrosaResult,
} = require("../../Infrastructure/MediaProcessing/librosa-adapter");

test("librosa availability uses python import probe", async () => {
  const available = await isLibrosaAvailable({
    command: "python",
    runner: async (command, args) => {
      assert.equal(command, "python");
      assert.deepEqual(args, ["-c", "import librosa; print(librosa.__version__)"]);
      return { stdout: "0.11.0", stderr: "" };
    },
  });
  assert.equal(available, true);
});

test("librosa JSON output is normalized and sorted", () => {
  const result = validateLibrosaResult({
    durationSeconds: "2.5",
    tempoBpm: "120.2",
    beats: [1.2, 0.4, "bad"],
    onsets: [0.9, 0.1],
    energyFrames: [{ time: 0, rms: 0.0005, dbfs: -66 }, { time: 0.2, rms: 0.3, dbfs: -10.45 }, { time: "bad", rms: 0.1 }, { time: 0.1, rms: "0.2" }],
    spectralSummary: { centroidMean: "1000.5", bandwidthMean: null, rolloffMean: 2000, zeroCrossingRateMean: 0.03 },
    analysisParams: { librosaVersion: "0.11.0", sampleRate: 22050, hopLength: 512, nFft: 2048, sourceRole: "original" },
  });
  assert.deepEqual(result.beats, [0.4, 1.2]);
  assert.deepEqual(result.onsets, [0.1, 0.9]);
  assert.equal(result.energyFrames[1].dbfs < -13.9 && result.energyFrames[1].dbfs > -14, true);
  assert.deepEqual(result.energyFrames[2], { time: 0.2, rms: 0.3, dbfs: -10.45 });
  assert.equal(result.spectralSummary.centroidMean, 1000.5);
});

test("extractAudioFeatures builds artifact from runner JSON", async () => {
  const artifact = await extractAudioFeatures({
    audioPath: "C:\\tmp\\audio.m4a",
    parentArtifactId: "artifact_music",
    sourceAudioArtifactId: "artifact_music",
    store: {},
    runner: async () => ({
      stdout: JSON.stringify({
        durationSeconds: 1,
        tempoBpm: 120,
        beats: [0.1],
        onsets: [0.2],
        energyFrames: [{ time: 0, rms: 0.0005, dbfs: -66 }, { time: 0.1, rms: 0.4, dbfs: -7.96 }],
        spectralSummary: {},
        analysisParams: { librosaVersion: "0.11.0", sampleRate: 22050, hopLength: 512, nFft: 2048, sourceRole: "original" },
      }),
      stderr: "",
    }),
  });
  assert.equal(artifact.parentArtifactId, "artifact_music");
  assert.equal(artifact.sourceAudioArtifactId, "artifact_music");
  assert.equal(artifact.type, "audio-feature-analysis");
  assert.deepEqual(artifact.beats, [0.1]);
  assert.equal(artifact.beatFrames[0].valid, true);
  assert.equal(artifact.loudnessSummary.lowSignal, false);
});

test("degraded audio features keep lineage and empty arrays", () => {
  const degraded = audioFeaturesDegraded({ parentArtifactId: "artifact_audio", reason: "missing source" });
  assert.equal(degraded.parentArtifactId, "artifact_audio");
  assert.equal(degraded.status, "degraded");
  assert.deepEqual(degraded.beats, []);
  assert.deepEqual(degraded.onsets, []);
  assert.equal(degraded.loudnessSummary.lowSignal, true);
});

test("audio features artifact keeps machine-readable fields", () => {
  const artifact = buildAudioFeaturesArtifact({
    parentArtifactId: "artifact_audio",
    sourceAudioArtifactId: "artifact_audio",
    result: validateLibrosaResult({ beats: [1], onsets: [0.5], energyFrames: [], spectralSummary: {}, analysisParams: {} }),
  });
  assert.equal(artifact.type, "audio-feature-analysis");
  assert.equal(artifact.sourceAudioArtifactId, "artifact_audio");
  assert.ok(artifact.analysisParams.energyGate);
});

test("near silent audio is marked low signal and filters markers", () => {
  const result = validateLibrosaResult({
    beats: [0.1, 0.2],
    onsets: [0.15],
    energyFrames: [
      { time: 0.1, rms: 0.0001, dbfs: -80 },
      { time: 0.2, rms: 0.00012, dbfs: -78.4 },
    ],
    spectralSummary: {},
    analysisParams: {},
  });
  assert.equal(result.loudnessSummary.lowSignal, true);
  assert.deepEqual(result.beats, []);
  assert.deepEqual(result.onsets, []);
  assert.equal(result.beatFrames[0].valid, false);
  assert.equal(result.beatFrames[0].reason, "low_signal");
});

test("marker frames keep high energy markers and explain filtered markers", () => {
  const result = validateLibrosaResult({
    beats: [0.1, 0.4],
    onsets: [],
    energyFrames: [
      { time: 0.1, rms: 0.02, dbfs: -34 },
      { time: 0.4, rms: 0.001, dbfs: -60 },
      { time: 0.8, rms: 0.03, dbfs: -30 },
    ],
    spectralSummary: {},
    analysisParams: {},
  });
  assert.deepEqual(result.beats, [0.1]);
  assert.equal(result.beatFrames[0].valid, true);
  assert.equal(result.beatFrames[1].valid, false);
  assert.equal(result.beatFrames[1].reason, "below_marker_threshold");
});
