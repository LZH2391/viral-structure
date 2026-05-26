const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger, expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");
const { createJobStore } = require("../../Apps/Api/lib/stores/job-store");
const { createSampleProcessingService, STAGES } = require("../../Apps/Api/lib/sample-processing/service");
const { structuredMediaError } = require("../../Infrastructure/MediaProcessing/media-processor");
const { PROCESSING_ERRORS } = require("../../Core/Workspace/sample-video-contracts");

test("failed upload stage writes start, fail and a debug snapshot", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-stage-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const service = createSampleProcessingService({ store, logger, jobStore });

  const upload = await service.enqueueUpload({
    workspaceId: "workspace_1",
    file: {
      filename: "notes.txt",
      extension: ".txt",
      mimeType: "text/plain",
      size: 5,
      buffer: Buffer.from("hello"),
    },
  });
  const job = await waitForJob(jobStore, upload.processingJobId, "failed");
  assert.equal(job.errorSummary.code, PROCESSING_ERRORS.invalidFileType);
  assert.equal(job.errorSummary.stageName, STAGES.uploadValidated);
  assert.ok(job.errorSummary.debugSnapshotUri.includes("/runtime/DebugSnapshots/"));

  const logPath = path.join(store.runtimeRoot, "DebugSnapshots", `${upload.traceId}.log.jsonl`);
  const logText = await fs.readFile(logPath, "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
  assert.deepEqual(logs.map((line) => line.event), ["stage.start", "stage.end", "stage.start", "stage.fail"]);
  assert.equal(logs.at(-1).stageName, STAGES.uploadValidated);
  assert.equal(logs.at(-1).errorSummary.debugSnapshotUri, job.errorSummary.debugSnapshotUri);
  const expandedText = `${logs.map((line) => JSON.stringify(line)).join("\n")}\n`;
  assert.ok(logText.length <= expandedText.length * 0.6, `compact=${logText.length} expanded=${expandedText.length}`);

  const snapshotPath = path.join(store.runtimeRoot, "DebugSnapshots", path.basename(job.errorSummary.debugSnapshotUri));
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  assert.equal(snapshot.stageName, STAGES.uploadValidated);
  assert.equal(snapshot.reason, PROCESSING_ERRORS.invalidFileType);
  assert.ok(snapshot.debugPayload.errorSummary);
});

test("invalid frame sample rate fails during upload validation", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-rate-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const service = createSampleProcessingService({ store, logger, jobStore });

  const upload = await service.enqueueUpload({
    workspaceId: "workspace_1",
    fields: { frameSampleRateFps: "11" },
    file: {
      filename: "sample.mp4",
      extension: ".mp4",
      mimeType: "video/mp4",
      size: 5,
      buffer: Buffer.from("hello"),
    },
  });
  const job = await waitForJob(jobStore, upload.processingJobId, "failed");
  assert.equal(job.errorSummary.code, "invalid_frame_sample_rate");
  assert.equal(job.errorSummary.stageName, STAGES.uploadValidated);
  assert.ok(job.errorSummary.debugSnapshotUri);
});

