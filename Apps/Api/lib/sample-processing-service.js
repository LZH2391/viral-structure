const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const defaultMediaProcessor = require("../../../Infrastructure/MediaProcessing/media-processor");
const defaultDemucsAdapter = require("../../../Infrastructure/MediaProcessing/demucs-adapter");
const defaultTranscoder = require("../../../Infrastructure/MediaProcessing/audio-transcoder");
const defaultIatClient = require("../../../Infrastructure/ModelGateway/xfyun-iat-client");
const { planFrameTimestamps } = require("../../../Core/Workspace/frame-timestamps");
const { buildArtifact } = require("./sample-video-artifact");
const { STAGES, assertUpload, assertDuration, resolveProcessingOptions, buildErrorSummary, buildDebugPayload, fallbackStage, summarizeFile, sourceSummary } = require("./sample-processing-debug");
function createSampleProcessingService({ store, logger, jobStore, mediaProcessor = defaultMediaProcessor, demucsAdapter = defaultDemucsAdapter, transcoder = defaultTranscoder, iatClient = defaultIatClient }) {
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
        inputSummary: { ...summarizeFile(context.file), frameSampleRateFps: context.fields.frameSampleRateFps ?? null, enableAudioSeparation: context.fields.enableAudioSeparation ?? null, enableSubtitleRecognition: context.fields.enableSubtitleRecognition ?? null },
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
        outputSummary: (options) => ({ accepted: true, frameSampleRateFps: options.frameSampleRateFps, enableAudioSeparation: options.enableAudioSeparation, enableSubtitleRecognition: options.enableSubtitleRecognition }),
      });
      const sampleDir = await store.ensureSampleDirs(context.sampleVideoId);
      const inputPath = await saveSource(context, sampleDir);
      const metadata = await readMetadata(context, inputPath);
      const cover = await readCover(context, inputPath, sampleDir);
      const frames = await readFrames(context, inputPath, sampleDir, metadata.durationSeconds);
      const audio = await readAudio(context, inputPath, sampleDir);
      const audioSeparation = await maybeSeparateAudio(context, audio, sampleDir);
      const subtitles = await maybeRecognizeSubtitles(context, audio, audioSeparation, sampleDir, metadata.durationSeconds);
      await writeArtifact(context, inputPath, { metadata, cover, frames, audio, audioSeparation, subtitles, frameOutputSummary: context.frameOutputSummary, sampleVideoId: context.sampleVideoId }, sampleDir);
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

  async function maybeSeparateAudio(context, audio, sampleDir) {
    if (!context.processingOptions.enableAudioSeparation) return null;
    return runStage(context, STAGES.audioSeparated, 86, {
      parentArtifactId: audio.artifactId,
      inputSummary: { audioArtifactId: audio.artifactId, audioAvailable: Boolean(audio.uri) },
      action: async () => {
        if (!audio.uri) {
          const error = optionalCapabilityError("audio_source_unavailable", "原音频不可用，跳过人声/音乐分离", "audio.separate");
          const degraded = audioSeparationDegraded(audio, error.safeSummary);
          degraded.debugSnapshotUri = await writeStageSnapshot(context, STAGES.audioSeparated, audio.artifactId, audio.artifactId, "audio_separation_degraded", buildAudioSeparationSummary(degraded), error.mediaDebug);
          await writeNonBlockingFailure(context, STAGES.audioSeparated, audio.artifactId, audio.artifactId, error, degraded.debugSnapshotUri);
          return degraded;
        }
        try {
          const audioPath = runtimePathFromUri(audio.uri);
          return await demucsAdapter.separateAudio({ audioPath, outputDir: path.join(sampleDir, "demucs"), parentArtifactId: audio.artifactId, store });
        } catch (error) {
          const degraded = audioSeparationDegraded(audio, error.safeSummary || error.message || "人声/音乐分离失败");
          degraded.debugSnapshotUri = await writeStageSnapshot(context, STAGES.audioSeparated, audio.artifactId, audio.artifactId, "audio_separation_degraded", {
            status: degraded.status,
            reason: degraded.reason,
          }, error.mediaDebug ?? buildDebugPayload(error, buildErrorSummary(error, STAGES.audioSeparated)));
          await writeNonBlockingFailure(context, STAGES.audioSeparated, audio.artifactId, audio.artifactId, error, degraded.debugSnapshotUri);
          return degraded;
        }
      },
      outputSummary: buildAudioSeparationSummary,
    });
  }

  async function maybeRecognizeSubtitles(context, audio, audioSeparation, sampleDir, durationSeconds) {
    if (!context.processingOptions.enableSubtitleRecognition) return null;
    const source = audioSeparation?.vocal?.uri ? audioSeparation.vocal : audio;
    return runStage(context, STAGES.subtitleRecognized, 90, {
      parentArtifactId: source?.artifactId ?? audio.artifactId,
      inputSummary: { sourceArtifactId: source?.artifactId ?? null, preferredSource: audioSeparation?.vocal?.uri ? "vocal" : "original", maxSegmentSeconds: 60 },
      action: async () => {
        if (!source?.uri) {
          const error = optionalCapabilityError("subtitle_source_unavailable", "可识别音频不可用", "subtitle.recognize");
          const degraded = subtitleDegraded(source?.artifactId ?? audio.artifactId, error.safeSummary);
          degraded.debugSnapshotUri = await writeStageSnapshot(context, STAGES.subtitleRecognized, degraded.artifactId, degraded.parentArtifactId, "subtitle_recognition_degraded", buildSubtitleSummary(degraded), error.mediaDebug);
          await writeNonBlockingFailure(context, STAGES.subtitleRecognized, degraded.artifactId, degraded.parentArtifactId, error, degraded.debugSnapshotUri);
          return degraded;
        }
        try {
          const pcmPath = path.join(sampleDir, "subtitle-audio.pcm");
          const pcm = await transcoder.transcodeForIat({ inputPath: runtimePathFromUri(source.uri), outputPath: pcmPath });
          const buffer = await fs.readFile(pcm.path);
          const recognized = await recognizePcmInChunks(buffer, durationSeconds, iatClient);
          return buildSubtitleArtifact({
            parentArtifactId: source.artifactId,
            segments: normalizeSubtitleSegments(recognized, durationSeconds),
            uri: null,
          });
        } catch (error) {
          const degraded = subtitleDegraded(source.artifactId, error.safeSummary || error.message || "字幕识别失败");
          degraded.debugSnapshotUri = await writeStageSnapshot(context, STAGES.subtitleRecognized, degraded.artifactId, source.artifactId, "subtitle_recognition_degraded", {
            status: degraded.status,
            reason: degraded.reason,
          }, error.modelDebug ?? error.mediaDebug ?? buildDebugPayload(error, buildErrorSummary(error, STAGES.subtitleRecognized)));
          await writeNonBlockingFailure(context, STAGES.subtitleRecognized, degraded.artifactId, source.artifactId, error, degraded.debugSnapshotUri);
          return degraded;
        }
      },
      artifactIdFromResult: (subtitles) => subtitles.artifactId,
      outputSummary: buildSubtitleSummary,
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

  async function writeStageSnapshot(context, stageName, artifactId, parentArtifactId, reason, outputSummary, debugPayload) {
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stageName,
      artifactId,
      parentArtifactId,
      reason,
      inputSummary: context.activeStage?.inputSummary ?? null,
      outputSummary,
      debugPayload,
    });
    return snapshot.uri;
  }

  async function writeNonBlockingFailure(context, stageName, artifactId, parentArtifactId, error, debugSnapshotUri) {
    const safe = { ...buildErrorSummary(error, stageName), debugSnapshotUri };
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.fail",
      artifactId,
      parentArtifactId,
      inputSummary: null,
      outputSummary: context.activeStage?.outputSummary ?? null,
      durationMs: context.activeStage?.startedAt ? Date.now() - context.activeStage.startedAt : null,
      errorSummary: safe,
    });
    jobStore.updateJob(context.job.jobId, { errorSummary: safe });
  }

  function runtimePathFromUri(uri) {
    const relative = decodeURIComponent(String(uri).replace(/^\/runtime\//, ""));
    return path.join(store.runtimeRoot, relative);
  }
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

function audioSeparationDegraded(audio, reason) {
  return {
    original: audio,
    vocal: null,
    music: null,
    status: "degraded",
    reason,
    debugSnapshotUri: null,
  };
}

function buildAudioSeparationSummary(result) {
  return {
    status: result.status,
    hasVocal: Boolean(result.vocal?.uri),
    hasMusic: Boolean(result.music?.uri),
    reason: result.reason ?? null,
    debugSnapshotUri: result.debugSnapshotUri ?? null,
  };
}

function buildSubtitleArtifact({ parentArtifactId, segments, uri }) {
  return {
    artifactId: `artifact_${randomUUID()}`,
    parentArtifactId,
    type: "subtitle-track",
    uri,
    summary: `${segments.length} 条字幕`,
    segments,
    status: "processed",
    reason: null,
    debugSnapshotUri: null,
  };
}

function subtitleDegraded(parentArtifactId, reason) {
  return {
    artifactId: `artifact_${randomUUID()}`,
    parentArtifactId,
    type: "subtitle-track",
    uri: null,
    summary: "字幕识别未产出",
    segments: [],
    status: "degraded",
    reason,
    debugSnapshotUri: null,
  };
}

function normalizeSubtitleSegments(segments, durationSeconds) {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  return (segments ?? []).map((segment, index) => {
    const start = clampTime(segment.start ?? 0, safeDuration);
    const end = clampTime(segment.end && segment.end > start ? segment.end : safeDuration || start + 1, safeDuration || start + 1);
    return {
      id: segment.id ?? `subtitle_${randomUUID()}`,
      start,
      end,
      text: String(segment.text ?? "").slice(0, 240),
      confidence: Number.isFinite(segment.confidence) ? segment.confidence : null,
    };
  }).filter((segment) => segment.text);
}

async function recognizePcmInChunks(buffer, durationSeconds, iatClient) {
  const bytesPerSecond = 16000 * 2;
  const maxChunkSeconds = 55;
  const estimatedSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : Math.ceil(buffer.length / bytesPerSecond);
  const chunks = [];
  for (let offsetSecond = 0; offsetSecond < estimatedSeconds; offsetSecond += maxChunkSeconds) {
    const startByte = Math.floor(offsetSecond * bytesPerSecond);
    const endByte = Math.min(buffer.length, Math.floor((offsetSecond + maxChunkSeconds) * bytesPerSecond));
    if (endByte <= startByte) continue;
    const recognized = await iatClient.recognizeAudio({ audioBuffer: buffer.subarray(startByte, endByte) });
    for (const segment of recognized) {
      chunks.push({
        ...segment,
        start: (segment.start ?? 0) + offsetSecond,
        end: (segment.end && segment.end > 0 ? segment.end : Math.min(maxChunkSeconds, estimatedSeconds - offsetSecond)) + offsetSecond,
      });
    }
  }
  return chunks;
}

function clampTime(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return number;
  return Math.min(number, max);
}

function buildSubtitleSummary(subtitles) {
  return {
    status: subtitles.status,
    segmentCount: subtitles.segments.length,
    sourceArtifactId: subtitles.parentArtifactId,
    reason: subtitles.reason ?? null,
    debugSnapshotUri: subtitles.debugSnapshotUri ?? null,
  };
}

function optionalCapabilityError(code, message, mediaOperation) {
  const error = new Error(message);
  error.code = code;
  error.safeSummary = message;
  error.mediaDebug = {
    commandSummary: null,
    stderrSummary: null,
    exitCode: null,
    retryable: false,
    mediaOperation,
  };
  return error;
}

module.exports = { createSampleProcessingService, STAGES };
