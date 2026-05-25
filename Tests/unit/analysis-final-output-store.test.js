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
