const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkflowRunStore } = require("../../Apps/Api/lib/stores/workflow-run-store");
const { FULL_ANALYSIS_WORKFLOW_DESCRIPTOR, createFullAnalysisWorkflowService } = require("../../Apps/Api/lib/workflows/full-analysis/service");
const { MATERIAL_RECOGNITION_WORKFLOW_DESCRIPTOR, createMaterialRecognitionWorkflowService } = require("../../Apps/Api/lib/workflows/material-recognition/service");

function createHarness() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-runtime-"));
  const runtimeRoot = path.join(tmpDir, "Runtime");
  fs.mkdirSync(path.join(runtimeRoot, "Artifacts", "sample_1"), { recursive: true });
  const sourcePath = path.join(runtimeRoot, "Artifacts", "sample_1", "source.mp4");
  fs.writeFileSync(sourcePath, "sample-video");
  const jobs = new Map();
  const artifacts = new Map();
  const moduleStarts = [];
  const uploadFiles = [];
  let loadSampleArtifactImpl = async ({ sampleVideoId }) => artifacts.get(sampleVideoId) ?? null;
  const workflowRunStore = createWorkflowRunStore();
  const buildLocalArtifact = (options = {}) => buildArtifact({
    ...options,
    sourceUri: "/runtime/Artifacts/sample_1/source.mp4",
  });
  const stageLogs = [];
  const logger = {
    writeStageLog: async (entry) => {
      stageLogs.push(entry);
      return entry;
    },
    writeDebugSnapshot: async (entry) => ({ ...entry, uri: `/runtime/DebugSnapshots/${entry.stageName}.json` }),
  };
  const jobStore = {
    getJob: (jobId) => jobs.get(jobId) ?? null,
  };
  const service = {
    enqueueUpload: async ({ file }) => {
      uploadFiles.push(file);
      jobs.set("job_upload", { jobId: "job_upload", sampleVideoId: "sample_1", status: "processed", stage: "sample.artifact.written", progress: 100, traceId: "trace_upload" });
      artifacts.set("sample_1", buildLocalArtifact());
      return { processingJobId: "job_upload", sampleVideoId: "sample_1", traceId: "trace_upload" };
    },
  };
  const shotBoundaryService = {
    enqueue: async () => {
      const artifact = buildLocalArtifact({ shot: true });
      artifacts.set("sample_1", artifact);
      jobs.set("job_shot", { jobId: "job_shot", sampleVideoId: "sample_1", status: "processed", stage: "shot.boundary_merge", progress: 100, traceId: "trace_shot" });
      return { processingJobId: "job_shot", sampleVideoId: "sample_1", traceId: "trace_shot" };
    },
  };
  const moduleDefinitions = {
    "script-segments": { moduleId: "script-segments", ui: { stageKind: "scriptSegment", stageId: "script.segment.analyze", displayName: "脚本" }, artifact: { key: "scriptSegmentAnalysis" } },
    "rhythm-structure": { moduleId: "rhythm-structure", ui: { stageKind: "rhythmStructure", stageId: "rhythm.structure.analyze", displayName: "节奏" }, artifact: { key: "rhythmStructureAnalysis" } },
    "packaging-structure": { moduleId: "packaging-structure", ui: { stageKind: "packagingStructure", stageId: "packaging.structure.analyze", displayName: "包装" }, artifact: { key: "packagingStructureAnalysis" } },
    "function-slot-atomization": { moduleId: "function-slot-atomization", ui: { stageKind: "functionSlotAtomization", stageId: "function.slot.atomization.analyze", displayName: "原子化" }, artifact: { key: "functionSlotAtomizationAnalysis" } },
    "user-material-tagger": { moduleId: "user-material-tagger", ui: { stageKind: "userMaterialTagger", stageId: "user.material.tagger.analyze", displayName: "素材识别" }, artifact: { key: "userMaterialPack" } },
  };
  const moduleRegistry = {
    getByModuleId: (moduleId) => moduleDefinitions[moduleId] ?? null,
    startModule: async ({ moduleId, sampleVideoId = "sample_1" }) => {
      moduleStarts.push(moduleId);
      const jobId = `job_${moduleId}`;
      const artifact = attachAnalysis(artifacts.get(sampleVideoId), moduleId);
      artifacts.set(sampleVideoId, artifact);
      jobs.set(jobId, { jobId, sampleVideoId, status: "processed", stage: `${moduleId}.materialize`, progress: 100, traceId: `trace_${moduleId}` });
      return { processingJobId: jobId, sampleVideoId, traceId: `trace_${moduleId}` };
    },
  };
  const workflow = createFullAnalysisWorkflowService({
    workflowRunStore,
    service,
    shotBoundaryService,
    moduleRegistry,
    jobStore,
    logger,
    store: { runtimeRoot },
    artifactIndex: {},
    loadSampleArtifact: (args) => loadSampleArtifactImpl(args),
    pollIntervalMs: 60_000,
  });
  return {
    workflow,
    tmpDir,
    runtimeRoot,
    sourcePath,
    uploadFiles,
    stageLogs,
    jobs,
    artifacts,
    moduleStarts,
    workflowRunStore,
    service,
    shotBoundaryService,
    moduleRegistry,
    jobStore,
    logger,
    setLoadSampleArtifact: (loader) => {
      loadSampleArtifactImpl = loader;
    },
  };
}

