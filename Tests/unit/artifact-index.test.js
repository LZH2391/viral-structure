const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger, expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");
const { createJobStore } = require("../../Apps/Api/lib/job-store");
const { createSampleProcessingService, STAGES } = require("../../Apps/Api/lib/sample-processing-service");
const { createArtifactIndex, createCacheKey, hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { buildShotBoundaryCacheParams } = require("../../Apps/Api/lib/shot-boundary-analysis");

test("cache key is stable and changes when params change", () => {
  const first = createCacheKey({ fileHash: "file_1", stageName: "sample.frames.extracted", params: { frameSampleRateFps: 1 }, version: "v1" });
  const reordered = createCacheKey({ version: "v1", params: { frameSampleRateFps: 1 }, stageName: "sample.frames.extracted", fileHash: "file_1" });
  const changed = createCacheKey({ fileHash: "file_1", stageName: "sample.frames.extracted", params: { frameSampleRateFps: 2 }, version: "v1" });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("artifact index registers list, detail, load and cache entries", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-artifact-index-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const index = createArtifactIndex({ store, processorVersion: "test-v1" });
  const artifact = createArtifact();
  const fileHash = hashBuffer(Buffer.from("video"));
  await index.registerSampleArtifact({ artifact, fileHash, traceId: "trace_1" });

  const items = await index.listItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].sampleVideoId, "sample_1");
  assert.ok(items[0].tags.includes("抽帧"));

  const detail = await index.getItem("sample_1");
  assert.equal(detail.artifactTree.some((node) => node.stageName === "sample.frames.extracted"), true);
  assert.equal((await index.loadItem("sample_1")).sampleVideoId, "sample_1");

  const cache = await index.findCacheEntry({ fileHash, stageName: "sample.frames.extracted", params: { frameSampleRateFps: 1 }, version: "test-v1" });
  assert.equal(cache.sampleVideoId, "sample_1");
});

test("artifact index lists latest item per file and skips degraded cache entries", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-artifact-index-latest-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const index = createArtifactIndex({ store, processorVersion: "test-v1" });
  const fileHash = hashBuffer(Buffer.from("same-video"));

  await index.registerSampleArtifact({ artifact: createArtifact({ sampleVideoId: "sample_old", subtitleStatus: "degraded" }), fileHash, traceId: "trace_old" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await index.registerSampleArtifact({ artifact: createArtifact({ sampleVideoId: "sample_new", subtitleStatus: "processed" }), fileHash, traceId: "trace_new" });

  const items = await index.listItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].sampleVideoId, "sample_new");

  const rawIndex = await index.readIndex();
  assert.equal(Object.values(rawIndex.cacheEntries).some((entry) => entry.stageName === "sample.subtitle.recognized" && entry.status === "degraded"), false);

  const deleted = await index.deleteCacheForItem("sample_new");
  assert.deepEqual(new Set(deleted.removedSampleVideoIds), new Set(["sample_old", "sample_new"]));
  assert.equal((await index.listItems()).length, 0);
});

test("same file and params hit cached media stages on second upload", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-cache-hit-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const mediaProcessor = createCountingProcessor(store);
  const service = createSampleProcessingService({ store, logger, jobStore, mediaProcessor });
  const file = { filename: "sample.mp4", extension: ".mp4", mimeType: "video/mp4", size: 5, buffer: Buffer.from("video") };

  const first = await service.enqueueUpload({ workspaceId: "workspace_1", file, fields: { frameSampleRateFps: "1" } });
  await waitForJob(jobStore, first.processingJobId, "processed");
  const second = await service.enqueueUpload({ workspaceId: "workspace_1", file, fields: { frameSampleRateFps: "1", cacheDecision: "refresh" } });
  await waitForJob(jobStore, second.processingJobId, "processed");

  assert.equal(mediaProcessor.counts.cover, 2);
  assert.equal(mediaProcessor.counts.frames, 2);
  assert.equal(mediaProcessor.counts.audio, 2);

  const logText = await fs.readFile(path.join(store.runtimeRoot, "DebugSnapshots", `${second.traceId}.log.jsonl`), "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
  assert.equal(logs.some((line) => line.outputSummary?.cacheHit === true), false);
});

