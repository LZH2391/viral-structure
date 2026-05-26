const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { createJobStore } = require("../../Apps/Api/lib/stores/job-store");
const { createScriptSegmentService } = require("../../Apps/Api/lib/script-segment/service");
const { createArtifactCacheParamBuilders } = require("../../Apps/Api/lib/modules/cache-param-builders");
const { createArtifactIndex, hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");

async function createScriptHarness({ appServer = {} } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-script-segment-agent-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1", cacheParamBuilders: createArtifactCacheParamBuilders() });
  const artifact = createArtifact();
  await store.ensureSampleDirs(artifact.sampleVideoId);
  await seedFrameFiles(store, artifact);
  await store.writeJson(path.join(store.sampleDir(artifact.sampleVideoId), "artifact.json"), artifact);
  await artifactIndex.registerSampleArtifact({ artifact, fileHash: hashBuffer(Buffer.from("script-segment-video")), traceId: "trace_source" });

  const calls = { acquire: [], started: [], collected: [], release: [] };
  const threadPool = {
    ensureRoleReady: async (role) => ({ ok: true, role, status: { role, canAcquire: true, readyForLeases: true, warming: false, warmupError: null, startupError: null } }),
    acquireLease: async (payload) => {
      calls.acquire.push(payload);
      return { lease_id: "lease_script_1", thread_id: "thread_script_1" };
    },
    releaseLease: async (payload) => {
      calls.release.push(payload);
      return { ok: true };
    },
    discardThread: async () => ({ ok: true }),
    releaseOwnerLeases: async () => ({ ok: true }),
  };
  const bridge = {
    startTurnWithInputs: async (...args) => appServer.startTurnWithInputs(...args),
    collectTurnResult: async (...args) => appServer.collectTurnResult(...args),
  };

  const service = createScriptSegmentService({
    rootDir: tempRoot,
    store,
    logger,
    jobStore,
    artifactIndex,
    threadPool,
    appServer: bridge,
    pollIntervalMs: 1,
  });
  return { store, logger, jobStore, artifactIndex, service, calls };
}

async function seedFrameFiles(store, artifact) {
  const framesDir = path.join(store.sampleDir(artifact.sampleVideoId), "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const pixel = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: "#ffffff",
    },
  }).jpeg().toBuffer();
  for (let index = 0; index < (artifact.frames?.length ?? 0); index += 1) {
    const filePath = path.join(framesDir, `frame-${index + 1}.jpg`);
    await fs.writeFile(filePath, pixel);
    artifact.frames[index].imageUri = store.runtimeUri(filePath);
  }
}

function createArtifact(overrides = {}) {
  return {
    sampleVideoId: "sample_script_1",
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
      { frameId: "frame_2", artifactId: "artifact_frame_2", parentArtifactId: "artifact_sample", timestamp: 1.2, imageUri: "/runtime/frame-2.jpg" },
      { frameId: "frame_3", artifactId: "artifact_frame_3", parentArtifactId: "artifact_sample", timestamp: 3.8, imageUri: "/runtime/frame-3.jpg" },
    ],
    audio: { artifactId: "artifact_audio", parentArtifactId: "artifact_sample", type: "audio-track", uri: "/runtime/audio.m4a", summary: "音频轨" },
    subtitles: overrides.subtitles === undefined ? null : overrides.subtitles,
    shotBoundaryAnalysis: overrides.shotBoundaryAnalysis === undefined ? {
      artifactId: "artifact_shot_boundary",
      parentArtifactId: "artifact_sample",
      type: "shot-boundary-analysis",
      status: "processed",
      resultOrigin: "new_turn",
      sourceFrameArtifactIds: ["artifact_frame_1", "artifact_frame_2", "artifact_frame_3"],
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
        role: "shot-boundary-raw-analyze-legacy",
        skillPath: "C:/ByteDanceFullStack/.agents/skills/shot-boundary-raw-analyze-legacy/SKILL.md",
        skillHash: "skill_hash_shot",
        threadId: "thread_shot_1",
        leaseId: "lease_shot_1",
        turnId: "turn_shot_1",
      },
      shots: [
        { id: "shot_1", index: 0, shotNo: "S001", start: 0, end: 1.2, representativeFrameId: "frame_1", confidence: 0.83, reason: "开场结果", summary: "展示整理前后反差", endBoundaryReason: "cut" },
        { id: "shot_2", index: 1, shotNo: "S002", start: 1.2, end: 3.8, representativeFrameId: "frame_2", confidence: 0.79, reason: "使用演示", summary: "演示收纳盒摆放和分类", endBoundaryReason: "cut" },
        { id: "shot_3", index: 2, shotNo: "S003", start: 3.8, end: 6, representativeFrameId: "frame_3", confidence: 0.77, reason: "收束转化", summary: "回到整洁台面并提示点击", endBoundaryReason: null },
      ],
      createdAt: new Date().toISOString(),
    } : overrides.shotBoundaryAnalysis,
    metadata: { durationSeconds: 6, width: 720, height: 1280 },
  };
}

async function waitForJob(jobStore, jobId, status) {
  let lastJob = null;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const job = jobStore.getJob(jobId);
    lastJob = job;
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not reach ${status}: ${JSON.stringify(lastJob)}`);
}

async function waitForJobField(jobStore, jobId, predicate) {
  let lastJob = null;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const job = jobStore.getJob(jobId);
    lastJob = job;
    if (job && predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not match predicate: ${JSON.stringify(lastJob)}`);
}

module.exports = {
  createScriptHarness,
  seedFrameFiles,
  createArtifact,
  waitForJob,
  waitForJobField,
};
