const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function loadAnalysisHistoryData() {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/analysisHistoryData.ts"), "utf8");
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
      if (request === "../../api/client") return { runtimeUrl: (uri) => uri ?? null };
      if (request === "../../api/platformClient") return { getAnalysisHistoryProjection: async () => ({ summary: { items: [] } }) };
      if (request === "../../utils/format") return { formatSecondsCompact: (seconds) => `${seconds ?? 0}s` };
      return {};
    },
    Date,
  });
  return module.exports;
}

const { resolveAnalysisHistoryMedia } = loadAnalysisHistoryData();

test("analysis history badge prefers running material recognition over completed material pack", () => {
  const media = resolveAnalysisHistoryMedia({
    sampleVideoId: "sample_material",
    title: "缺失6.mp4",
    status: "running",
    updatedAt: "2026-06-10T00:00:00.000Z",
    createdAt: "2026-06-10T00:00:00.000Z",
    artifactId: "artifact_user_material_pack",
    traceId: "trace_material",
    runId: "run_material",
    stageId: "stage_material",
    durationSeconds: 5.6,
    width: 720,
    height: 1280,
    coverUri: "/runtime/cover.jpg",
    videoUri: "/runtime/video.mp4",
    hasFunctionSlotAtomization: false,
    hasUserMaterialPack: true,
    isIncomplete: false,
    isRunning: true,
    workflowKey: "material-recognition",
    workflowRun: { workflowKey: "material-recognition", status: "running" },
    runtimeState: null,
    artifact: null,
  });

  assert.equal(media.badgeLabel, "识别中");
  assert.equal(media.analysisKind, "material");
});

test("analysis history badge still shows completed material pack when no run is active", () => {
  const media = resolveAnalysisHistoryMedia({
    sampleVideoId: "sample_material_done",
    title: "缺失6.mp4",
    status: "processed",
    updatedAt: "2026-06-10T00:00:00.000Z",
    createdAt: "2026-06-10T00:00:00.000Z",
    artifactId: "artifact_user_material_pack",
    traceId: "trace_material_done",
    runId: "run_material_done",
    stageId: "stage_material_done",
    durationSeconds: 5.6,
    width: 720,
    height: 1280,
    coverUri: "/runtime/cover.jpg",
    videoUri: "/runtime/video.mp4",
    hasFunctionSlotAtomization: false,
    hasUserMaterialPack: true,
    isIncomplete: false,
    isRunning: false,
    workflowKey: "material-recognition",
    workflowRun: null,
    runtimeState: null,
    artifact: null,
  });

  assert.equal(media.badgeLabel, "已完成");
});

test("analysis history badge keeps completed pack over cache waiting residue", () => {
  const media = resolveAnalysisHistoryMedia({
    sampleVideoId: "sample_material_cache_waiting",
    title: "缺失3.mp4",
    status: "cache_waiting",
    updatedAt: "2026-06-10T00:00:00.000Z",
    createdAt: "2026-06-10T00:00:00.000Z",
    artifactId: "artifact_user_material_pack",
    traceId: "trace_material_cache_waiting",
    runId: "run_material_cache_waiting",
    stageId: "stage_material_cache_waiting",
    durationSeconds: 10.7,
    width: 720,
    height: 1280,
    coverUri: "/runtime/cover.jpg",
    videoUri: "/runtime/video.mp4",
    hasFunctionSlotAtomization: false,
    hasUserMaterialPack: true,
    isIncomplete: false,
    isRunning: true,
    workflowKey: "material-recognition",
    workflowRun: { workflowKey: "material-recognition", status: "cache_waiting" },
    runtimeState: null,
    artifact: null,
  });

  assert.equal(media.badgeLabel, "已完成");
});
