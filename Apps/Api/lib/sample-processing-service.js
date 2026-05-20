const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { validateUploadFile, validateDuration } = require("../../../Core/Workspace/sample-video-validation");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const { processMedia } = require("../../../Infrastructure/MediaProcessing/media-processor");
const { buildArtifact } = require("./sample-video-artifact");

function createSampleProcessingService({ store, logger, jobStore }) {
  async function enqueueUpload({ workspaceId, file }) {
    const traceContext = createTraceContext(createTraceIds());
    const sampleVideoId = `sample_${randomUUID()}`;
    const sampleArtifactId = `artifact_${randomUUID()}`;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    runProcessing({ workspaceId, file, job, traceContext, sampleVideoId, sampleArtifactId });
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function runProcessing(context) {
    try {
      await store.ensureRuntimeDirs();
      assertUpload(context.file);
      const sampleDir = await store.ensureSampleDirs(context.sampleVideoId);
      const inputPath = path.join(sampleDir, `source${context.file.extension || ".mp4"}`);
      await fs.writeFile(inputPath, context.file.buffer);
      await markProcessing(context, "saved-original", 15);
      const media = await processMedia({
        inputPath,
        sampleVideoId: context.sampleVideoId,
        sampleArtifactId: context.sampleArtifactId,
        sampleDir,
        store,
      });
      assertDuration(media.metadata.durationSeconds);
      await writeArtifact(context, inputPath, media, sampleDir);
    } catch (error) {
      await markFailed(context, error);
    }
  }

  async function markProcessing(context, stage, progress) {
    context.traceContext = nextStage(context.traceContext);
    jobStore.updateJob(context.job.jobId, { stage, status: SAMPLE_STATUS.processing, progress });
    await logger.writeStageLog({ traceContext: context.traceContext, stage, event: "stage.end", summary: { progress } });
  }

  async function writeArtifact(context, inputPath, media, sampleDir) {
    await markProcessing(context, "write-metadata", 90);
    const artifact = buildArtifact({ context, inputPath, media, store });
    await store.writeJson(path.join(sampleDir, "artifact.json"), artifact);
    jobStore.updateJob(context.job.jobId, { stage: "processed", status: SAMPLE_STATUS.processed, progress: 100 });
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stage: "processed",
      event: "stage.end",
      artifactId: artifact.sampleVideo.artifactId,
      summary: { frameCount: artifact.frames.length },
    });
  }

  async function markFailed(context, error) {
    const safe = { code: error.code || "metadata_probe_failed", message: error.safeSummary || "样例视频处理失败" };
    jobStore.updateJob(context.job.jobId, { stage: "failed", status: SAMPLE_STATUS.failed, progress: 100, errorSummary: safe });
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stage: "failed",
      artifactId: context.sampleArtifactId,
      parentArtifactId: null,
      payload: safe,
    });
    jobStore.updateJob(context.job.jobId, { errorSummary: { ...safe, debugSnapshotUri: snapshot.uri } });
  }

  return { enqueueUpload };
}

function assertUpload(file) {
  const result = validateUploadFile(file);
  if (!result.ok) throw safeError(result.error.code, result.error.message);
}

function assertDuration(durationSeconds) {
  const result = validateDuration(durationSeconds);
  if (!result.ok) throw safeError(result.error.code, result.error.message);
}

function safeError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.safeSummary = message;
  return error;
}

module.exports = { createSampleProcessingService };
