const STAGES = {
  promptPrepared: "image.prompt_prepare",
  providerRequested: "image.provider_request",
  assetWritten: "image.asset_write",
  artifactAttached: "image.artifact_attach",
};

function safeError(error, stageName) {
  return {
    code: error?.code ?? "image_generation_failed",
    message: error?.safeSummary ?? error?.message ?? "生图失败",
    stageName,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
    debugSnapshotUri: null,
  };
}

function sanitizeDebugPayload(error) {
  const payload = error?.debugPayload && typeof error.debugPayload === "object" ? error.debugPayload : {};
  return {
    code: error?.code ?? null,
    providerStatus: error?.providerStatus ?? payload.providerStatus ?? null,
    providerErrorCode: error?.providerErrorCode ?? payload.providerErrorCode ?? null,
    providerMessage: truncate(payload.providerMessage ?? error?.providerMessage ?? null, 300),
    retryable: typeof error?.retryable === "boolean" ? error.retryable : payload.retryable ?? null,
    detail: truncate(payload.detail ?? error?.detail ?? null, 500),
    causeName: error?.name ?? null,
  };
}

function truncate(value, maxLength) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

module.exports = {
  STAGES,
  safeError,
  sanitizeDebugPayload,
};
