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
    energyFrames: [{ time: 0.2, rms: 0.3 }, { time: "bad", rms: 0.1 }, { time: 0.1, rms: "0.2" }],
    spectralSummary: { centroidMean: "1000.5", bandwidthMean: null, rolloffMean: 2000, zeroCrossingRateMean: 0.03 },
    analysisParams: { librosaVersion: "0.11.0", sampleRate: 22050, hopLength: 512, nFft: 2048, sourceRole: "original" },
  });
  assert.deepEqual(result.beats, [0.4, 1.2]);
  assert.deepEqual(result.onsets, [0.1, 0.9]);
  assert.deepEqual(result.energyFrames, [{ time: 0.1, rms: 0.2 }, { time: 0.2, rms: 0.3 }]);
  assert.equal(result.spectralSummary.centroidMean, 1000.5);
});

test("extractAudioFeatures builds artifact from runner JSON", async () => {
  const artifact = await extractAudioFeatures({
    audioPath: "C:\\tmp\\audio.m4a",
    parentArtifactId: "artifact_audio",
    store: {},
    runner: async () => ({
      stdout: JSON.stringify({
        durationSeconds: 1,
        tempoBpm: 120,
        beats: [0.1],
        onsets: [0.2],
        energyFrames: [{ time: 0.1, rms: 0.4 }],
        spectralSummary: {},
        analysisParams: { librosaVersion: "0.11.0", sampleRate: 22050, hopLength: 512, nFft: 2048, sourceRole: "original" },
      }),
      stderr: "",
    }),
  });
  assert.equal(artifact.parentArtifactId, "artifact_audio");
  assert.equal(artifact.type, "audio-feature-analysis");
  assert.deepEqual(artifact.beats, [0.1]);
});

test("degraded audio features keep lineage and empty arrays", () => {
  const degraded = audioFeaturesDegraded({ parentArtifactId: "artifact_audio", reason: "missing source" });
  assert.equal(degraded.parentArtifactId, "artifact_audio");
  assert.equal(degraded.status, "degraded");
  assert.deepEqual(degraded.beats, []);
  assert.deepEqual(degraded.onsets, []);
});

test("audio features artifact keeps machine-readable fields", () => {
  const artifact = buildAudioFeaturesArtifact({
    parentArtifactId: "artifact_audio",
    sourceAudioArtifactId: "artifact_audio",
    result: validateLibrosaResult({ beats: [1], onsets: [0.5], energyFrames: [], spectralSummary: {}, analysisParams: {} }),
  });
  assert.equal(artifact.type, "audio-feature-analysis");
  assert.equal(artifact.sourceAudioArtifactId, "artifact_audio");
});