test("full analysis workflow advances upload, shot, parallel analyses, and aggregate", async () => {
  const { workflow, stageLogs } = createHarness();
  const started = await workflow.start({
    workspaceId: "default-workspace",
    file: { name: "sample.mp4", type: "video/mp4", size: 12, buffer: Buffer.from("sample") },
    fields: {},
  });

  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);

  const run = workflow.get(started.workflowRunId);
  assert.equal(run.status, "processed");
  assert.equal(workflow.getLatest().workflowRunId, started.workflowRunId);
  assert.equal(workflow.getLatestBySampleVideoId("sample_1").workflowRunId, started.workflowRunId);
  assert.equal(workflow.getLatestBySampleVideoId("sample_missing"), null);
  assert.equal(run.sampleVideoId, "sample_1");
  assert.deepEqual(run.stages.map((stage) => [stage.key, stage.status]), [
    ["upload", "processed"],
    ["shotBoundary", "processed"],
    ["scriptSegment", "processed"],
    ["rhythmStructure", "processed"],
    ["packagingStructure", "processed"],
    ["functionSlotAtomization", "processed"],
    ["aggregate", "processed"],
  ]);
  assert.ok(stageLogs.some((entry) => entry.stageName === "workflow.aggregate" && entry.event === "stage.end"));
});

test("full analysis workflow descriptor defines module nodes and parallel analysis group", () => {
  assert.equal(FULL_ANALYSIS_WORKFLOW_DESCRIPTOR.workflowId, "full-analysis");
  assert.deepEqual(FULL_ANALYSIS_WORKFLOW_DESCRIPTOR.parallelGroups["structure-analysis"], ["scriptSegment", "rhythmStructure", "packagingStructure"]);
  assert.deepEqual(
    FULL_ANALYSIS_WORKFLOW_DESCRIPTOR.nodes.filter((node) => node.kind === "module").map((node) => node.moduleId),
    ["sample-ingest", "shot-boundary", "script-segments", "rhythm-structure", "packaging-structure", "function-slot-atomization"],
  );
});

test("full analysis workflow serializes concurrent advances before starting parallel stages", async () => {
  const { workflow, moduleStarts } = createHarness();
  const started = await workflow.start({
    workspaceId: "default-workspace",
    file: { name: "sample.mp4", type: "video/mp4", size: 12, buffer: Buffer.from("sample") },
    fields: {},
  });

  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await Promise.all([
    workflow.advance(started.workflowRunId),
    workflow.advance(started.workflowRunId),
    workflow.advance(started.workflowRunId),
  ]);

  assert.equal(moduleStarts.filter((moduleId) => moduleId === "script-segments").length, 1);
  assert.equal(moduleStarts.filter((moduleId) => moduleId === "rhythm-structure").length, 1);
  assert.equal(moduleStarts.filter((moduleId) => moduleId === "packaging-structure").length, 1);
});

