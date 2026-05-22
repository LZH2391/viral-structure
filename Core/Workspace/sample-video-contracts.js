const SAMPLE_STATUS = {
  pending: "pending",
  processing: "processing",
  cacheWaiting: "cache_waiting",
  processed: "processed",
  failed: "failed",
};

const PROCESSING_ERRORS = {
  invalidFileType: "invalid_file_type",
  fileTooLarge: "file_too_large",
  durationTooLong: "duration_too_long",
  metadataProbeFailed: "metadata_probe_failed",
  frameExtractFailed: "frame_extract_failed",
  audioExtractFailed: "audio_extract_failed",
  storageWriteFailed: "storage_write_failed",
};

function createTraceContext(ids) {
  return {
    runId: ids.runId,
    traceId: ids.traceId,
    stageId: ids.stageId,
  };
}

function createArtifactRef({ artifactId, parentArtifactId, type, uri, summary }) {
  return { artifactId, parentArtifactId, type, uri, summary };
}

function createFrameArtifact({ frameId, artifactId, parentArtifactId, timestamp, imageUri }) {
  return { frameId, artifactId, parentArtifactId, timestamp, imageUri };
}

function createProcessingJob({ jobId, sampleVideoId, stage, status, progress, traceId, errorSummary = null }) {
  return { jobId, sampleVideoId, stage, status, progress, traceId, errorSummary };
}

module.exports = {
  SAMPLE_STATUS,
  PROCESSING_ERRORS,
  createTraceContext,
  createArtifactRef,
  createFrameArtifact,
  createProcessingJob,
};
