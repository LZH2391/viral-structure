const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function loadStageStatusModule() {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/analysisWorkflowStageStatus.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require: () => ({}),
  });
  return module.exports;
}

const { resolveWorkflowStages } = loadStageStatusModule();

test("workflow stage status prefers current run over old artifact completion", () => {
  const stages = resolveWorkflowStages({
    sampleVideoId: "sample_reused",
    status: "cache_waiting",
    isRunning: true,
    hasFunctionSlotAtomization: true,
    hasUserMaterialPack: false,
    artifact: {
      sampleVideo: { artifactId: "artifact_sample" },
      shotBoundaryAnalysis: { artifactId: "artifact_old_shot" },
      scriptSegmentAnalysis: { artifactId: "artifact_old_script" },
      rhythmStructureAnalysis: { artifactId: "artifact_old_rhythm" },
      packagingStructureAnalysis: { artifactId: "artifact_old_packaging" },
      functionSlotAtomizationAnalysis: { artifactId: "artifact_old_atomization" },
    },
    workflowRun: {
      workflowKey: "full-analysis",
      status: "cache_waiting",
      stages: [
        { key: "upload", status: "processed" },
        { key: "shotBoundary", status: "cache_waiting" },
        { key: "scriptSegment", status: "pending" },
        { key: "rhythmStructure", status: "pending" },
        { key: "packagingStructure", status: "pending" },
        { key: "functionSlotAtomization", status: "pending" },
        { key: "aggregate", status: "pending" },
      ],
    },
  });

  assert.equal(stages.find((stage) => stage.key === "shotBoundary").status, "running");
  assert.equal(stages.find((stage) => stage.key === "scriptSegment").status, "waiting");
  assert.equal(stages.find((stage) => stage.key === "functionSlotAtomization").status, "waiting");
});