test("upload returns cache candidate before processing and refresh bypasses stage cache", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-cache-choice-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const mediaProcessor = createCountingProcessor(store);
  const service = createSampleProcessingService({ store, logger, jobStore, mediaProcessor });
  const file = { filename: "sample.mp4", extension: ".mp4", mimeType: "video/mp4", size: 5, buffer: Buffer.from("video") };

  const first = await service.enqueueUpload({ workspaceId: "workspace_1", file, fields: { frameSampleRateFps: "1" } });
  await waitForJob(jobStore, first.processingJobId, "processed");
  const ask = await service.enqueueUpload({ workspaceId: "workspace_1", file, fields: { frameSampleRateFps: "1" } });
  assert.equal(ask.cacheHit, true);
  assert.equal(ask.cachedItem.sampleVideoId, first.sampleVideoId);

  const refreshed = await service.enqueueUpload({ workspaceId: "workspace_1", file, fields: { frameSampleRateFps: "1", cacheDecision: "refresh" } });
  await waitForJob(jobStore, refreshed.processingJobId, "processed");
  assert.equal(mediaProcessor.counts.cover, 2);
  assert.equal(mediaProcessor.counts.frames, 2);
  assert.equal(mediaProcessor.counts.audio, 2);
});

test("failed shot boundary artifact does not register processed shot cache entry", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-shot-cache-invalid-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const index = createArtifactIndex({ store, processorVersion: "test-v1" });
  const fileHash = hashBuffer(Buffer.from("shot-invalid"));
  const artifact = {
    ...createArtifact({ sampleVideoId: "sample_invalid_shot" }),
    shotBoundaryAnalysis: {
      artifactId: "artifact_shot_invalid",
      parentArtifactId: "artifact_sample",
      type: "shot-boundary-analysis",
      status: "failed",
      resultOrigin: "failed_validation",
      sourceFrameArtifactIds: [],
      extractSampling: {
        requestedFps: 1,
        targetFrameCount: 1,
        actualFrameCount: 1,
        maxFrames: 120,
        samplingPolicy: "fixed_interval_from_zero",
        cappedByMaxFrames: false,
      },
      analysisSampling: {
        fps: 1,
        requestedFps: 1,
        targetFrameCount: 1,
        selectedFrameCount: 1,
        effectiveFps: 1,
        selectionPolicy: "target_grid_nearest_unique",
        duplicatePolicy: "nearest_unselected_tie_later",
        roundingPolicy: "target_grid_nearest_unique",
        stride: null,
      },
      contactSheets: [],
      boundaryCandidateArtifacts: [],
      boundaries: [],
      validation: { status: "failed", rawBoundaryCount: 0, normalizedBoundaryCount: 0, repairAttemptCount: 1, validatorCode: "shot_boundary_empty_boundaries" },
      agent: { provider: "codex-appserver", role: "shot-boundary-analyzer", skillPath: "SKILL.md", skillHash: "hash", threadId: "thread_1", leaseId: "lease_1", turnId: "turn_1" },
      shots: [],
      createdAt: new Date().toISOString(),
    },
  };

  await index.registerSampleArtifact({ artifact, fileHash, traceId: "trace_failed_shot" });
  const cache = await index.findCacheEntry({
    fileHash,
    stageName: "shot.boundary_merge",
    params: buildShotBoundaryCacheParams({
      sourceArtifactId: "artifact_sample",
      extractSampling: artifact.shotBoundaryAnalysis.extractSampling,
      analysisSampling: artifact.shotBoundaryAnalysis.analysisSampling,
      frameDimensions: { width: artifact.metadata.width, height: artifact.metadata.height },
      contactSheets: [],
      skillHash: "hash",
    }),
    version: "test-v1",
  });

  assert.equal(cache, null);
});

