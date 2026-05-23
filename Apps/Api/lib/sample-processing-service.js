const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const defaultMediaProcessor = require("../../../Infrastructure/MediaProcessing/media-processor");
const defaultDemucsAdapter = require("../../../Infrastructure/MediaProcessing/demucs-adapter");
const defaultTranscoder = require("../../../Infrastructure/MediaProcessing/audio-transcoder");
const defaultLibrosaAdapter = require("../../../Infrastructure/MediaProcessing/librosa-adapter");
const defaultAsrClient = require("../../../Infrastructure/ModelGateway/doubao-sauc-client");
const { createArtifactIndex, hashBuffer } = require("../../../Infrastructure/ArtifactIndex/artifact-index");
const { planFrameTimestampSampling } = require("../../../Core/Workspace/frame-timestamps");
const { buildArtifact } = require("./sample-video-artifact");
const { STAGES, assertUpload, assertDuration, resolveProcessingOptions, buildErrorSummary, buildDebugPayload, fallbackStage, summarizeFile, sourceSummary } = require("./sample-processing-debug");

const FRAME_MAX_COUNT = 6000;
const FRAME_SAMPLING_POLICY = "fixed_interval_from_zero";

function createSampleProcessingService({ store, logger, jobStore, mediaProcessor = defaultMediaProcessor, demucsAdapter = defaultDemucsAdapter, transcoder = defaultTranscoder, librosaAdapter = defaultLibrosaAdapter, asrClient = defaultAsrClient, artifactIndex = createArtifactIndex({ store }) }) {
  async function enqueueUpload({ workspaceId, file, fields = {} }) {
    const fileHash = hashBuffer(file.buffer);
    let processingOptions = null;
    let processingOptionsError = null;
    try {
      processingOptions = resolveProcessingOptions(fields);
    } catch (error) {
      processingOptionsError = error;
    }
    if (!processingOptionsError && fields.cacheDecision !== "refresh") {
      const cached = await artifactIndex.findLatestByFileHash(fileHash);
      if (cached) return { cacheHit: true, cachedItem: cached, fileHash: safeHash(fileHash) };
    }
    const traceContext = createTraceContext(createTraceIds());
    const sampleVideoId = `sample_${randomUUID()}`;
    const sampleArtifactId = `artifact_${randomUUID()}`;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    runProcessing({ workspaceId, file, fields, processingOptions, processingOptionsError, bypassCache: fields.cacheDecision === "refresh", job, traceContext, sampleVideoId, sampleArtifactId, fileHash });
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function runProcessing(context) {
    try {
      await store.ensureRuntimeDirs();
      await runStage(context, STAGES.uploadReceived, 5, {
        artifactId: context.sampleArtifactId,
        inputSummary: { ...summarizeFile(context.file), fileHash: safeHash(context.fileHash), frameSampleRateFps: context.fields.frameSampleRateFps ?? null, enableAudioSeparation: context.fields.enableAudioSeparation ?? null, enableSubtitleRecognition: context.fields.enableSubtitleRecognition ?? null, enableAudioFeatureAnalysis: context.fields.enableAudioFeatureAnalysis ?? null },
        action: async () => ({ sampleVideoId: context.sampleVideoId }),
        outputSummary: () => ({ sampleVideoId: context.sampleVideoId, sampleArtifactId: context.sampleArtifactId }),
      });
      await runStage(context, STAGES.uploadValidated, 10, {
        artifactId: context.sampleArtifactId,
        inputSummary: summarizeFile(context.file),
        logInputSummary: null,
        action: async () => {
          assertUpload(context.file);
          if (context.processingOptionsError) throw context.processingOptionsError;
          context.processingOptions = context.processingOptions ?? resolveProcessingOptions(context.fields);
          return context.processingOptions;
        },
        outputSummary: (options) => ({ accepted: true, frameSampleRateFps: options.frameSampleRateFps, enableAudioSeparation: options.enableAudioSeparation, enableSubtitleRecognition: options.enableSubtitleRecognition, enableAudioFeatureAnalysis: options.enableAudioFeatureAnalysis }),
      });
      const sampleDir = await store.ensureSampleDirs(context.sampleVideoId);
      const inputPath = await saveSource(context, sampleDir);
      const metadata = await readMetadata(context, inputPath);
      const cover = await readCover(context, inputPath, sampleDir);
      const frames = await readFrames(context, inputPath, sampleDir, metadata.durationSeconds);
      const audio = await readAudio(context, inputPath, sampleDir);
      const audioSeparation = await maybeSeparateAudio(context, audio, sampleDir);
      const audioFeatures = await maybeExtractAudioFeatures(context, audio, audioSeparation);
      const subtitles = await maybeRecognizeSubtitles(context, audio, audioSeparation, sampleDir, metadata.durationSeconds);
      await writeArtifact(context, inputPath, { metadata, cover, frames, audio, audioFeatures, audioSeparation, subtitles, frameOutputSummary: context.frameOutputSummary, sampleVideoId: context.sampleVideoId }, sampleDir);
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
      cacheHit: null,
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
    const outputSummary = mergeCacheSummary(options.outputSummary ? options.outputSummary(result) : null, context.activeStage.cacheHit);
    const artifactId = context.activeStage.cacheHit?.artifactId ?? (options.artifactIdFromResult ? options.artifactIdFromResult(result) : options.artifactId);
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
        context.metadataSummary = {
          durationSeconds: metadata.durationSeconds,
          durationSource: metadata.durationSource ?? null,
        };
        return metadata;
      },
      outputSummary: (metadata) => ({
        durationSeconds: Math.round(metadata.durationSeconds),
        durationSource: metadata.durationSource ?? null,
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
      action: async () => {
        const cached = await findStageCache(context, STAGES.coverExtracted, {});
        if (cached) return cached.artifact.cover;
        return mediaProcessor.extractCover({ inputPath, coverPath, parentArtifactId: context.sampleArtifactId, store });
      },
      artifactIdFromResult: (cover) => cover.artifactId,
      outputSummary: (cover) => ({ artifactType: cover.type, uri: cover.uri }),
    });
  }

  async function readFrames(context, inputPath, sampleDir, durationSeconds) {
    const framesDir = path.join(sampleDir, "frames");
    const frameSampleRateFps = context.processingOptions.frameSampleRateFps;
    const frameSampling = planFrameTimestampSampling(durationSeconds, { frameSampleRateFps, maxFrames: FRAME_MAX_COUNT });
    const targetFrameCount = frameSampling.targetFrameCount;
    return runStage(context, STAGES.framesExtracted, 70, {
      parentArtifactId: context.sampleArtifactId,
      inputSummary: {
        ...sourceSummary(context),
        durationSeconds: Math.round(durationSeconds),
        durationSource: context.metadataSummary?.durationSource ?? null,
        frameSampleRateFps,
        targetFrameCount,
        maxFrames: FRAME_MAX_COUNT,
        samplingPolicy: frameSampling.samplingPolicy,
        cappedByMaxFrames: frameSampling.cappedByMaxFrames,
      },
      action: async () => {
        const cached = await findStageCache(context, STAGES.framesExtracted, {
          frameSampleRateFps,
          maxFrames: FRAME_MAX_COUNT,
          samplingPolicy: frameSampling.samplingPolicy,
          cappedByMaxFrames: frameSampling.cappedByMaxFrames,
        });
        if (cached) {
          context.frameOutputSummary = normalizeFrameOutputSummary(cached.artifact.frameOutputSummary, {
            durationSeconds,
            frameSampleRateFps,
            actualFrameCount: cached.artifact.frames?.length ?? 0,
            targetFrameCount,
            maxFrames: FRAME_MAX_COUNT,
            samplingPolicy: frameSampling.samplingPolicy,
            cappedByMaxFrames: frameSampling.cappedByMaxFrames,
          });
          return cached.artifact.frames ?? [];
        }
        return mediaProcessor.extractFrames({ inputPath, framesDir, durationSeconds, frameSampleRateFps, maxFrames: FRAME_MAX_COUNT, parentArtifactId: context.sampleArtifactId, store });
      },
      outputSummary: (frames) => {
        context.frameOutputSummary = buildFrameOutputSummary({
          durationSeconds,
          frameSampleRateFps,
          actualFrameCount: frames.length,
          targetFrameCount,
          maxFrames: FRAME_MAX_COUNT,
          samplingPolicy: frameSampling.samplingPolicy,
          cappedByMaxFrames: frameSampling.cappedByMaxFrames,
        });
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
        const cached = await findStageCache(context, STAGES.audioExtracted, {});
        if (cached) return cached.artifact.audio;
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
        const cached = await findStageCache(context, STAGES.audioSeparated, { demucsMode: "two-stems-vocals", enabled: true });
        if (cached) return cached.artifact.audioSeparation;
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

  async function maybeExtractAudioFeatures(context, audio, audioSeparation) {
    if (!context.processingOptions.enableAudioFeatureAnalysis) return null;
    const source = audioSeparation?.music?.uri ? audioSeparation.music : audio;
    const sourceRole = audioSeparation?.music?.uri ? "music" : "original";
    return runStage(context, STAGES.audioFeaturesExtracted, 88, {
      parentArtifactId: source?.artifactId ?? audio.artifactId,
      inputSummary: { sourceAudioArtifactId: source?.artifactId ?? null, audioAvailable: Boolean(source?.uri), sourceRole },
      action: async () => {
        const cacheParams = { provider: "librosa", enabled: true, sourceRole, sourceAudioArtifactId: source?.artifactId ?? null };
        const cached = await findStageCache(context, STAGES.audioFeaturesExtracted, cacheParams);
        if (cached) return cached.artifact.audioFeatures;
        if (!source?.uri) {
          const error = optionalCapabilityError("audio_feature_source_unavailable", "可分析音频不可用，跳过音频基础分析", "audio.features.extract");
          const degraded = librosaAdapter.audioFeaturesDegraded({ parentArtifactId: source?.artifactId ?? audio.artifactId, sourceAudioArtifactId: source?.artifactId ?? audio.artifactId, reason: error.safeSummary, params: { sourceRole } });
          degraded.debugSnapshotUri = await writeStageSnapshot(context, STAGES.audioFeaturesExtracted, degraded.artifactId, degraded.parentArtifactId, "audio_feature_analysis_degraded", buildAudioFeaturesSummary(degraded), error.mediaDebug);
          await writeNonBlockingFailure(context, STAGES.audioFeaturesExtracted, degraded.artifactId, degraded.parentArtifactId, error, degraded.debugSnapshotUri);
          return degraded;
        }
        try {
          return await librosaAdapter.extractAudioFeatures({ audioPath: runtimePathFromUri(source.uri), parentArtifactId: source.artifactId, sourceAudioArtifactId: source.artifactId, store, params: { sourceRole } });
        } catch (error) {
          const degraded = librosaAdapter.audioFeaturesDegraded({ parentArtifactId: source.artifactId, sourceAudioArtifactId: source.artifactId, reason: error.safeSummary || error.message || "音频基础分析失败", params: { sourceRole } });
          degraded.debugSnapshotUri = await writeStageSnapshot(context, STAGES.audioFeaturesExtracted, degraded.artifactId, source.artifactId, "audio_feature_analysis_degraded", {
            status: degraded.status,
            reason: degraded.reason,
          }, error.mediaDebug ?? buildDebugPayload(error, buildErrorSummary(error, STAGES.audioFeaturesExtracted)));
          await writeNonBlockingFailure(context, STAGES.audioFeaturesExtracted, degraded.artifactId, source.artifactId, error, degraded.debugSnapshotUri);
          return degraded;
        }
      },
      artifactIdFromResult: (audioFeatures) => audioFeatures.artifactId,
      outputSummary: buildAudioFeaturesSummary,
    });
  }

  async function maybeRecognizeSubtitles(context, audio, audioSeparation, sampleDir, durationSeconds) {
    if (!context.processingOptions.enableSubtitleRecognition) return null;
    const source = audioSeparation?.vocal?.uri ? audioSeparation.vocal : audio;
    return runStage(context, STAGES.subtitleRecognized, 92, {
      parentArtifactId: source?.artifactId ?? audio.artifactId,
      inputSummary: {
        sourceArtifactId: source?.artifactId ?? null,
        preferredSource: audioSeparation?.vocal?.uri ? "vocal" : "original",
        provider: "doubao-sauc",
        protocolVersion: 1,
        resourceId: process.env.DOUBAO_SAUC_RESOURCE_ID || "volc.bigasr.sauc.duration",
      },
      action: async () => {
        const cached = await findStageCache(context, STAGES.subtitleRecognized, {
          provider: "doubao-sauc",
          resourceId: process.env.DOUBAO_SAUC_RESOURCE_ID || "volc.bigasr.sauc.duration",
          protocolVersion: 1,
          enabled: true,
        });
        if (cached) return cached.artifact.subtitles;
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
          const recognized = await asrClient.recognizeAudio({ audioPath: pcm.path });
          return buildSubtitleArtifact({
            parentArtifactId: source.artifactId,
            recognized,
            segments: normalizeSubtitleSegments(recognized?.segments ?? [], durationSeconds),
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
        await artifactIndex.registerSampleArtifact({ artifact: nextArtifact, fileHash: context.fileHash, traceId: context.traceContext.traceId });
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

  async function findStageCache(context, stageName, params) {
    if (context.bypassCache) return null;
    const entry = await artifactIndex.findCacheEntry({ fileHash: context.fileHash, stageName, params });
    if (!entry?.sampleVideoId) return null;
    const artifact = await artifactIndex.loadItem(entry.sampleVideoId);
    if (!artifact) return null;
    if (context.activeStage?.stageName === stageName) context.activeStage.cacheHit = entry;
    return { entry, artifact };
  }

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

function buildAudioFeaturesSummary(result) {
  return {
    status: result.status,
    sourceAudioArtifactId: result.sourceAudioArtifactId,
    beatCount: result.beats.length,
    onsetCount: result.onsets.length,
    energyFrameCount: result.energyFrames.length,
    tempoBpm: result.tempoBpm,
    reason: result.reason ?? null,
    debugSnapshotUri: result.debugSnapshotUri ?? null,
  };
}

function buildSubtitleArtifact({ parentArtifactId, segments, recognized, uri }) {
  return {
    artifactId: `artifact_${randomUUID()}`,
    parentArtifactId,
    type: "subtitle-track",
    uri,
    summary: `${segments.length} 条字幕`,
    provider: "doubao-sauc",
    providerMeta: {
      resourceId: recognized?.providerMeta?.resourceId ?? "volc.bigasr.sauc.duration",
      connectId: recognized?.providerMeta?.connectId ?? null,
      requestId: recognized?.providerMeta?.requestId ?? null,
      logId: recognized?.providerMeta?.logId ?? null,
    },
    utterances: Array.isArray(recognized?.timing?.utterances) ? recognized.timing.utterances : [],
    words: Array.isArray(recognized?.timing?.words) ? recognized.timing.words : [],
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
    provider: "doubao-sauc",
    providerMeta: {
      resourceId: process.env.DOUBAO_SAUC_RESOURCE_ID || "volc.bigasr.sauc.duration",
      connectId: null,
      requestId: null,
      logId: null,
    },
    utterances: [],
    words: [],
    segments: [],
    status: "degraded",
    reason,
    debugSnapshotUri: null,
  };
}

function normalizeSubtitleSegments(segments, durationSeconds) {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const normalizedInput = (segments ?? []).map((segment) => ({ ...segment, text: String(segment.text ?? "").slice(0, 240) })).filter((segment) => segment.text);
  const needsSequentialTiming = safeDuration > 0 && normalizedInput.length > 1 && normalizedInput.every((segment) => !hasUsefulTiming(segment));
  const sequentialRanges = needsSequentialTiming ? allocateSubtitleRanges(normalizedInput, safeDuration) : [];
  return normalizedInput.map((segment, index) => {
    const sequential = sequentialRanges[index];
    const start = clampTime(sequential?.start ?? segment.start ?? 0, safeDuration);
    const fallbackEnd = sequential?.end ?? (safeDuration ? Math.min(safeDuration, start + Math.max(1.2, segment.text.length * 0.18)) : start + 1);
    const end = clampTime(segment.end && segment.end > start && !sequential ? segment.end : fallbackEnd, safeDuration || fallbackEnd);
    return {
      id: segment.id ?? `subtitle_${randomUUID()}`,
      start,
      end,
      text: segment.text,
      confidence: Number.isFinite(segment.confidence) ? segment.confidence : null,
    };
  });
}

function hasUsefulTiming(segment) {
  return Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start;
}

function allocateSubtitleRanges(segments, durationSeconds) {
  const totalWeight = segments.reduce((sum, segment) => sum + subtitleTimingWeight(segment.text), 0) || segments.length;
  let cursor = 0;
  return segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    const share = durationSeconds * (subtitleTimingWeight(segment.text) / totalWeight);
    const start = cursor;
    const end = isLast ? durationSeconds : Math.min(durationSeconds, cursor + Math.max(1.2, share));
    cursor = end;
    return { start, end };
  });
}

function subtitleTimingWeight(text) {
  return Math.max(1, String(text ?? "").replace(/[，。！？!?；;、,.\s]/g, "").length);
}

function clampTime(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return number;
  return Math.min(number, max);
}

function buildSubtitleSummary(subtitles) {
  const lastSegmentEnd = subtitles.segments.reduce((max, segment) => Math.max(max, segment.end ?? 0), 0);
  return {
    status: subtitles.status,
    provider: subtitles.provider ?? "doubao-sauc",
    segmentCount: subtitles.segments.length,
    utteranceCount: subtitles.utterances?.length ?? 0,
    wordCount: subtitles.words?.length ?? 0,
    finalTextLength: subtitles.segments.reduce((total, segment) => total + String(segment.text ?? "").length, 0),
    sourceArtifactId: subtitles.parentArtifactId,
    lastSegmentEnd,
    resourceId: subtitles.providerMeta?.resourceId ?? null,
    logId: subtitles.providerMeta?.logId ?? null,
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

function mergeCacheSummary(summary, entry) {
  if (!entry) return summary;
  return {
    ...(summary ?? {}),
    cacheHit: true,
    sourceArtifactId: entry.artifactId,
    sourceSampleVideoId: entry.sampleVideoId,
    cacheKey: entry.cacheKey,
  };
}

function safeHash(value) {
  return value ? `${String(value).slice(0, 12)}...` : null;
}

function buildFrameOutputSummary({ durationSeconds, frameSampleRateFps, actualFrameCount, targetFrameCount, maxFrames, samplingPolicy, cappedByMaxFrames }) {
  const uncappedFrameCount = Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isFinite(frameSampleRateFps) && frameSampleRateFps > 0
    ? Math.max(1, Math.ceil(durationSeconds * frameSampleRateFps))
    : 1;
  return {
    frameSampleRateFps,
    targetFrameCount,
    actualFrameCount,
    maxFrames,
    samplingPolicy: samplingPolicy ?? FRAME_SAMPLING_POLICY,
    cappedByMaxFrames: typeof cappedByMaxFrames === "boolean" ? cappedByMaxFrames : uncappedFrameCount > maxFrames,
  };
}

function normalizeFrameOutputSummary(summary, fallback) {
  const safe = summary && typeof summary === "object" ? summary : {};
  return {
    frameSampleRateFps: Number(safe.frameSampleRateFps ?? fallback.frameSampleRateFps),
    targetFrameCount: Number(safe.targetFrameCount ?? fallback.targetFrameCount),
    actualFrameCount: Number(safe.actualFrameCount ?? fallback.actualFrameCount),
    maxFrames: Number(safe.maxFrames ?? fallback.maxFrames),
    samplingPolicy: safe.samplingPolicy ?? FRAME_SAMPLING_POLICY,
    cappedByMaxFrames: typeof safe.cappedByMaxFrames === "boolean" ? safe.cappedByMaxFrames : false,
  };
}

module.exports = { createSampleProcessingService, STAGES };