test("material recognition workflow runs upload, shot boundary, material tagging, and aggregate", async () => {
  const { workflowRunStore, service, shotBoundaryService, moduleRegistry, jobStore, logger, artifacts } = createHarness();
  const workflow = createMaterialRecognitionWorkflowService({
    workflowRunStore,
    service,
    shotBoundaryService,
    moduleRegistry,
    jobStore,
    logger,
    store: {},
    artifactIndex: {},
    loadSampleArtifact: async ({ sampleVideoId }) => artifacts.get(sampleVideoId) ?? null,
    pollIntervalMs: 60_000,
  });
  const started = await workflow.start({
    workspaceId: "default-workspace",
    file: { name: "material.mp4", type: "video/mp4", size: 12, buffer: Buffer.from("material") },
    fields: {},
  });

  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);

  const run = workflow.get(started.workflowRunId);
  assert.equal(MATERIAL_RECOGNITION_WORKFLOW_DESCRIPTOR.workflowId, "material-recognition");
  assert.equal(run.status, "processed");
  assert.deepEqual(run.stages.map((stage) => [stage.key, stage.status]), [
    ["upload", "processed"],
    ["shotBoundary", "processed"],
    ["userMaterialTagger", "processed"],
    ["aggregate", "processed"],
  ]);
  assert.equal(run.workflowKey, "material-recognition");
  assert.equal(run.stages.find((stage) => stage.key === "aggregate").outputSummary.shotCount, 1);
  assert.equal(run.stages.find((stage) => stage.key === "aggregate").outputSummary.userMaterialShotCardCount, 1);
});

test("material recognition workflow continues after upload cache reuse", async () => {
  const { workflowRunStore, shotBoundaryService, moduleRegistry, jobStore, logger, artifacts } = createHarness();
  artifacts.set("sample_cached", buildArtifact({ sampleVideoId: "sample_cached" }));
  const service = {
    enqueueUpload: async () => ({
      cacheHit: true,
      cachedItem: {
        sampleVideoId: "sample_cached",
        artifactId: "artifact_video",
      },
    }),
  };
  const workflow = createMaterialRecognitionWorkflowService({
    workflowRunStore,
    service,
    shotBoundaryService,
    moduleRegistry,
    jobStore,
    logger,
    store: {},
    artifactIndex: {},
    loadSampleArtifact: async ({ sampleVideoId }) => artifacts.get(sampleVideoId) ?? null,
    pollIntervalMs: 60_000,
  });
  const started = await workflow.start({
    workspaceId: "default-workspace",
    file: { name: "cached.mp4", type: "video/mp4", size: 12, buffer: Buffer.from("cached") },
    fields: { cacheDecision: "reuse" },
  });

  await workflow.advance(started.workflowRunId);

  const run = workflow.get(started.workflowRunId);
  assert.equal(run.sampleVideoId, "sample_cached");
  assert.equal(run.stages.find((stage) => stage.key === "upload").status, "processed");
  assert.equal(run.stages.find((stage) => stage.key === "shotBoundary").status, "running");
});

test("full analysis workflow can skip atomization when disabled", async () => {
  const { workflow } = createHarness();
  const started = await workflow.start({
    workspaceId: "default-workspace",
    file: { name: "sample.mp4", type: "video/mp4", size: 12, buffer: Buffer.from("sample") },
    fields: { enableFunctionSlotAtomization: "false" },
  });

  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);

  const run = workflow.get(started.workflowRunId);
  const atomization = run.stages.find((stage) => stage.key === "functionSlotAtomization");
  assert.equal(run.status, "processed");
  assert.equal(atomization.status, "processed");
  assert.equal(atomization.outputSummary.skipped, true);
});