test("audio extraction degradation keeps processing successful and writes snapshot", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-audio-degrade-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const service = createSampleProcessingService({ store, logger, jobStore, mediaProcessor: createDegradedAudioProcessor(store) });

  const upload = await service.enqueueUpload({
    workspaceId: "workspace_1",
    file: {
      filename: "sample.mp4",
      extension: ".mp4",
      mimeType: "video/mp4",
      size: 5,
      buffer: Buffer.from("hello"),
    },
  });
  const job = await waitForJob(jobStore, upload.processingJobId, "processed");
  assert.equal(job.status, "processed");

  const logPath = path.join(store.runtimeRoot, "DebugSnapshots", `${upload.traceId}.log.jsonl`);
  const logText = await fs.readFile(logPath, "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
  const audioEnd = logs.find((line) => line.stageName === STAGES.audioExtracted && line.event === "stage.end");
  assert.equal(audioEnd.outputSummary.available, false);
  assert.equal(audioEnd.outputSummary.degraded, true);
  assert.equal(audioEnd.outputSummary.reason, "未检测到可抽取音频轨");
  assert.ok(audioEnd.outputSummary.debugSnapshotUri);

  const snapshot = JSON.parse(await fs.readFile(path.join(store.runtimeRoot, "DebugSnapshots", path.basename(audioEnd.outputSummary.debugSnapshotUri)), "utf8"));
  assert.equal(snapshot.stageName, STAGES.audioExtracted);
  assert.equal(snapshot.reason, "audio_extract_degraded");
  assert.equal(snapshot.debugPayload.mediaOperation, "audio.extract");
  assert.equal(snapshot.debugPayload.exitCode, 1);
  assert.doesNotMatch(JSON.stringify(snapshot.debugPayload), /[A-Za-z]:\\/);
});

test("frame extraction summary records 6000 maxFrames without capping moderate high-fps uploads", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-frames-summary-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const service = createSampleProcessingService({
    store,
    logger,
    jobStore,
    mediaProcessor: createFrameSummaryProcessor(store, { durationSeconds: 18.9, frameCount: 189 }),
  });

  const upload = await service.enqueueUpload({
    workspaceId: "workspace_1",
    fields: { frameSampleRateFps: "10" },
    file: {
      filename: "sample.mp4",
      extension: ".mp4",
      mimeType: "video/mp4",
      size: 5,
      buffer: Buffer.from("hello"),
    },
  });
  const job = await waitForJob(jobStore, upload.processingJobId, "processed");
  assert.equal(job.status, "processed");

  const logPath = path.join(store.runtimeRoot, "DebugSnapshots", `${upload.traceId}.log.jsonl`);
  const logText = await fs.readFile(logPath, "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
  const frameStart = logs.find((line) => line.stageName === STAGES.framesExtracted && line.event === "stage.start");
  const frameEnd = logs.find((line) => line.stageName === STAGES.framesExtracted && line.event === "stage.end");

  assert.equal(frameStart.inputSummary.frameSampleRateFps, 10);
  assert.equal(frameStart.inputSummary.durationSource, "video_stream");
  assert.equal(frameStart.inputSummary.targetFrameCount, 189);
  assert.equal(frameStart.inputSummary.maxFrames, 6000);
  assert.equal(frameStart.inputSummary.samplingPolicy, "fixed_interval_from_zero");
  assert.equal(frameStart.inputSummary.cappedByMaxFrames, false);

  assert.equal(frameEnd.outputSummary.maxFrames, 6000);
  assert.equal(frameEnd.outputSummary.targetFrameCount, 189);
  assert.equal(frameEnd.outputSummary.actualFrameCount, 189);
  assert.equal(frameEnd.outputSummary.cappedByMaxFrames, false);
});

test("frame extraction failure writes safe stage.fail summary and snapshot media debug", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-frame-fail-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const service = createSampleProcessingService({
    store,
    logger,
    jobStore,
    mediaProcessor: createFailingFrameProcessor(store),
  });

  const upload = await service.enqueueUpload({
    workspaceId: "workspace_1",
    fields: { frameSampleRateFps: "10" },
    file: {
      filename: "sample.mp4",
      extension: ".mp4",
      mimeType: "video/mp4",
      size: 5,
      buffer: Buffer.from("hello"),
    },
  });
  const job = await waitForJob(jobStore, upload.processingJobId, "failed");
  assert.equal(job.errorSummary.code, PROCESSING_ERRORS.frameExtractFailed);
  assert.equal(job.errorSummary.stageName, STAGES.framesExtracted);
  assert.equal(job.errorSummary.message, "抽帧失败");
  assert.ok(job.errorSummary.debugSnapshotUri);

  const snapshot = JSON.parse(await fs.readFile(path.join(store.runtimeRoot, "DebugSnapshots", path.basename(job.errorSummary.debugSnapshotUri)), "utf8"));
  assert.equal(snapshot.stageName, STAGES.framesExtracted);
  assert.equal(snapshot.reason, PROCESSING_ERRORS.frameExtractFailed);
  assert.equal(snapshot.debugPayload.media.mediaOperation, "frames.extract");
  assert.equal(snapshot.debugPayload.media.commandSummary.command, "ffmpeg");
  assert.doesNotMatch(JSON.stringify(snapshot.debugPayload), /[A-Za-z]:\\/);
});

