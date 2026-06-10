const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function loadQueueModel(api) {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/analysisHomeQueueModel.ts"), "utf8");
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
    require: (request) => {
      if (request === "../../api/client") return api;
      return {};
    },
    Date,
    Promise,
    setTimeout,
  });
  return module.exports;
}

test("analysis home queue status follows current workflow over old final artifact", async () => {
  const { loadLatestVideoProcessingQueue } = loadQueueModel({
    runtimeUrl: (uri) => uri ?? null,
    getLatestMaterialRecognitionBatchRun: async () => null,
    getLatestFullAnalysisBatchRun: async () => ({
      batchRunId: "batch_1",
      workflowKey: "full-analysis",
      status: "cache_waiting",
      maxConcurrentRuns: 2,
      items: [{
        queueItemId: "item_1",
        batchRunId: "batch_1",
        workflowRunId: "workflow_1",
        sampleVideoId: "sample_reused",
        filename: "reused.mp4",
        status: "cache_waiting",
        position: 1,
        currentStageKeys: ["shotBoundary"],
        createdAt: "2026-06-10T00:00:00.000Z",
        updatedAt: "2026-06-10T00:00:01.000Z",
      }],
    }),
    getWorkflowRun: async () => ({
      workflowRunId: "workflow_1",
      workflowKey: "full-analysis",
      status: "cache_waiting",
      traceId: "trace_current",
      runId: "run_current",
      sampleVideoId: "sample_reused",
      currentStageKeys: ["shotBoundary"],
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:02.000Z",
      stages: [{ key: "shotBoundary", status: "cache_waiting", stageId: "stage_current", childJobId: "job_1" }],
    }),
    getSampleArtifact: async () => ({
      status: "processed",
      sampleVideo: {
        original: { summary: "old complete sample" },
        normalized: { uri: "/runtime/video.mp4" },
      },
      metadata: { durationSeconds: 3, width: 720, height: 1280 },
      functionSlotAtomizationAnalysis: { artifactId: "artifact_old_atomization" },
      trace: { traceId: "trace_old", runId: "run_old", stageId: "stage_old" },
    }),
  });

  const items = await loadLatestVideoProcessingQueue("structureAnalysis");

  assert.equal(items.length, 1);
  assert.equal(items[0].status, "running");
  assert.equal(items[0].historyItem.status, "cache_waiting");
  assert.equal(items[0].historyItem.traceId, "trace_current");
  assert.equal(items[0].historyItem.workflowRun.status, "cache_waiting");
});