test("full analysis rerun resets aggregate and recovers completed child stage", async () => {
  const { workflow, jobs } = createHarness();
  const started = await workflow.start({
    workspaceId: "default-workspace",
    file: { name: "sample.mp4", type: "video/mp4", size: 12, buffer: Buffer.from("sample") },
    fields: {},
  });

  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);

  const rerun = await workflow.rerunStage({ workflowRunId: started.workflowRunId, stageKey: "functionSlotAtomization" });
  assert.equal(rerun.status, "running");
  assert.equal(rerun.stages.find((stage) => stage.key === "functionSlotAtomization").status, "running");
  assert.equal(rerun.stages.find((stage) => stage.key === "aggregate").status, "pending");

  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  const recovered = workflow.get(started.workflowRunId);
  const atomization = recovered.stages.find((stage) => stage.key === "functionSlotAtomization");
  const aggregate = recovered.stages.find((stage) => stage.key === "aggregate");
  assert.equal(recovered.status, "processed");
  assert.equal(atomization.status, "processed");
  assert.equal(atomization.artifactId, "artifact_atomization");
  assert.equal(aggregate.status, "processed");
  assert.equal(aggregate.outputSummary.functionSlotCount, 1);
});

test("full analysis rerun upload refreshes source and resets downstream stages", async () => {
  const { workflow, uploadFiles } = createHarness();
  const started = await workflow.start({
    workspaceId: "default-workspace",
    file: { filename: "sample.mp4", mimeType: "video/mp4", extension: ".mp4", size: 12, buffer: Buffer.from("sample") },
    fields: {},
  });

  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);

  const rerun = await workflow.rerunStage({ workflowRunId: started.workflowRunId, stageKey: "upload" });
  const upload = rerun.stages.find((stage) => stage.key === "upload");
  const shot = rerun.stages.find((stage) => stage.key === "shotBoundary");
  const aggregate = rerun.stages.find((stage) => stage.key === "aggregate");

  assert.equal(rerun.status, "running");
  assert.equal(upload.status, "running");
  assert.equal(upload.attemptNo, 2);
  assert.equal(shot.status, "pending");
  assert.equal(aggregate.status, "pending");
  assert.equal(uploadFiles.at(-1).filename, "sample.mp4");
  assert.equal(uploadFiles.at(-1).buffer.toString(), "sample-video");
});

test("full analysis rerun waits for in-flight advance before resetting stage", async () => {
  const { workflow, jobs, artifacts, moduleStarts, setLoadSampleArtifact } = createHarness();
  const started = await workflow.start({
    workspaceId: "default-workspace",
    file: { name: "sample.mp4", type: "video/mp4", size: 12, buffer: Buffer.from("sample") },
    fields: {},
  });

  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);
  await workflow.advance(started.workflowRunId);

  let releaseArtifact;
  const slowArtifact = new Promise((resolve) => {
    releaseArtifact = () => resolve(artifacts.get("sample_1") ?? null);
  });
  let delayedOnce = false;
  setLoadSampleArtifact(async (args) => {
    if (!delayedOnce) {
      delayedOnce = true;
      return slowArtifact;
    }
    return artifacts.get(args.sampleVideoId) ?? null;
  });
  const advancePromise = workflow.advance(started.workflowRunId);
  const rerunPromise = workflow.rerunStage({ workflowRunId: started.workflowRunId, stageKey: "scriptSegment" });
  releaseArtifact();
  await advancePromise;
  await rerunPromise;

  const run = workflow.get(started.workflowRunId);
  const script = run.stages.find((stage) => stage.key === "scriptSegment");
  const atomization = run.stages.find((stage) => stage.key === "functionSlotAtomization");
  assert.equal(script.status, "running");
  assert.equal(script.attemptNo, 2);
  assert.equal(script.childJobId, "job_script-segments");
  assert.equal(atomization.status, "pending");
  assert.equal(moduleStarts.filter((moduleId) => moduleId === "script-segments").length, 2);
  assert.equal(jobs.get("job_script-segments").status, "processed");
});

