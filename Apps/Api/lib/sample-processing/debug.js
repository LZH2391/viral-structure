const { validateUploadFile, validateDuration, normalizeFrameSampleRateFps } = require("../../../../Core/Workspace/sample-video-validation");

const STAGES = {
  uploadReceived: "sample.upload.received",
  uploadValidated: "sample.upload.validated",
  sourceSaved: "sample.source.saved",
  metadataProbed: "sample.metadata.probed",
  coverExtracted: "sample.cover.extracted",
  framesExtracted: "sample.frames.extracted",
  audioExtracted: "sample.audio.extracted",
  audioFeaturesExtracted: "sample.audio.features.extracted",
  audioSeparated: "sample.audio.separated",
  subtitleRecognized: "sample.subtitle.recognized",
  artifactWritten: "sample.artifact.written",
};

function buildErrorSummary(error, stageName) {
  return {
    code: error.code || "sample_processing_failed",
    message: error.safeSummary || "样例视频处理失败",
    stageName,
    debugSnapshotUri: null,
  };
}

function buildDebugPayload(error, safe) {
  return {
    errorSummary: safe,
    media: error.mediaDebug ?? null,
    causeName: error.causeName ?? error.name ?? null,
  };
}

function fallbackStage(context) {
  return {
    stageName: context.job.stage || STAGES.uploadReceived,
    artifactId: context.sampleArtifactId,
    parentArtifactId: null,
    inputSummary: summarizeFile(context.file),
    outputSummary: null,
    startedAt: null,
  };
}

function summarizeFile(file) {
  return {
    filename: file?.filename ?? null,
    extension: file?.extension ?? null,
    mimeType: file?.mimeType ?? null,
    sizeBytes: file?.buffer?.length ?? null,
  };
}

function sourceSummary(context) {
  return {
    sampleVideoId: context.sampleVideoId,
    sourceArtifactId: context.sampleArtifactId,
    extension: context.file.extension || ".mp4",
  };
}

function assertUpload(file) {
  const result = validateUploadFile(file);
  if (!result.ok) throw safeError(result.error.code, result.error.message);
}

function assertDuration(durationSeconds) {
  const result = validateDuration(durationSeconds);
  if (!result.ok) throw safeError(result.error.code, result.error.message);
}

function resolveProcessingOptions(fields = {}) {
  const result = normalizeFrameSampleRateFps(fields.frameSampleRateFps);
  if (!result.ok) throw safeError(result.error.code, result.error.message);
  return {
    frameSampleRateFps: result.value,
    enableAudioSeparation: normalizeBoolean(fields.enableAudioSeparation),
    enableSubtitleRecognition: normalizeBoolean(fields.enableSubtitleRecognition),
    enableAudioFeatureAnalysis: normalizeBoolean(fields.enableAudioFeatureAnalysis),
  };
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === "1" || value === "on";
}

function safeError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.safeSummary = message;
  return error;
}

module.exports = {
  STAGES,
  assertUpload,
  assertDuration,
  resolveProcessingOptions,
  normalizeBoolean,
  buildErrorSummary,
  buildDebugPayload,
  fallbackStage,
  summarizeFile,
  sourceSummary,
};
