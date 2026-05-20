const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const defaultMediaProcessor = require("../../../Infrastructure/MediaProcessing/media-processor");
const { planFrameTimestamps } = require("../../../Core/Workspace/frame-timestamps");
const { buildArtifact } = require("./sample-video-artifact");
const { STAGES, assertUpload, assertDuration, resolveProcessingOptions, buildErrorSummary, buildDebugPayload, fallbackStage, summarizeFile, sourceSummary } = require("./sample-processing-debug");
function createSampleProcessingService({ store, logger, jobStore, mediaProcessor = defaultMediaProcessor }) {
  async function enqueueUpload({ workspaceId, file, fields = {} }) {
    const traceContext = createTraceContext(createTraceIds());
    const sampleVideoId = `sample_${randomUUID()}`;
    const sampleArtifactId = `artifact_${randomUUID()}`;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    runProcessing({ workspaceId, file, fields, job, traceContext, sampleVideoId, sampleArtifactId });
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function runProcessing(context) {
    try {
      await store.ensureRuntimeDirs();
      await runStage(context, STAGES.uploadReceived, 5, {
        artifactId: context.sampleArtifactId,
        inputSummary: { ...summarizeFile(context.file), frameSampleRateFps: context.fields.frameSampleRateFps ?? null },
        action: async () => ({ sampleVideoId: context.sampleVideoId }),
        outputSummary: () => ({ sampleVideoId: context.sampleVideoId, sampleArtifactId: context.sampleArtifactId }),
      });
      await runStage(context, STAGES.uploadValidated, 10, {
        artifactId: context.sampleArtifactId,
        inputSummary: summarizeFile(context.file),
        logInputSummary: null,
        action: async () => {
          assertUpload(context.file);
          context.processingOptions = resolveProcessingOptions(context.fields);
          return context.processingOptions;
        },
        outputSummary: (options) => ({ accepted: true, frameSampleRateFps: options.frameSampleRateFps }),
      });
      const sampleDir = await store.ensureSampleDirs(context.sampleVideoId);
      const inputPath = await saveSource(context, sampleDir);
      const metadata = await readMetadata(context, inputPath);
      const cover = await readCover(context, inputPath, sampleDir);
      const frames = await readFrames(context, inputPath, sampleDir, metadata.durationSeconds);
      const audio = await readAudio(context, inputPath, sampleDir);
      await writeArtifact(context, inputPath, { metadata, cover, frames, audio, frameOutputSummary: context.frameOutputSummary, sampleVideoId: context.sampleVideoId }, sampleDir);
    } catch (error) {
      await markFailed(context, error);
    }
  }

  async function runStage(context, stageName, progress, options) {
    context.traceContext = nextStage(context.traceContext);
    const startedAt = Date.now();
    context.activeStage = {
      stageName,
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.inputSummary ?? null,
      outputSummary: null,
      startedAt,
    };
    jobStore.updateJob(context.job.jobId, { stage: stageName, status: SAMPLE_STATUS.processing, progress });
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.start",
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.logInputSummary === undefined ? options.inputSummary ?? null : options.logInputSummary,
    });
    const result = await options.action();
    const outputSummary = options.outputSummary ? options.outputSummary(result) : null;
    const artifactId = options.artifactIdFromResult ? options.artifactIdFromResult(result) : options.artifactId;
    context.activeStage.outputSummary = outputSummary;
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.end",
      artifactId: artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    context.activeStage = null;
    return result;
  }

  async function saveSource(context, sampleDir) {
    const inputPath = path.join(sampleDir, `source${context.file.extension || ".mp4"}`);
    await runStage(context, STAGES.sourceSaved, 15, {
      artifactId: context.sampleArtifactId,
      inputSummary: summarizeFile(context.file),
      action: async () => fs.writeFile(inputPath, context.file.buffer),
      outputSummary: () => ({ artifactType: "original-video", extension: context.file.extension || ".mp4" }),
    });
    return inputPath;
  }

  async function readMetadata(context, inputPath) {
    return runStage(context, STAGES.metadataProbed, 35, {
      artifactId: context.sampleArtifactId,
      inputSummary: sourceSummary(context),
      action: async () => {
        const metadata = await mediaProcessor.probeMetadata(inputPath);
        assertDuration(metadata.durationSeconds);
        return metadata;
      },
      outputSummary: (metadata) => ({
        durationSeconds: Math.round(metadata.durationSeconds),
        width: metadata.width,
        height: metadata.height,
        hasAudio: metadata.hasAudio,
      }),
    });
  }

  async function readCover(context, inputPath, sampleDir) {
    const coverPath = path.join(sampleDir, "cover.jpg");
    return runStage(context, STAGES.coverExtracted, 50, {
      parentArtifactId: context.sampleArtifactId,
      inputSummary: sourceSummary(context),
      action: async () => mediaProcessor.extractCover({ inputPath, coverPath, parentArtifactId: context.sampleArtifactId, store }),
      artifactIdFromResult: (cover) => cover.artifactId,
      outputSummary: (cover) => ({ artifactType: cover.type, uri: cover.uri }),
    });
  }

  async function readFrames(context, inputPath, sampleDir, durationSeconds) {
    const framesDir = path.join(sampleDir, "frames");
    const frameSampleRateFps = context.processingOptions.frameSampleRateFps;
    const plannedFrameCount = planFrameTimestamps(durationSeconds, { frameSampleRateFps }).length;
    return runStage(context, STAGES.framesExtracted, 70, {
      parentArtifactId: context.sampleArtifactId,
      inputSummary: { ...sourceSummary(context), durationSeconds: Math.round(durationSeconds), frameSampleRateFps, targetFrameCount: plannedFrameCount, maxFrames: 120 },
      action: async () => mediaProcessor.extractFrames({ inputPath, framesDir, durationSeconds, frameSampleRateFps, parentArtifactId: context.sampleArtifactId, store }),
      outputSummary: (frames) => {
        context.frameOutputSummary = { frameSampleRateFps, targetFrameCount: plannedFrameCount, actualFrameCount: frames.length, maxFrames: 120 };
        return { ...context.frameOutputSummary, artifactType: "frame-set" };
      },
    });
  }

  async function readAudio(context, inputPath, sampleDir) {
    const audioPath = path.join(sampleDir, "audio.m4a");
    return runStage(context, STAGES.audioExtracted, 82, {
      parentArtifactId: context.sampleArtifactId,
      inputSummary: sourceSummary(context),
      action: async () => {
        const audio = await mediaProcessor.extractAudio({ inputPath, audioPath, parentArtifactId: context.sampleArtifactId, store });
        if (!audio.uri && audio.debugSummary) {
          const outputSummary = buildAudioOutputSummary(audio);
          const snapshot = await logger.writeDebugSnapshot({
            traceContext: context.traceContext,
            stageName: STAGES.audioExtracted,
            artifactId: audio.artifactId,
            parentArtifactId: context.sampleArtifactId,
            reason: "audio_extract_degraded",
            inputSummary: sourceSummary(context),
            outputSummary,
            debugPayload: audio.debugSummary,
          });
          audio.debugSnapshotUri = snapshot.uri;
        }
        return audio;
      },
      artifactIdFromResult: (audio) => audio.artifactId,
      outputSummary: buildAudioOutputSummary,
    });
  }

  async function writeArtifact(context, inputPath, media, sampleDir) {
    const artifact = await runStage(context, STAGES.artifactWritten, 95, {
      artifactId: context.sampleArtifactId,
      inputSummary: { sampleVideoId: context.sampleVideoId, derivativeCount: media.frames.length + 3 },
      action: async () => {
        const nextArtifact = buildArtifact({ context, inputPath, media, store });
        await store.writeJson(path.join(sampleDir, "artifact.json"), nextArtifact);
        return nextArtifact;
      },
      outputSummary: (nextArtifact) => ({ frameCount: nextArtifact.frames.length, status: nextArtifact.status }),
    });
    jobStore.updateJob(context.job.jobId, { stage: "processed", status: SAMPLE_STATUS.processed, progress: 100 });
    return artifact;
  }

  async function markFailed(context, error) {
    const activeStage = context.activeStage ?? fallbackStage(context);
    const safe = buildErrorSummary(error, activeStage.stageName);
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      reason: safe.code,
      inputSummary: activeStage.inputSummary,
      outputSummary: activeStage.outputSummary,
      debugPayload: buildDebugPayload(error, safe),
    });
    const safeWithSnapshot = { ...safe, debugSnapshotUri: snapshot.uri };
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      event: "stage.fail",
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      outputSummary: activeStage.outputSummary,
      durationMs: activeStage.startedAt ? Date.now() - activeStage.startedAt : null,
      errorSummary: safeWithSnapshot,
    });
    jobStore.updateJob(context.job.jobId, {
      stage: activeStage.stageName,
      status: SAMPLE_STATUS.failed,
      progress: 100,
      errorSummary: safeWithSnapshot,
    });
    context.activeStage = null;
  }

  return { enqueueUpload };
}

function buildAudioOutputSummary(audio) {
  const available = Boolean(audio.uri);
  return {
    artifactType: audio.type,
    available,
    degraded: !available,
    reason: available ? null : audio.summary,
    debugSnapshotUri: audio.debugSnapshotUri ?? null,
  };
}

module.exports = { createSampleProcessingService, STAGES };