test("full analysis advance repairs processed run with running completed child", async () => {
  const { workflow, jobs, artifacts, workflowRunStore } = createHarness();
  artifacts.set("sample_1", attachAnalysis(attachAnalysis(attachAnalysis(attachAnalysis(buildArtifact({ shot: true }), "script-segments"), "rhythm-structure"), "packaging-structure"), "function-slot-atomization"));
  jobs.set("job_function-slot-atomization", {
    jobId: "job_function-slot-atomization",
    sampleVideoId: "sample_1",
    status: "processed",
    stage: "function-slot-atomization.materialize",
    progress: 100,
    traceId: "trace_function-slot-atomization",
  });
  workflowRunStore.createRun({
    workflowRunId: "workflow_dirty",
    workflowKey: "full-analysis",
    workflowVersion: "full-analysis.v1",
    status: "processed",
    traceId: "trace_workflow",
    runId: "run_workflow",
    sampleVideoId: "sample_1",
    currentStageKeys: [],
    stages: [
      { key: "upload", stageName: "sample.ingest", label: "上传", status: "processed", artifactKey: "sampleVideo", artifactId: "artifact_video", childJobId: "job_upload" },
      { key: "shotBoundary", stageName: "shot.boundary", label: "切镜", status: "processed", artifactKey: "shotBoundaryAnalysis", artifactId: "artifact_shot", childJobId: "job_shot" },
      { key: "scriptSegment", stageName: "script.segment.analyze", label: "脚本", status: "processed", artifactKey: "scriptSegmentAnalysis", artifactId: "artifact_script", childJobId: "job_script-segments" },
      { key: "rhythmStructure", stageName: "rhythm.structure.analyze", label: "节奏", status: "processed", artifactKey: "rhythmStructureAnalysis", artifactId: "artifact_rhythm", childJobId: "job_rhythm-structure" },
      { key: "packagingStructure", stageName: "packaging.structure.analyze", label: "包装", status: "processed", artifactKey: "packagingStructureAnalysis", artifactId: "artifact_packaging", childJobId: "job_packaging-structure" },
      { key: "functionSlotAtomization", stageName: "function.slot.atomization.analyze", label: "原子化", status: "running", artifactKey: "functionSlotAtomizationAnalysis", childJobId: "job_function-slot-atomization", childTraceId: "trace_function-slot-atomization", artifactId: null, parentArtifactId: null },
      { key: "aggregate", stageName: "workflow.aggregate", label: "汇总", status: "processed", artifactKey: "sampleVideo", artifactId: "artifact_video", outputSummary: { functionSlotCount: 0 }, after: ["functionSlotAtomization"] },
    ],
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:01:00.000Z",
    completedAt: "2026-05-28T00:01:00.000Z",
    errorSummary: null,
  });

  await workflow.advance("workflow_dirty");
  await workflow.advance("workflow_dirty");
  const run = workflow.get("workflow_dirty");
  const atomization = run.stages.find((stage) => stage.key === "functionSlotAtomization");
  const aggregate = run.stages.find((stage) => stage.key === "aggregate");
  assert.equal(run.status, "processed");
  assert.equal(atomization.status, "processed");
  assert.equal(atomization.artifactId, "artifact_atomization");
  assert.equal(aggregate.status, "processed");
  assert.equal(aggregate.outputSummary.functionSlotCount, 1);
});

