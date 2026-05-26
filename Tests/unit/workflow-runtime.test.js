const test = require("node:test");
const assert = require("node:assert/strict");
const { createWorkflowRunStore } = require("../../Apps/Api/lib/workflow-run-store");
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
  return { workflow, stageLogs };
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

  const run = workflow.get(started.workflowRunId);
  assert.equal(run.status, "processed");
  assert.equal(workflow.getLatest().workflowRunId, started.workflowRunId);
  assert.equal(run.sampleVideoId, "sample_1");
  assert.deepEqual(run.stages.map((stage) => [stage.key, stage.status]), [
    ["upload", "processed"],
    ["shotBoundary", "processed"],
    ["scriptSegment", "processed"],
    ["rhythmStructure", "processed"],
    ["packagingStructure", "processed"],
    ["aggregate", "processed"],
  ]);
  assert.ok(stageLogs.some((entry) => entry.stageName === "workflow.aggregate" && entry.event === "stage.end"));
});

test("full analysis workflow descriptor defines module nodes and parallel analysis group", () => {
  assert.equal(FULL_ANALYSIS_WORKFLOW_DESCRIPTOR.workflowId, "full-analysis");
  assert.deepEqual(FULL_ANALYSIS_WORKFLOW_DESCRIPTOR.parallelGroups["structure-analysis"], ["scriptSegment", "rhythmStructure", "packagingStructure"]);
  assert.deepEqual(
    FULL_ANALYSIS_WORKFLOW_DESCRIPTOR.nodes.filter((node) => node.kind === "module").map((node) => node.moduleId),
    ["sample-ingest", "shot-boundary", "script-segments", "rhythm-structure", "packaging-structure"],
  );
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
  return { ...artifact, packagingStructureAnalysis: { artifactId: "artifact_packaging", parentArtifactId: "artifact_shot", type: "packaging-structure-analysis", packagingBlocks: [{ blockId: "pack_1", start: 0, end: 10 }] } };
}
