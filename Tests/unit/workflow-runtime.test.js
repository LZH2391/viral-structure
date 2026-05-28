const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkflowRunStore } = require("../../Apps/Api/lib/stores/workflow-run-store");
const { FULL_ANALYSIS_WORKFLOW_DESCRIPTOR, createFullAnalysisWorkflowService } = require("../../Apps/Api/lib/workflows/full-analysis/service");

function createHarness() {
  const jobs = new Map();
  const artifacts = new Map();
  const workflowRunStore = createWorkflowRunStore();
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
    enqueueUpload: async () => {
      jobs.set("job_upload", { jobId: "job_upload", sampleVideoId: "sample_1", status: "processed", stage: "sample.artifact.written", progress: 100, traceId: "trace_upload" });
      artifacts.set("sample_1", buildArtifact());
      return { processingJobId: "job_upload", sampleVideoId: "sample_1", traceId: "trace_upload" };
    },
  };
  const shotBoundaryService = {
    enqueue: async () => {
      const artifact = buildArtifact({ shot: true });
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
  };
  const moduleRegistry = {
    getByModuleId: (moduleId) => moduleDefinitions[moduleId] ?? null,
    startModule: async ({ moduleId }) => {
      const jobId = `job_${moduleId}`;
      const artifact = attachAnalysis(artifacts.get("sample_1"), moduleId);
      artifacts.set("sample_1", artifact);
      jobs.set(jobId, { jobId, sampleVideoId: "sample_1", status: "processed", stage: `${moduleId}.materialize`, progress: 100, traceId: `trace_${moduleId}` });
      return { processingJobId: jobId, sampleVideoId: "sample_1", traceId: `trace_${moduleId}` };
    },
  };
  const workflow = createFullAnalysisWorkflowService({
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
  return { workflow, stageLogs, jobs };
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
  assert.equal(persisted.runs.find((run) => run.workflowRunId === "workflow_running").status, "failed");
});

function buildArtifact({ shot = false } = {}) {
  return {
    sampleVideoId: "sample_1",
    sampleVideo: {
      artifactId: "artifact_video",
      parentArtifactId: null,
      normalized: { artifactId: "artifact_video_norm", parentArtifactId: "artifact_video", type: "normalized-video", uri: "/runtime/sample.mp4" },
      original: { artifactId: "artifact_video_raw", parentArtifactId: "artifact_video", type: "original-video", summary: "sample.mp4" },
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
  if (analysisId === "script-segments") {
    return { ...artifact, scriptSegmentAnalysis: { artifactId: "artifact_script", parentArtifactId: "artifact_shot", type: "script-segment-analysis", segments: [{ segmentId: "seg_1", start: 0, end: 10 }] } };
  }
  if (analysisId === "rhythm-structure") {
    return { ...artifact, rhythmStructureAnalysis: { artifactId: "artifact_rhythm", parentArtifactId: "artifact_shot", type: "rhythm-structure-analysis", sections: [{ sectionId: "rhythm_1", start: 0, end: 10 }] } };
  }
  if (analysisId === "function-slot-atomization") {
    return { ...artifact, functionSlotAtomizationAnalysis: { artifactId: "artifact_atomization", parentArtifactId: "artifact_packaging", type: "function-slot-atomization-analysis", slotMap: { slots: [{ slotId: "slot_1", label: "开场", slotType: "hook" }] } } };
  }
  return { ...artifact, packagingStructureAnalysis: { artifactId: "artifact_packaging", parentArtifactId: "artifact_shot", type: "packaging-structure-analysis", packagingBlocks: [{ blockId: "pack_1", start: 0, end: 10 }] } };
}