test("full analysis workflow exposes cache waiting as recoverable run state", async () => {
  const { workflow, jobs } = createHarness();
  const started = await workflow.start({
    workspaceId: "default-workspace",
    file: { name: "sample.mp4", type: "video/mp4", size: 12, buffer: Buffer.from("sample") },
    fields: {},
  });

  await workflow.advance(started.workflowRunId);
  jobs.set("job_shot-boundary", {
    jobId: "job_shot-boundary",
    sampleVideoId: "sample_1",
    status: "cache_waiting",
    stage: "shot.cache_lookup",
    progress: 55,
    traceId: "trace_shot",
    cachePrompt: { cacheKind: "shot_boundary", cachedItem: { sampleVideoId: "sample_1" } },
  });
  await workflow.advance(started.workflowRunId);

  const waiting = workflow.get(started.workflowRunId);
  const shot = waiting.stages.find((stage) => stage.key === "shotBoundary");
  assert.equal(waiting.status, "cache_waiting");
  assert.equal(shot.status, "cache_waiting");
  assert.equal(shot.outputSummary.cacheWaiting, true);

  jobs.set("job_shot-boundary", { ...jobs.get("job_shot-boundary"), status: "processing", progress: 56 });
  await workflow.advance(started.workflowRunId);
  const resumed = workflow.get(started.workflowRunId);
  assert.equal(resumed.status, "running");
  assert.equal(resumed.stages.find((stage) => stage.key === "shotBoundary").status, "running");
});

test("full analysis workflow fails stage when child job start returns no job id", async () => {
  const { workflow, moduleRegistry } = createHarness();
  moduleRegistry.startModule = async ({ moduleId }) => {
    if (moduleId === "shot-boundary") return { ok: true, sampleVideoId: "sample_1", traceId: "trace_missing_job" };
    throw new Error("unexpected module start");
  };
  const started = await workflow.start({
    workspaceId: "default-workspace",
    file: { name: "sample.mp4", type: "video/mp4", size: 12, buffer: Buffer.from("sample") },
    fields: {},
  });

  await assert.rejects(
    () => workflow.advance(started.workflowRunId),
    { code: "workflow_child_job_start_invalid" },
  );
  const run = workflow.get(started.workflowRunId);
  const shot = run.stages.find((stage) => stage.key === "shotBoundary");
  assert.equal(run.status, "failed");
  assert.equal(shot.status, "failed");
  assert.equal(shot.childJobId, null);
  assert.equal(shot.errorSummary.code, "workflow_child_job_start_invalid");
});

test("workflow run store marks running persisted runs as failed on restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-restart-"));
  const filePath = path.join(dir, "workflow-runs.json");
  fs.writeFileSync(filePath, JSON.stringify({
    runs: [
      {
        workflowRunId: "workflow_running",
        workflowKey: "full-analysis",
        workflowVersion: "full-analysis.v1",
        status: "running",
        traceId: "trace_workflow",
        runId: "run_workflow",
        sampleVideoId: "sample_1",
        currentStageKeys: ["scriptSegment"],
        stages: [
          { key: "upload", stageName: "sample.ingest", status: "processed" },
          { key: "scriptSegment", stageName: "script.segment.analyze", status: "running" },
          { key: "rhythmStructure", stageName: "rhythm.structure.analyze", status: "pending" },
        ],
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:01:00.000Z",
      },
      {
        workflowRunId: "workflow_processed",
        workflowKey: "full-analysis",
        workflowVersion: "full-analysis.v1",
        status: "processed",
        traceId: "trace_done",
        runId: "run_done",
        currentStageKeys: [],
        stages: [],
      },
    ],
  }), "utf8");

  const store = createWorkflowRunStore({ filePath });
  const running = store.getRun("workflow_running");
  const processed = store.getRun("workflow_processed");

  assert.equal(running.status, "failed");
  assert.deepEqual(running.currentStageKeys, []);
  assert.equal(running.errorSummary.code, "workflow_run_interrupted_by_restart");
  assert.equal(running.errorSummary.retryable, true);
  assert.equal(running.stages.find((stage) => stage.key === "scriptSegment").status, "failed");
  assert.equal(running.stages.find((stage) => stage.key === "rhythmStructure").status, "pending");
  assert.equal(processed.status, "processed");

  const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(persisted.schemaVersion, 2);
  assert.equal(persisted.storage.mode, "per-run-file");
  assert.equal(persisted.runRefs.find((run) => run.workflowRunId === "workflow_running").status, "failed");
  assert.equal(persisted.runRefs.some((run) => Array.isArray(run.stages)), false);

  const runFile = path.join(dir, persisted.runRefs.find((run) => run.workflowRunId === "workflow_running").file);
  const persistedRun = JSON.parse(fs.readFileSync(runFile, "utf8"));
  assert.equal(persistedRun.status, "failed");
  assert.equal(persistedRun.stages.find((stage) => stage.key === "scriptSegment").status, "failed");
});

