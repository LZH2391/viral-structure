const { randomUUID } = require("crypto");

const FRAME_SAMPLING_POLICY = "fixed_interval_from_zero";

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

module.exports = {
  FRAME_SAMPLING_POLICY,
  audioSeparationDegraded,
  buildAudioFeaturesSummary,
  buildAudioOutputSummary,
  buildAudioSeparationSummary,
  buildFrameOutputSummary,
  buildSubtitleArtifact,
  buildSubtitleSummary,
  mergeCacheSummary,
  normalizeFrameOutputSummary,
  normalizeSubtitleSegments,
  optionalCapabilityError,
  safeHash,
  subtitleDegraded,
};