test("shot boundary cache params keep sheet start and end time stable across register and lookup", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-shot-cache-stable-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const index = createArtifactIndex({ store, processorVersion: "test-v1" });
  const fileHash = hashBuffer(Buffer.from("shot-stable"));
  const artifact = createArtifact({ sampleVideoId: "sample_stable_shot" });
  artifact.shotBoundaryAnalysis = createProcessedShotAnalysis({
    analysisFps: 1,
    skillHash: "skill_hash_a",
    contactSheets: [
      createContactSheet("sheet-001", [
        { timestamp: 0, inputIndex: 0, sourceFrameIndex: 0, frameId: "frame_1" },
        { timestamp: 1, inputIndex: 1, sourceFrameIndex: 1, frameId: "frame_2" },
      ]),
    ],
  });

  await index.registerSampleArtifact({ artifact, fileHash, traceId: "trace_shot_stable" });
  const params = buildShotBoundaryCacheParams({
    sourceArtifactId: artifact.shotBoundaryAnalysis.parentArtifactId,
    extractSampling: artifact.shotBoundaryAnalysis.extractSampling,
    analysisSampling: artifact.shotBoundaryAnalysis.analysisSampling,
    frameDimensions: { width: artifact.metadata.width, height: artifact.metadata.height },
    contactSheets: artifact.shotBoundaryAnalysis.contactSheets,
    skillHash: artifact.shotBoundaryAnalysis.agent.skillHash,
  });
  const cache = await index.findCacheEntry({
    fileHash,
    stageName: "shot.boundary_merge",
    params,
    version: "test-v1",
  });

  assert.equal(cache.sampleVideoId, "sample_stable_shot");
  assert.equal(cache.params.sheetLayouts[0].startTime, 0);
  assert.equal(cache.params.sheetLayouts[0].endTime, 1);
});


function createArtifact(overrides = {}) {
  const sampleVideoId = overrides.sampleVideoId ?? "sample_1";
  const subtitleStatus = overrides.subtitleStatus ?? null;
  return {
    sampleVideoId,
    workspaceId: "workspace_1",
    status: "processed",
    trace: { runId: "run_1", traceId: "trace_1", stageId: "stage_1" },
    processingOptions: { frameSampleRateFps: 1 },
    sampleVideo: {
      artifactId: "artifact_sample",
      parentArtifactId: null,
      original: { artifactId: "artifact_sample", parentArtifactId: null, type: "original-video", uri: "/runtime/source.mp4", summary: "sample.mp4" },
      normalized: { artifactId: "artifact_norm", parentArtifactId: "artifact_sample", type: "normalized-video", uri: "/runtime/source.mp4", summary: "本地标准化引用" },
    },
    cover: { artifactId: "artifact_cover", parentArtifactId: "artifact_sample", type: "cover-frame", uri: "/runtime/cover.jpg", summary: "封面帧" },
    frames: [{ frameId: "frame_1", artifactId: "artifact_frame", parentArtifactId: "artifact_sample", timestamp: 0, imageUri: "/runtime/frame.jpg" }],
    audio: { artifactId: "artifact_audio", parentArtifactId: "artifact_sample", type: "audio-track", uri: "/runtime/audio.m4a", summary: "音频轨" },
    subtitles: subtitleStatus ? {
      artifactId: `artifact_subtitle_${sampleVideoId}`,
      parentArtifactId: "artifact_audio",
      type: "subtitle-track",
      uri: null,
      summary: subtitleStatus === "processed" ? "1 条字幕" : "字幕识别未产出",
      segments: subtitleStatus === "processed" ? [{ id: "subtitle_1", start: 0, end: 1, text: "你好", confidence: null }] : [],
      status: subtitleStatus,
      reason: subtitleStatus === "degraded" ? "讯飞字幕识别响应超时" : null,
      debugSnapshotUri: subtitleStatus === "degraded" ? "/runtime/snapshot.json" : null,
    } : null,
    metadata: { durationSeconds: 3, width: 720, height: 1280 },
  };
}

