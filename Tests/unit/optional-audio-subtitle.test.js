const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger, expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");
const { createJobStore } = require("../../Apps/Api/lib/job-store");
const { createSampleProcessingService, STAGES } = require("../../Apps/Api/lib/sample-processing-service");
const { resolveProcessingOptions } = require("../../Apps/Api/lib/sample-processing-debug");

test("upload options normalize optional audio and subtitle flags", () => {
  const options = resolveProcessingOptions({ frameSampleRateFps: "2", enableAudioSeparation: "true", enableSubtitleRecognition: "1" });
  assert.equal(options.frameSampleRateFps, 2);
  assert.equal(options.enableAudioSeparation, true);
  assert.equal(options.enableSubtitleRecognition, true);
});

test("optional audio separation and subtitles keep base processing successful with traceable degradation", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-optional-media-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const service = createSampleProcessingService({
    store,
    logger,
    jobStore,
    mediaProcessor: createProcessor(store),
    demucsAdapter: {
      async separateAudio() {
        const error = new Error("Demucs missing");
        error.code = "audio_separation_failed";
        error.safeSummary = "人声/音乐分离失败";
        error.mediaDebug = { mediaOperation: "audio.separate", stderrSummary: "demucs not found", retryable: false };
        throw error;
      },
    },
    transcoder: {
      async transcodeForIat({ outputPath }) {
        await fs.writeFile(outputPath, Buffer.alloc(32000));
        return { path: outputPath, summary: { sampleRate: 16000 } };
      },
    },
    iatClient: {
      async recognizeAudio() {
        const error = new Error("missing credentials");
        error.code = "xfyun_credentials_missing";
        error.safeSummary = "讯飞字幕识别凭证未配置";
        error.modelDebug = { provider: "xfyun", stage: STAGES.subtitleRecognized, retryable: false };
        throw error;
      },
    },
  });

  const upload = await service.enqueueUpload({
    workspaceId: "workspace_1",
    fields: { enableAudioSeparation: "true", enableSubtitleRecognition: "true" },
    file: { filename: "sample.mp4", extension: ".mp4", mimeType: "video/mp4", size: 5, buffer: Buffer.from("hello") },
  });
  const job = await waitForJob(jobStore, upload.processingJobId, "processed");
  assert.equal(job.status, "processed");

  const artifact = await store.readJson(path.join(store.sampleDir(upload.sampleVideoId), "artifact.json"));
  assert.equal(artifact.processingOptions.enableAudioSeparation, true);
  assert.equal(artifact.processingOptions.enableSubtitleRecognition, true);
  assert.equal(artifact.audioSeparation.status, "degraded");
  assert.equal(artifact.subtitles.status, "degraded");
  assert.ok(artifact.audioSeparation.debugSnapshotUri);
  assert.ok(artifact.subtitles.debugSnapshotUri);

  const logText = await fs.readFile(path.join(store.runtimeRoot, "DebugSnapshots", `${upload.traceId}.log.jsonl`), "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
  assert.ok(logs.some((line) => line.stageName === STAGES.audioSeparated && line.event === "stage.fail"));
  assert.ok(logs.some((line) => line.stageName === STAGES.subtitleRecognized && line.event === "stage.fail"));
});

async function waitForJob(jobStore, jobId, status) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = jobStore.getJob(jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not reach ${status}`);
}

function createProcessor(store) {
  return {
    async probeMetadata() {
      return { durationSeconds: 2, width: 720, height: 1280, hasAudio: true };
    },
    async extractCover({ coverPath, parentArtifactId }) {
      return { artifactId: "artifact_cover", parentArtifactId, type: "cover-frame", uri: store.runtimeUri(coverPath), summary: "封面帧" };
    },
    async extractFrames({ framesDir, parentArtifactId }) {
      return [{ frameId: "frame_1", artifactId: "artifact_frame_1", parentArtifactId, timestamp: 0, imageUri: store.runtimeUri(path.join(framesDir, "frame-001.jpg")) }];
    },
    async extractAudio({ audioPath, parentArtifactId }) {
      await fs.writeFile(audioPath, Buffer.from("audio"));
      return { artifactId: "artifact_audio", parentArtifactId, type: "audio-track", uri: store.runtimeUri(audioPath), summary: "音频轨" };
    },
  };
}
