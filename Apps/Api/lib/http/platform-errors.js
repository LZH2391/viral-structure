const PLATFORM_ERROR_SCHEMA_VERSION = "platform_error.v1";

function platformErrorBody({
  code,
  message,
  resource = null,
  retryable = false,
  traceId = null,
  debugSnapshotUri = null,
  stageName = null,
  details = null,
} = {}) {
  const errorCode = normalizeText(code) ?? "platform_request_failed";
  return {
    schemaVersion: PLATFORM_ERROR_SCHEMA_VERSION,
    error: errorCode,
    code: errorCode,
    message: normalizeText(message) ?? "平台请求失败",
    resource: resource ?? null,
    traceId: normalizeText(traceId),
    debugSnapshotUri: safeRuntimeUri(debugSnapshotUri),
    stageName: normalizeText(stageName),
    retryable: Boolean(retryable),
    details: details ?? null,
  };
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function safeRuntimeUri(uri) {
  const text = normalizeText(uri);
  if (!text || !text.startsWith("/runtime/")) return null;
  return text;
}

module.exports = {
  PLATFORM_ERROR_SCHEMA_VERSION,
  platformErrorBody,
};
