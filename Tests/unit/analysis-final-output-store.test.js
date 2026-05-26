const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createAnalysisFinalOutputStore } = require("../../Apps/Api/lib/analysis-final-output-store");

test("analysis final output store writes latest final text outside Runtime", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "analysis-final-output-"));
  const store = { runtimeRoot: path.join(root, "Runtime") };
  const outputStore = createAnalysisFinalOutputStore({ store });

  await outputStore.writeFinalOutput({
    sampleVideoId: "sample_1",
    analysis: {
      artifactId: "artifact_script",
      parentArtifactId: "artifact_shot",
      type: "script-segment-analysis",
    },
    finalOutputText: "final script turn output",
    traceId: "trace_script",
    stageName: "script_segment.materialize",
  });

  const outputPath = path.join(root, "Artifacts", "AnalysisFinalOutputs", "sample_1", "script-segments.final.txt");
  const manifestPath = path.join(root, "Artifacts", "AnalysisFinalOutputs", "sample_1", "manifest.json");
  assert.equal(await fs.readFile(outputPath, "utf8"), "final script turn output\n");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.outputs["script-segments"].artifactId, "artifact_script");
  assert.equal(manifest.outputs["script-segments"].source, "turn-final-message");
  assert.equal(outputPath.includes(`${path.sep}Runtime${path.sep}`), false);
});

test("analysis final output store overwrites fixed latest file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "analysis-final-output-"));
  const outputStore = createAnalysisFinalOutputStore({ store: { runtimeRoot: path.join(root, "Runtime") } });

  await outputStore.writeFinalOutput({
    sampleVideoId: "sample_1",
    analysis: { artifactId: "artifact_old", type: "rhythm-structure-analysis" },
    finalOutputText: "old",
    traceId: "trace_old",
    stageName: "rhythm_structure.materialize",
  });
  await outputStore.writeFinalOutput({
    sampleVideoId: "sample_1",
    analysis: { artifactId: "artifact_new", type: "rhythm-structure-analysis" },
    finalOutputText: "new",
    traceId: "trace_new",
    stageName: "rhythm_structure.materialize",
  });

  const outputPath = path.join(root, "Artifacts", "AnalysisFinalOutputs", "sample_1", "rhythm-structure.final.txt");
  const manifestPath = path.join(root, "Artifacts", "AnalysisFinalOutputs", "sample_1", "manifest.json");
  assert.equal(await fs.readFile(outputPath, "utf8"), "new\n");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.outputs["rhythm-structure"].artifactId, "artifact_new");
});

test("analysis final output store copies source final text for cache reuse", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "analysis-final-output-"));
  const outputStore = createAnalysisFinalOutputStore({ store: { runtimeRoot: path.join(root, "Runtime") } });

  await outputStore.writeFinalOutput({
    sampleVideoId: "sample_source",
    analysis: { artifactId: "artifact_source", type: "packaging-structure-analysis" },
    finalOutputText: "source packaging final",
    traceId: "trace_old",
    stageName: "packaging_structure.materialize",
  });

  const reused = await outputStore.writeFinalOutput({
    sampleVideoId: "sample_1",
    analysis: {
      artifactId: "artifact_cached",
      type: "packaging-structure-analysis",
      sourceSampleVideoId: "sample_source",
    },
    finalOutputText: "",
    traceId: "trace_cached",
    stageName: "packaging_structure.cache_reuse",
  });

  const outputPath = path.join(root, "Artifacts", "AnalysisFinalOutputs", "sample_1", "packaging-structure.final.txt");
  const manifestPath = path.join(root, "Artifacts", "AnalysisFinalOutputs", "sample_1", "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(reused.outputKey, "packaging-structure");
  assert.equal(await fs.readFile(outputPath, "utf8"), "source packaging final\n");
  assert.equal(manifest.outputs["packaging-structure"].source, "cache-reuse-final-message");
  assert.equal(manifest.outputs["packaging-structure"].sourceSampleVideoId, "sample_source");
});

test("analysis final output store keeps existing final text when cache reuse has no final message", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "analysis-final-output-"));
  const outputStore = createAnalysisFinalOutputStore({ store: { runtimeRoot: path.join(root, "Runtime") } });

  await outputStore.writeFinalOutput({
    sampleVideoId: "sample_1",
    analysis: { artifactId: "artifact_existing", type: "packaging-structure-analysis" },
    finalOutputText: "current final",
    traceId: "trace_existing",
    stageName: "packaging_structure.materialize",
  });
  await outputStore.writeFinalOutput({
    sampleVideoId: "sample_source",
    analysis: { artifactId: "artifact_source", type: "packaging-structure-analysis" },
    finalOutputText: "source final",
    traceId: "trace_source",
    stageName: "packaging_structure.materialize",
  });

  const kept = await outputStore.writeFinalOutput({
    sampleVideoId: "sample_1",
    analysis: {
      artifactId: "artifact_cached",
      type: "packaging-structure-analysis",
      sourceSampleVideoId: "sample_source",
    },
    finalOutputText: "",
    traceId: "trace_cached",
    stageName: "packaging_structure.cache_reuse",
  });

  const outputPath = path.join(root, "Artifacts", "AnalysisFinalOutputs", "sample_1", "packaging-structure.final.txt");
  assert.equal(kept.source, "existing-final-message");
  assert.equal(await fs.readFile(outputPath, "utf8"), "current final\n");
});

test("analysis final output store removes latest file when cache source final text is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "analysis-final-output-"));
  const outputStore = createAnalysisFinalOutputStore({ store: { runtimeRoot: path.join(root, "Runtime") } });

  const removed = await outputStore.writeFinalOutput({
    sampleVideoId: "sample_1",
    analysis: {
      artifactId: "artifact_cached",
      type: "packaging-structure-analysis",
      sourceSampleVideoId: "sample_missing",
    },
    finalOutputText: "",
    traceId: "trace_cached",
    stageName: "packaging_structure.cache_reuse",
  });

  const outputPath = path.join(root, "Artifacts", "AnalysisFinalOutputs", "sample_1", "packaging-structure.final.txt");
  assert.equal(removed, null);
  await assert.rejects(() => fs.readFile(outputPath, "utf8"), { code: "ENOENT" });
});
