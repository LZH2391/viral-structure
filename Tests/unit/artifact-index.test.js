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
      extractSampling: { requestedFps: 1, targetFrameCount: 1, actualFrameCount: 1, maxFrames: 120 },
      analysisSampling: { fps: 1, stride: 1 },
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
    params: {
      sourceArtifactId: "artifact_sample",
      extractSampling: artifact.shotBoundaryAnalysis.extractSampling,
      analysisSampling: artifact.shotBoundaryAnalysis.analysisSampling,
      frameDimensions: { width: artifact.metadata.width, height: artifact.metadata.height },
      sheetCount: 0,
      sheetLayouts: [],
      skillHash: "hash",
    },
    version: "test-v1",
  });

  assert.equal(cache, null);
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