test("workflow run store persists each run in its own file and reloads through index refs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-files-"));
  const filePath = path.join(dir, "workflow-runs.json");
  const store = createWorkflowRunStore({ filePath });
  store.createRun({
    workflowRunId: "workflow_one",
    workflowKey: "full-analysis",
    workflowVersion: "full-analysis.v1",
    status: "running",
    traceId: "trace_one",
    runId: "run_one",
    sampleVideoId: "sample_1",
    currentStageKeys: [],
    stages: [{ key: "upload", stageName: "sample.ingest", status: "processed" }],
    createdAt: "2026-05-27T00:00:00.000Z",
  });
  store.updateRun("workflow_one", { status: "processed", completedAt: "2026-05-27T00:01:00.000Z" });

  const index = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(index.runRefs.length, 1);
  assert.equal(index.runRefs[0].file, "runs/workflow_one.json");
  assert.equal(index.runRefs[0].status, "processed");
  assert.equal(index.runRefs[0].stages, undefined);

  const runPath = path.join(dir, "runs", "workflow_one.json");
  const runFile = JSON.parse(fs.readFileSync(runPath, "utf8"));
  assert.deepEqual(runFile.stages.map((stage) => stage.key), ["upload"]);

  const reloaded = createWorkflowRunStore({ filePath });
  assert.equal(reloaded.getRun("workflow_one").status, "processed");
  assert.deepEqual(reloaded.listRuns().map((run) => run.workflowRunId), ["workflow_one"]);
});

test("workflow run store rejects stale active turn updates when only attempt matches", () => {
  const store = createWorkflowRunStore();
  store.createRun({
    workflowRunId: "workflow_turn_identity",
    workflowKey: "full-analysis",
    workflowVersion: "full-analysis.v1",
    status: "running",
    traceId: "trace_turn_identity",
    runId: "run_turn_identity",
    sampleVideoId: "sample_1",
    currentStageKeys: ["scriptSegment"],
    stages: [{
      key: "scriptSegment",
      stageName: "script.segment.analyze",
      status: "running",
      activeTurn: {
        turnId: "turn_current",
        currentAttemptId: "attempt_shared",
        status: "running",
      },
    }],
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
  });

  const stale = store.updateStageTurnState("workflow_turn_identity", {
    turnId: "turn_old",
    currentAttemptId: "attempt_shared",
    status: "completed",
  });
  assert.equal(stale.status, "stale");
  assert.equal(store.getRun("workflow_turn_identity").stages[0].status, "running");
  assert.equal(store.getRun("workflow_turn_identity").stages[0].activeTurn.status, "running");

  const current = store.updateStageTurnState("workflow_turn_identity", {
    turnId: "turn_current",
    currentAttemptId: "attempt_shared",
    status: "completed",
  });
  assert.equal(current.status, "completed");
  assert.equal(store.getRun("workflow_turn_identity").stages[0].status, "completed");
});

test("workflow run store ignores out-of-root run refs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-safety-"));
  const filePath = path.join(dir, "workflow-runs.json");
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 2,
    storage: { mode: "per-run-file", runsDir: "runs" },
    runRefs: [
      { workflowRunId: "workflow_bad", file: "../outside.json" },
    ],
  }), "utf8");

  const store = createWorkflowRunStore({ filePath });
  assert.equal(store.getRun("workflow_bad"), null);
  assert.deepEqual(store.listRuns(), []);
});

