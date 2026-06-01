const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createAnalysisArtifactAttacher } = require("../../Apps/Api/lib/analysis-runtime-v2/artifact-writer");
const { lockStoreForSample } = require("../../Apps/Api/lib/stores/sample-artifact-mutation-lock");

test("analysis artifact attacher preserves concurrent writes for one sample", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "analysis-artifact-writer-"));
  const store = createLocalStore(root);
  await store.ensureSampleDirs("sample_1");
  await store.writeJson(path.join(store.sampleDir("sample_1"), "artifact.json"), {
    sampleVideoId: "sample_1",
    trace: { traceId: "trace_sample" },
  });

  const attachScript = createAnalysisArtifactAttacher({
    analysisKey: "scriptSegmentAnalysis",
    analysisRefKey: "scriptSegmentAnalysisRef",
    historyKey: "scriptSegmentAnalysisHistory",
    resultKind: "script_segment",
    appendHistory: appendHistory,
  });
  const attachRhythm = createAnalysisArtifactAttacher({
    analysisKey: "rhythmStructureAnalysis",
    analysisRefKey: "rhythmStructureAnalysisRef",
    historyKey: "rhythmStructureAnalysisHistory",
    resultKind: "rhythm_structure",
    appendHistory: appendHistory,
  });

  await Promise.all([
    attachScript("sample_1", {
      artifactId: "artifact_script",
      type: "script-segment-analysis",
      parentArtifactId: "artifact_shot",
      createdAt: "2026-06-01T00:00:00.000Z",
    }, store, { traceId: "trace_script" }),
    attachRhythm("sample_1", {
      artifactId: "artifact_rhythm",
      type: "rhythm-structure-analysis",
      parentArtifactId: "artifact_shot",
      createdAt: "2026-06-01T00:00:01.000Z",
    }, store, { traceId: "trace_rhythm" }),
  ]);

  const saved = await store.readJson(path.join(store.sampleDir("sample_1"), "artifact.json"));
  assert.equal(saved.scriptSegmentAnalysis.artifactId, "artifact_script");
  assert.equal(saved.rhythmStructureAnalysis.artifactId, "artifact_rhythm");
  assert.equal(saved.scriptSegmentAnalysisHistory.length, 1);
  assert.equal(saved.rhythmStructureAnalysisHistory.length, 1);
});

test("sample artifact mutation lock serializes mixed artifact updates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sample-artifact-lock-"));
  const store = createLocalStore(root);
  await store.ensureSampleDirs("sample_1");
  const artifactPath = path.join(store.sampleDir("sample_1"), "artifact.json");
  await store.writeJson(artifactPath, { sampleVideoId: "sample_1" });

  await Promise.all([
    lockStoreForSample(store, "sample_1", async () => {
      const artifact = await store.readJson(artifactPath);
      await delay(10);
      artifact.subtitles = { artifactId: "artifact_subtitle" };
      await store.writeJson(artifactPath, artifact);
    }),
    lockStoreForSample(store, "sample_1", async () => {
      const artifact = await store.readJson(artifactPath);
      artifact.scriptSegmentAnalysis = { artifactId: "artifact_script" };
      await store.writeJson(artifactPath, artifact);
    }),
  ]);

  const saved = await store.readJson(artifactPath);
  assert.equal(saved.subtitles.artifactId, "artifact_subtitle");
  assert.equal(saved.scriptSegmentAnalysis.artifactId, "artifact_script");
});

function appendHistory(history, analysis, traceMeta) {
  return [
    ...(Array.isArray(history) ? history : []),
    {
      artifactId: analysis.artifactId,
      traceId: traceMeta.traceId,
      resultUri: traceMeta.resultUri,
    },
  ];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
