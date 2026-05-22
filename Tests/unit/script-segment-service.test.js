const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger, expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");
const { createJobStore } = require("../../Apps/Api/lib/job-store");
const { createArtifactIndex, hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createScriptSegmentService, prepareInput, analyzeSegments, validateSegments, repairSegments } = require("../../Apps/Api/lib/script-segment-service");
const { loadRoleProfileByRole } = require("../../Apps/Api/lib/role-profile-loader");

test("prepareInput requires processed shot boundary shots", () => {
  assert.throws(() => prepareInput(createArtifact({ shotBoundaryAnalysis: null })), /可分析的切镜结果/);
});

test("validate and repair normalize invalid segment ordering", async () => {
  const roleProfile = await loadRoleProfileByRole("script-segment-analyzer");
  const input = prepareInput(createArtifact());
  const analyzed = analyzeSegments(input, roleProfile, "trace_script_1");
  analyzed.segments = [
    {
      segmentId: "segment_1",
      label: "开场引题",
      roleInScript: "建立停留理由",
      shotRefs: ["shot_1"],
      evidence: ["先亮出结果"],
      transferableRule: "先给结果再展开",
      confidence: 0.8,
      needReview: false,
      start: 1.2,
      end: 0.5,
    },
  ];

  const validated = validateSegments(analyzed);
  assert.equal(validated.validation.status, "failed");
  assert.equal(validated.validation.validatorCode, "script_segment_invalid_time_range");

  const repaired = repairSegments(validated, roleProfile, "trace_script_1");
  assert.equal(repaired.validation.status, "passed");
  assert.equal(repaired.validation.repairAttemptCount, 1);
  assert.equal(repaired.segments[0].end > repaired.segments[0].start, true);
  assert.equal(repaired.segments[0].needReview, true);
});

test("script segment service writes artifact, stage logs, and artifact index entry", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-script-segment-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1" });
  const artifact = createArtifact();
  const fileHash = hashBuffer(Buffer.from("script-segment-video"));
  await store.ensureSampleDirs(artifact.sampleVideoId);
  await store.writeJson(path.join(store.sampleDir(artifact.sampleVideoId), "artifact.json"), artifact);
  await artifactIndex.registerSampleArtifact({ artifact, fileHash, traceId: "trace_source" });

  const service = createScriptSegmentService({ store, logger, jobStore, artifactIndex });
  const started = await service.enqueue({ sampleVideoId: artifact.sampleVideoId });
  const job = await waitForJob(jobStore, started.processingJobId, "processed");

  assert.equal(job.status, "processed");
  const savedArtifact = await store.readJson(path.join(store.sampleDir(artifact.sampleVideoId), "artifact.json"));
  assert.equal(savedArtifact.scriptSegmentAnalysis.type, "script-segment-analysis");
  assert.equal(savedArtifact.scriptSegmentAnalysis.segments.length >= 2, true);
  assert.equal(savedArtifact.scriptSegmentAnalysis.validation.status, "passed");

  const detail = await artifactIndex.getItem(artifact.sampleVideoId);
  const segmentNode = detail.artifactTree.find((node) => node.stageName === "script_segment.materialize");
  assert.ok(segmentNode);
  assert.equal(segmentNode.summary.includes("段"), true);
  assert.equal(detail.tags.includes("结构理解"), true);

  const logText = await fs.readFile(path.join(store.runtimeRoot, "DebugSnapshots", `${started.traceId}.log.jsonl`), "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
  const stageNames = logs.map((line) => line.stageName);
  assert.ok(stageNames.includes("script_segment.input_prepare"));
  assert.ok(stageNames.includes("script_segment.analyze"));
  assert.ok(stageNames.includes("script_segment.validate"));
  assert.ok(stageNames.includes("script_segment.materialize"));
});

