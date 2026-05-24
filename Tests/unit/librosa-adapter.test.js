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
    spectralSummary: { centroidMean: "1000.5", bandwidthMean: null, rolloffMean: 2000, zeroCrossingRateMean: 0.03, flatnessMean: 0.1, entropyMean: 0.2 },
    audioEventCandidates: [
      { time: 1.5, kind: "strong_cut_candidate", confidence: 0.7, usableForEdit: true, evidence: { labels: ["music_like"], bandEnergyRatios: { low: 0.1 } } },
      { time: 0.5, kind: "sfx_candidate", confidence: 0.8, usableForEdit: true, evidence: { rms: 0.2, labels: ["sfx_candidate"] } },
      { time: 0.6, kind: "bad", confidence: 2 },
    ],
    audioRegions: [{ label: "music_like", start: 1, end: 2, peakRms: 0.2 }],
    classificationSummary: {
      status: "degraded",
      reason: "missing model",
      model: "panns-cnn14-audioset",
      wholeFileTopLabels: [{ label: "Music", score: 0.5 }],
      chunks: [{ start: 0, end: 5, topLabels: [{ label: "Plop", score: 0.2 }] }],
    },
    analysisParams: { librosaVersion: "0.11.0", sampleRate: 22050, hopLength: 512, nFft: 2048, sourceRole: "original", eventWindowSeconds: 0.25, pannsEnabled: true, pannsModel: "panns-cnn14-audioset" },
  });
  assert.deepEqual(result.beats, [0.4, 1.2]);
  assert.deepEqual(result.onsets, [0.1, 0.9]);
  assert.deepEqual(result.energyFrames, [{ time: 0.1, rms: 0.2 }, { time: 0.2, rms: 0.3 }]);
  assert.equal(result.spectralSummary.centroidMean, 1000.5);
  assert.equal(result.spectralSummary.flatnessMean, 0.1);
  assert.deepEqual(result.audioEventCandidates.map((item) => item.time), [0.5, 1.5]);
  assert.equal(result.audioEventCandidates[0].kind, "sfx_candidate");
  assert.equal(result.classificationSummary.status, "degraded");
  assert.equal(result.classificationSummary.wholeFileTopLabels[0].label, "Music");
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
        energyFrames: [{ time: 0.1, rms: 0.4 }],
        spectralSummary: {},
        audioEventCandidates: [{ time: 0.2, kind: "strong_cut_candidate", confidence: 0.6, usableForEdit: true }],
        audioRegions: [],
        classificationSummary: { status: "degraded", reason: "missing model", wholeFileTopLabels: [], chunks: [] },
        analysisParams: { librosaVersion: "0.11.0", sampleRate: 22050, hopLength: 512, nFft: 2048, sourceRole: "original" },
      }),
      stderr: "",
    }),
  });
  assert.equal(artifact.parentArtifactId, "artifact_music");
  assert.equal(artifact.sourceAudioArtifactId, "artifact_music");
  assert.equal(artifact.type, "audio-feature-analysis");
  assert.deepEqual(artifact.beats, [0.1]);
  assert.equal(artifact.audioEventCandidates[0].kind, "strong_cut_candidate");
  assert.equal(artifact.classificationSummary.status, "degraded");
});

test("degraded audio features keep lineage and empty arrays", () => {
  const degraded = audioFeaturesDegraded({ parentArtifactId: "artifact_audio", reason: "missing source" });
  assert.equal(degraded.parentArtifactId, "artifact_audio");
  assert.equal(degraded.status, "degraded");
  assert.deepEqual(degraded.beats, []);
  assert.deepEqual(degraded.onsets, []);
  assert.deepEqual(degraded.audioEventCandidates, []);
  assert.equal(degraded.classificationSummary.status, "degraded");
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
