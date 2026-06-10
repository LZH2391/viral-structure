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

const { filterArtifactForWorkflowRun, resolveAnalysisHistoryMedia, withLoadedAnalysisHistoryArtifact } = loadAnalysisHistoryData();

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

test("loaded analysis detail hides old artifact outputs that do not belong to current workflow", () => {
  const loaded = withLoadedAnalysisHistoryArtifact({
    sampleVideoId: "sample_reused",
    title: "reused.mp4",
    status: "cache_waiting",
    updatedAt: "2026-06-10T00:00:00.000Z",
    createdAt: "2026-06-10T00:00:00.000Z",
    artifactId: null,
    traceId: "trace_current",
    runId: "run_current",
    stageId: "stage_current",
    durationSeconds: null,
    width: null,
    height: null,
    coverUri: null,
    videoUri: null,
    hasFunctionSlotAtomization: false,
    hasUserMaterialPack: false,
    isIncomplete: false,
    isRunning: true,
    workflowKey: "full-analysis",
    workflowRun: {
      workflowRunId: "workflow_current",
      workflowKey: "full-analysis",
      status: "cache_waiting",
      traceId: "trace_current",
      runId: "run_current",
      stages: [
        { key: "upload", status: "processed" },
        { key: "shotBoundary", status: "cache_waiting", childJobId: "job_shot" },
        { key: "scriptSegment", status: "pending" },
      ],
    },
    runtimeState: null,
    artifact: null,
  }, {
    status: "processed",
    sampleVideo: {
      artifactId: "artifact_sample",
      original: { summary: "reused.mp4", uri: "/runtime/original.mp4" },
      normalized: { uri: "/runtime/video.mp4" },
    },
    metadata: { durationSeconds: 27, width: 1920, height: 1080 },
    frames: [],
    shotBoundaryAnalysis: { artifactId: "artifact_old_shot" },
    scriptSegmentAnalysis: { artifactId: "artifact_old_script", segments: [{ segmentId: "s1" }] },
    functionSlotAtomizationAnalysis: { artifactId: "artifact_old_atomization" },
    trace: { traceId: "trace_old", runId: "run_old", stageId: "stage_old" },
  });

  assert.equal(loaded.status, "cache_waiting");
  assert.equal(loaded.hasFunctionSlotAtomization, false);
  assert.equal(loaded.artifact.shotBoundaryAnalysis, undefined);
  assert.equal(loaded.artifact.scriptSegmentAnalysis, undefined);
  assert.equal(loaded.artifact.functionSlotAtomizationAnalysis, undefined);
  assert.equal(loaded.traceId, "trace_current");
});

test("artifact filter keeps outputs owned by processed workflow stages", () => {
  const artifact = filterArtifactForWorkflowRun({
    status: "processed",
    sampleVideo: {
      artifactId: "artifact_sample",
      original: { summary: "owned.mp4", uri: "/runtime/original.mp4" },
      normalized: { uri: "/runtime/video.mp4" },
    },
    metadata: { durationSeconds: 27, width: 1920, height: 1080 },
    frames: [],
    shotBoundaryAnalysis: { artifactId: "artifact_shot" },
    scriptSegmentAnalysis: { artifactId: "artifact_script" },
    rhythmStructureAnalysis: { artifactId: "artifact_old_rhythm" },
  }, {
    workflowRunId: "workflow_current",
    stages: [
      { key: "shotBoundary", status: "processed", artifactId: "artifact_shot" },
      { key: "scriptSegment", status: "processed", artifactId: "artifact_script" },
      { key: "rhythmStructure", status: "pending", artifactId: null },
    ],
  });

  assert.equal(artifact.shotBoundaryAnalysis.artifactId, "artifact_shot");
  assert.equal(artifact.scriptSegmentAnalysis.artifactId, "artifact_script");
  assert.equal(artifact.rhythmStructureAnalysis, undefined);
});