function createProcessedShotAnalysis({ analysisFps, skillHash, contactSheets }) {
  const targetFrameCount = Math.ceil(3 * analysisFps);
  const selectedFrameCount = Math.min(targetFrameCount, 6);
  return {
    artifactId: "artifact_shot_processed",
    parentArtifactId: "artifact_sample",
    type: "shot-boundary-analysis",
    status: "processed",
    resultOrigin: "new_turn",
    sourceFrameArtifactIds: ["artifact_frame"],
    extractSampling: {
      requestedFps: 3,
      targetFrameCount: 6,
      actualFrameCount: 6,
      maxFrames: 120,
      samplingPolicy: "fixed_interval_from_zero",
      cappedByMaxFrames: false,
    },
    analysisSampling: {
      fps: analysisFps,
      requestedFps: analysisFps,
      targetFrameCount,
      selectedFrameCount,
      effectiveFps: selectedFrameCount / 3,
      selectionPolicy: "target_grid_nearest_unique",
      duplicatePolicy: "nearest_unselected_tie_later",
      roundingPolicy: "target_grid_nearest_unique",
      stride: null,
    },
    subtitleContextSummary: null,
    contactSheets,
    boundaryCandidateArtifacts: [],
    boundaries: [{ timestamp: 1, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false }],
    validation: { status: "passed", rawBoundaryCount: 1, normalizedBoundaryCount: 1, repairAttemptCount: 0, validatorCode: null },
    agent: { provider: "codex-appserver", role: "shot-boundary-analyzer", skillPath: "SKILL.md", skillHash, threadId: "thread_1", leaseId: "lease_1", turnId: "turn_1" },
    shots: [
      { id: "shot_1", index: 0, shotNo: "S001", start: 0, end: 1, representativeFrameId: "frame_1", confidence: 0.8, reason: "cut", summary: "人物正脸中景", endBoundaryReason: "cut" },
      { id: "shot_2", index: 1, shotNo: "S002", start: 1, end: 3, representativeFrameId: "frame_2", confidence: 0.8, reason: "视觉连续", summary: "产品细节特写", endBoundaryReason: null },
    ],
    createdAt: new Date().toISOString(),
  };
}

function createContactSheet(sheetId, gridItems) {
  return {
    artifactId: `artifact_${sheetId}`,
    parentArtifactId: "artifact_sample",
    type: "contact_sheet",
    artifactType: "contact_sheet",
    status: "processed",
    sheetId,
    sheetIndex: 0,
    frameCount: gridItems.length,
    overlapFrameIds: [],
    gridItems: gridItems.map((item, index) => ({
      artifactId: `artifact_frame_${index}`,
      parentArtifactId: "artifact_sample",
      gridIndex: index,
      row: 0,
      col: index,
      ...item,
    })),
    layout: { rows: 1, cols: Math.max(1, gridItems.length), width: 600, height: 320, cellWidth: 300, cellHeight: 160, visibleFrameWidth: 300, visibleFrameHeight: 160, labelHeight: 24 },
    constraints: { maxDimension: 4096, minFrameShortSide: 144, minFrameLongSide: 256, labelHeight: 24, overlapFrameCount: 0 },
  };
}

async function waitForJob(jobStore, jobId, status) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = jobStore.getJob(jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not reach ${status}`);
}

function createCountingProcessor(store) {
  const counts = { cover: 0, frames: 0, audio: 0 };
  return {
    counts,
    async probeMetadata() {
      return { durationSeconds: 2, width: 720, height: 1280, hasAudio: true };
    },
    async extractCover({ coverPath, parentArtifactId }) {
      counts.cover += 1;
      return { artifactId: "artifact_cover", parentArtifactId, type: "cover-frame", uri: store.runtimeUri(coverPath), summary: "封面帧" };
    },
    async extractFrames({ framesDir, parentArtifactId }) {
      counts.frames += 1;
      return [{ frameId: "frame_1", artifactId: "artifact_frame", parentArtifactId, timestamp: 0, imageUri: store.runtimeUri(path.join(framesDir, "frame-001.jpg")) }];
    },
    async extractAudio({ audioPath, parentArtifactId }) {
      counts.audio += 1;
      await fs.writeFile(audioPath, Buffer.from("audio"));
      return { artifactId: "artifact_audio", parentArtifactId, type: "audio-track", uri: store.runtimeUri(audioPath), summary: "音频轨" };
    },
  };
}