function createArtifact(overrides = {}) {
  return {
    sampleVideoId: overrides.sampleVideoId ?? "sample_script_1",
    workspaceId: "workspace_1",
    status: "processed",
    trace: { runId: "run_source", traceId: "trace_source", stageId: "stage_source" },
    processingOptions: { frameSampleRateFps: 3 },
    sampleVideo: {
      artifactId: "artifact_sample",
      parentArtifactId: null,
      original: { artifactId: "artifact_original", parentArtifactId: null, type: "original-video", uri: "/runtime/source.mp4", summary: "sample.mp4" },
      normalized: { artifactId: "artifact_normalized", parentArtifactId: "artifact_sample", type: "normalized-video", uri: "/runtime/source.mp4", summary: "标准化视频" },
    },
    cover: { artifactId: "artifact_cover", parentArtifactId: "artifact_sample", type: "cover-frame", uri: "/runtime/cover.jpg", summary: "封面帧" },
    frames: [
      { frameId: "frame_1", artifactId: "artifact_frame_1", parentArtifactId: "artifact_sample", timestamp: 0, imageUri: "/runtime/frame-1.jpg" },
      { frameId: "frame_2", artifactId: "artifact_frame_2", parentArtifactId: "artifact_sample", timestamp: 1, imageUri: "/runtime/frame-2.jpg" },
    ],
    audio: { artifactId: "artifact_audio", parentArtifactId: "artifact_sample", type: "audio-track", uri: "/runtime/audio.m4a", summary: "音频轨" },
    subtitles: null,
    shotBoundaryAnalysis: overrides.shotBoundaryAnalysis === undefined ? createShotBoundaryAnalysis() : overrides.shotBoundaryAnalysis,
    metadata: { durationSeconds: 6, width: 720, height: 1280 },
  };
}

function createShotBoundaryAnalysis() {
  return {
    artifactId: "artifact_shot_boundary",
    parentArtifactId: "artifact_sample",
    type: "shot-boundary-analysis",
    status: "processed",
    resultOrigin: "new_turn",
    sourceFrameArtifactIds: ["artifact_frame_1", "artifact_frame_2"],
    extractSampling: {
      requestedFps: 3,
      targetFrameCount: 18,
      actualFrameCount: 18,
      maxFrames: 6000,
      samplingPolicy: "fixed_interval_from_zero",
      cappedByMaxFrames: false,
    },
    analysisSampling: {
      fps: 1,
      requestedFps: 1,
      targetFrameCount: 6,
      selectedFrameCount: 6,
      effectiveFps: 1,
      selectionPolicy: "target_grid_nearest_unique",
      duplicatePolicy: "nearest_unselected_tie_later",
      roundingPolicy: "target_grid_nearest_unique",
      stride: null,
    },
    commerceBrief: {
      sellingObject: "厨房收纳好物",
      proofApproach: "实拍对比和使用演示",
      promisedOutcome: "减少台面杂乱",
      persuasionTarget: "想快速整理厨房的人",
      conversionAction: "点开橱窗了解",
      uncertainties: ["品牌信息未完全确认"],
    },
    validation: {
      status: "passed",
      rawBoundaryCount: 2,
      normalizedBoundaryCount: 2,
      repairAttemptCount: 0,
      validatorCode: null,
    },
    agent: {
      provider: "codex-appserver",
      role: "shot-boundary-analyzer",
      skillPath: "C:/ByteDanceFullStack/.agents/skills/shot-boundary-analyzer/SKILL.md",
      skillHash: "skill_hash_shot",
      threadId: "thread_shot_1",
      leaseId: "lease_shot_1",
      turnId: "turn_shot_1",
    },
    shots: [
      { id: "shot_1", index: 0, shotNo: "S001", start: 0, end: 1.2, representativeFrameId: "frame_1", confidence: 0.83, reason: "开场结果", summary: "展示整理前后反差", endBoundaryReason: "cut" },
      { id: "shot_2", index: 1, shotNo: "S002", start: 1.2, end: 3.8, representativeFrameId: "frame_2", confidence: 0.79, reason: "使用演示", summary: "演示收纳盒摆放和分类", endBoundaryReason: "cut" },
      { id: "shot_3", index: 2, shotNo: "S003", start: 3.8, end: 6, representativeFrameId: "frame_2", confidence: 0.77, reason: "收束转化", summary: "回到整洁台面并提示点击", endBoundaryReason: null },
    ],
    createdAt: new Date().toISOString(),
  };
}

async function waitForJob(jobStore, jobId, status) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = jobStore.getJob(jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not reach ${status}`);
}