async function waitForJob(jobStore, jobId, status) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = jobStore.getJob(jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not reach ${status}`);
}

function createDegradedAudioProcessor(store) {
  return {
    async probeMetadata() {
      return { durationSeconds: 2, width: 720, height: 1280, hasAudio: true };
    },
    async extractCover({ coverPath, parentArtifactId }) {
      return {
        artifactId: "artifact_cover",
        parentArtifactId,
        type: "cover-frame",
        uri: store.runtimeUri(coverPath),
        summary: "封面帧",
      };
    },
    async extractFrames({ framesDir, parentArtifactId }) {
      return [
        {
          frameId: "frame_1",
          artifactId: "artifact_frame_1",
          parentArtifactId,
          timestamp: 0,
          imageUri: store.runtimeUri(path.join(framesDir, "frame-00001.jpg")),
        },
      ];
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

function createFrameSummaryProcessor(store, { durationSeconds, frameCount }) {
  return {
    async probeMetadata() {
      return { durationSeconds, durationSource: "video_stream", width: 720, height: 1280, hasAudio: true };
    },
    async extractCover({ coverPath, parentArtifactId }) {
      return {
        artifactId: "artifact_cover",
        parentArtifactId,
        type: "cover-frame",
        uri: store.runtimeUri(coverPath),
        summary: "封面帧",
      };
    },
    async extractFrames({ framesDir, parentArtifactId }) {
      return Array.from({ length: frameCount }, (_, index) => ({
        frameId: `frame_${index + 1}`,
        artifactId: `artifact_frame_${index + 1}`,
        parentArtifactId,
        timestamp: Number((index / 10).toFixed(3)),
        imageUri: store.runtimeUri(path.join(framesDir, `frame-${String(index + 1).padStart(5, "0")}.jpg`)),
      }));
    },
    async extractAudio({ audioPath, parentArtifactId }) {
      return {
        artifactId: "artifact_audio",
        parentArtifactId,
        type: "audio-track",
        uri: store.runtimeUri(audioPath),
        summary: "音频轨",
      };
    },
  };
}

function createFailingFrameProcessor(store) {
  return {
    async probeMetadata() {
      return { durationSeconds: 18.9, width: 720, height: 1280, hasAudio: true };
    },
    async extractCover({ coverPath, parentArtifactId }) {
      return {
        artifactId: "artifact_cover",
        parentArtifactId,
        type: "cover-frame",
        uri: store.runtimeUri(coverPath),
        summary: "封面帧",
      };
    },
    async extractFrames() {
      const cause = new Error("ffmpeg exited with code 1");
      cause.commandSummary = { command: "ffmpeg", args: ["-y", "-ss", "0", "-i", "<path:source.mp4>", "-frames:v", "1", "<path:frame-00001.jpg>"] };
      cause.stderrSummary = "Error while decoding frame from <path:source.mp4>";
      cause.exitCode = 1;
      throw structuredMediaError(PROCESSING_ERRORS.frameExtractFailed, "抽帧失败", cause, "frames.extract");
    },
    async extractAudio({ audioPath, parentArtifactId }) {
      return {
        artifactId: "artifact_audio",
        parentArtifactId,
        type: "audio-track",
        uri: store.runtimeUri(audioPath),
        summary: "音频轨",
      };
    },
  };
}
