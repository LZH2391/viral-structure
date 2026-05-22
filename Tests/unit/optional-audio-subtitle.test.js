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
  const options = resolveProcessingOptions({ frameSampleRateFps: "2", enableAudioSeparation: "true", enableSubtitleRecognition: "1", enableAudioFeatureAnalysis: "on" });
  assert.equal(options.frameSampleRateFps, 2);
  assert.equal(options.enableAudioSeparation, true);
  assert.equal(options.enableSubtitleRecognition, true);
  assert.equal(options.enableAudioFeatureAnalysis, true);
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

test("untimed subtitle results are distributed across media duration", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-untimed-subtitles-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const service = createSampleProcessingService({
    store,
    logger,
    jobStore,
    mediaProcessor: createProcessor(store, { durationSeconds: 10 }),
    demucsAdapter: createSuccessfulDemucsAdapter(store),
    transcoder: {
      async transcodeForIat({ outputPath }) {
        await fs.writeFile(outputPath, Buffer.alloc(16000 * 2 * 10));
        return { path: outputPath, summary: { sampleRate: 16000 } };
      },
    },
    iatClient: {
      async recognizeAudio() {
        return [
          { start: 0, end: 0, text: "第一句比较长" },
          { start: 0, end: 0, text: "第二句" },
          { start: 0, end: 0, text: "第三句" },
        ];
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
  assert.equal(artifact.subtitles.segments.length, 3);
  assert.equal(artifact.subtitles.segments[0].start, 0);
  assert.ok(artifact.subtitles.segments[0].end < artifact.subtitles.segments[1].start || artifact.subtitles.segments[0].end === artifact.subtitles.segments[1].start);
  assert.ok(artifact.subtitles.segments[1].end <= artifact.subtitles.segments[2].start);
  assert.equal(artifact.subtitles.segments[2].end, 10);

  const logText = await fs.readFile(path.join(store.runtimeRoot, "DebugSnapshots", `${upload.traceId}.log.jsonl`), "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
  const subtitleEnd = logs.find((line) => line.stageName === STAGES.subtitleRecognized && line.event === "stage.end");
  assert.equal(subtitleEnd.outputSummary.lastSegmentEnd, 10);
});

test("optional audio feature analysis writes artifact and stage logs", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-audio-features-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const service = createSampleProcessingService({
    store,
    logger,
    jobStore,
    mediaProcessor: createProcessor(store),
    demucsAdapter: createSuccessfulDemucsAdapter(store),
    librosaAdapter: {
      async extractAudioFeatures({ parentArtifactId, sourceAudioArtifactId, params }) {
        return {
          artifactId: "artifact_audio_features",
          parentArtifactId,
          type: "audio-feature-analysis",
          status: "processed",
          reason: null,
          debugSnapshotUri: null,
          sourceAudioArtifactId,
          durationSeconds: 2,
          tempoBpm: 120,
          beats: [0.25, 1.25],
          onsets: [0.5],
          energyFrames: [{ time: 0.25, rms: 0.4 }],
          spectralSummary: { centroidMean: 1000, bandwidthMean: 200, rolloffMean: 1800, zeroCrossingRateMean: 0.03 },
          analysisParams: { librosaVersion: "0.11.0", sampleRate: 22050, hopLength: 512, nFft: 2048, sourceRole: params.sourceRole },
        };
      },
      audioFeaturesDegraded() {
        throw new Error("unexpected degradation");
      },
    },
  });

  const upload = await service.enqueueUpload({
    workspaceId: "workspace_1",
    fields: { enableAudioSeparation: "true", enableAudioFeatureAnalysis: "true" },
    file: { filename: "sample.mp4", extension: ".mp4", mimeType: "video/mp4", size: 5, buffer: Buffer.from("hello") },
  });
  const job = await waitForJob(jobStore, upload.processingJobId, "processed");
  assert.equal(job.status, "processed");

  const artifact = await store.readJson(path.join(store.sampleDir(upload.sampleVideoId), "artifact.json"));
  assert.equal(artifact.processingOptions.enableAudioFeatureAnalysis, true);
  assert.equal(artifact.audioFeatures.type, "audio-feature-analysis");
  assert.equal(artifact.audioFeatures.parentArtifactId, artifact.audioSeparation.music.artifactId);
  assert.equal(artifact.audioFeatures.sourceAudioArtifactId, artifact.audioSeparation.music.artifactId);
  assert.equal(artifact.audioFeatures.analysisParams.sourceRole, "music");
  assert.deepEqual(artifact.audioFeatures.beats, [0.25, 1.25]);

  const logText = await fs.readFile(path.join(store.runtimeRoot, "DebugSnapshots", `${upload.traceId}.log.jsonl`), "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
  const featureEnd = logs.find((line) => line.stageName === STAGES.audioFeaturesExtracted && line.event === "stage.end");
  assert.equal(featureEnd.outputSummary.beatCount, 2);
  assert.equal(featureEnd.outputSummary.onsetCount, 1);
  assert.equal(featureEnd.outputSummary.sourceAudioArtifactId, artifact.audioSeparation.music.artifactId);
});

test("audio feature analysis degrades when audio source is unavailable", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-audio-features-degraded-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const service = createSampleProcessingService({
    store,
    logger,
    jobStore,
    mediaProcessor: createDegradedAudioProcessor(store),
    librosaAdapter: require("../../Infrastructure/MediaProcessing/librosa-adapter"),
  });

  const upload = await service.enqueueUpload({
    workspaceId: "workspace_1",
    fields: { enableAudioFeatureAnalysis: "true" },
    file: { filename: "sample.mp4", extension: ".mp4", mimeType: "video/mp4", size: 5, buffer: Buffer.from("hello") },
  });
  const job = await waitForJob(jobStore, upload.processingJobId, "processed");
  assert.equal(job.status, "processed");

  const artifact = await store.readJson(path.join(store.sampleDir(upload.sampleVideoId), "artifact.json"));
  assert.equal(artifact.audioFeatures.status, "degraded");
  assert.equal(artifact.audioFeatures.parentArtifactId, artifact.audio.artifactId);
  assert.ok(artifact.audioFeatures.debugSnapshotUri);

  const logText = await fs.readFile(path.join(store.runtimeRoot, "DebugSnapshots", `${upload.traceId}.log.jsonl`), "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
  assert.ok(logs.some((line) => line.stageName === STAGES.audioFeaturesExtracted && line.event === "stage.fail"));
});

async function waitForJob(jobStore, jobId, status) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = jobStore.getJob(jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not reach ${status}`);
}

function createProcessor(store, options = {}) {
  const durationSeconds = options.durationSeconds ?? 2;
  return {
    async probeMetadata() {
      return { durationSeconds, width: 720, height: 1280, hasAudio: true };
    },
    async extractCover({ coverPath, parentArtifactId }) {
      return { artifactId: "artifact_cover", parentArtifactId, type: "cover-frame", uri: store.runtimeUri(coverPath), summary: "封面帧" };
    },
    async extractFrames({ framesDir, parentArtifactId }) {
      return [{ frameId: "frame_1", artifactId: "artifact_frame_1", parentArtifactId, timestamp: 0, imageUri: store.runtimeUri(path.join(framesDir, "frame-00001.jpg")) }];
    },
    async extractAudio({ audioPath, parentArtifactId }) {
      await fs.writeFile(audioPath, Buffer.from("audio"));
      return { artifactId: "artifact_audio", parentArtifactId, type: "audio-track", uri: store.runtimeUri(audioPath), summary: "音频轨" };
    },
  };
}

function createSuccessfulDemucsAdapter(store) {
  return {
    async separateAudio({ parentArtifactId }) {
      return {
        original: { artifactId: parentArtifactId, parentArtifactId: null, type: "audio-track", uri: "/runtime/audio.m4a", summary: "原音频" },
        vocal: { artifactId: "artifact_vocal", parentArtifactId, type: "audio-vocal", uri: "/runtime/vocals.wav", summary: "人声" },
        music: { artifactId: "artifact_music", parentArtifactId, type: "audio-music", uri: "/runtime/no_vocals.wav", summary: "伴奏" },
        status: "processed",
        reason: null,
      };
    },
  };
}

function createDegradedAudioProcessor(store) {
  return {
    async probeMetadata() {
      return { durationSeconds: 2, width: 720, height: 1280, hasAudio: true };
    },
    async extractCover({ coverPath, parentArtifactId }) {
      return { artifactId: "artifact_cover", parentArtifactId, type: "cover-frame", uri: store.runtimeUri(coverPath), summary: "封面帧" };
    },
    async extractFrames({ framesDir, parentArtifactId }) {
      return [{ frameId: "frame_1", artifactId: "artifact_frame_1", parentArtifactId, timestamp: 0, imageUri: store.runtimeUri(path.join(framesDir, "frame-00001.jpg")) }];
    },
    async extractAudio({ parentArtifactId }) {
      return {
        artifactId: "artifact_audio",
        parentArtifactId,
        type: "audio-track",
        uri: null,
        summary: "未检测到可抽取音频轨",
        debugSummary: {
          commandSummary: { command: "ffmpeg", args: ["-y", "-i", "<path:source.mp4>", "-vn", "<path:audio.m4a>"] },
          stderrSummary: "audio stream not found in <path:source.mp4>",
          exitCode: 1,
          mediaOperation: "audio.extract",
          retryable: false,
        },
      };
    },
  };
}