test("workflow run store treats index as rebuildable cache", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-index-cache-"));
  const filePath = path.join(dir, "workflow-runs.json");
  fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 2,
    storage: { mode: "per-run-file", runsDir: "runs" },
    runRefs: [],
  }), "utf8");
  fs.writeFileSync(path.join(dir, "runs", "workflow_unindexed.json"), JSON.stringify({
    workflowRunId: "workflow_unindexed",
    workflowKey: "material-recognition",
    workflowVersion: "material-recognition.v1",
    status: "processed",
    traceId: "trace_unindexed",
    runId: "run_unindexed",
    currentStageKeys: [],
    stages: [],
  }), "utf8");

  const store = createWorkflowRunStore({ filePath });

  assert.equal(store.getRun("workflow_unindexed").status, "processed");
  assert.deepEqual(store.listRuns().map((run) => run.workflowRunId), ["workflow_unindexed"]);
});

function buildArtifact({ shot = false, sampleVideoId = "sample_1", sourceUri = "/runtime/sample.mp4" } = {}) {
  return {
    sampleVideoId,
    sampleVideo: {
      artifactId: "artifact_video",
      parentArtifactId: null,
      normalized: { artifactId: "artifact_video_norm", parentArtifactId: "artifact_video", type: "normalized-video", uri: sourceUri },
      original: { artifactId: "artifact_video_raw", parentArtifactId: "artifact_video", type: "original-video", uri: sourceUri, summary: "sample.mp4" },
    },
    frames: [],
    metadata: { durationSeconds: 10 },
    status: "processed",
    ...(shot ? {
      shotBoundaryAnalysis: {
        artifactId: "artifact_shot",
        parentArtifactId: "artifact_video",
        type: "shot-boundary-analysis",
        shots: [{ id: "shot_1", start: 0, end: 10 }],
      },
    } : {}),
  };
}

function attachAnalysis(artifact, analysisId) {
  if (analysisId === "shot-boundary") {
    return {
      ...artifact,
      shotBoundaryAnalysis: {
        artifactId: "artifact_shot",
        parentArtifactId: "artifact_video",
        type: "shot-boundary-analysis",
        shots: [{ id: "shot_1", start: 0, end: 10 }],
      },
    };
  }
  if (analysisId === "script-segments") {
    return { ...artifact, scriptSegmentAnalysis: { artifactId: "artifact_script", parentArtifactId: "artifact_shot", type: "script-segment-analysis", segments: [{ segmentId: "seg_1", start: 0, end: 10 }] } };
  }
  if (analysisId === "rhythm-structure") {
    return { ...artifact, rhythmStructureAnalysis: { artifactId: "artifact_rhythm", parentArtifactId: "artifact_shot", type: "rhythm-structure-analysis", sections: [{ sectionId: "rhythm_1", start: 0, end: 10 }] } };
  }
  if (analysisId === "function-slot-atomization") {
    return { ...artifact, functionSlotAtomizationAnalysis: { artifactId: "artifact_atomization", parentArtifactId: "artifact_packaging", type: "function-slot-atomization-analysis", slotMap: { slots: [{ slotId: "slot_1", label: "开场", slotType: "hook" }] } } };
  }
  if (analysisId === "user-material-tagger") {
    return { ...artifact, userMaterialPack: { artifactId: "artifact_material", parentArtifactId: "artifact_shot", type: "user-material-pack", shotCards: [{ shotId: "shot_1", shotNo: "S1", shotClass: "product_closeup", timeRange: { start: 0, end: 10 }, visualSummary: "商品近景", constraints: [] }], materialGroups: [] } };
  }
  return { ...artifact, packagingStructureAnalysis: { artifactId: "artifact_packaging", parentArtifactId: "artifact_shot", type: "packaging-structure-analysis", packagingBlocks: [{ blockId: "pack_1", start: 0, end: 10 }] } };
}
