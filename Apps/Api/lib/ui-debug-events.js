const MAX_BODY_BYTES = 64 * 1024;
const ALLOWED_EVENTS = new Set(["stage.start", "stage.end", "stage.fail"]);

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw badRequest("payload_too_large", "UI debug event 过大");
    chunks.push(chunk);
  }
  if (!chunks.length) throw badRequest("invalid_json", "缺少请求体");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("invalid_json", "请求体不是有效 JSON");
  }
}

async function ingestUiDebugEvent(logger, body) {
  const event = normalizeUiEvent(body);
  let errorSummary = event.errorSummary;
  let debugSnapshotUri = null;

  if (event.event === "stage.fail" && event.debugPayload) {
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: event.traceContext,
      stageName: event.stageName,
      artifactId: event.artifactId,
      parentArtifactId: event.parentArtifactId,
      reason: errorSummary?.code ?? "ui_stage_failed",
      inputSummary: event.inputSummary,
      outputSummary: event.outputSummary,
      debugPayload: event.debugPayload,
    });
    debugSnapshotUri = snapshot.uri;
    errorSummary = { ...(errorSummary ?? {}), debugSnapshotUri };
  }

  await logger.writeStageLog({
    traceContext: event.traceContext,
    event: event.event,
    stageName: event.stageName,
    artifactId: event.artifactId,
    parentArtifactId: event.parentArtifactId,
    inputSummary: event.inputSummary,
    outputSummary: event.outputSummary,
    durationMs: event.durationMs,
    errorSummary,
    relatedTraceId: event.backendTraceId,
  });

  return { ok: true, debugSnapshotUri };
}

function normalizeUiEvent(body) {
  const uiTraceId = requireString(body.uiTraceId, "uiTraceId");
  if (!/^uiTrace_[A-Za-z0-9_-]+$/.test(uiTraceId)) throw badRequest("invalid_ui_trace_id", "uiTraceId 不合法");

  const event = requireString(body.event, "event");
  if (!ALLOWED_EVENTS.has(event)) throw badRequest("invalid_event", "event 不合法");

  const runId = requireString(body.runId, "runId");
  if (!/^run_[A-Za-z0-9_-]+$/.test(runId)) throw badRequest("invalid_run_id", "runId 不合法");

  const stageId = requireString(body.stageId, "stageId");
  if (!/^stage_[A-Za-z0-9_-]+$/.test(stageId)) throw badRequest("invalid_stage_id", "stageId 不合法");

  const stageName = requireString(body.stageName, "stageName");
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(stageName)) throw badRequest("invalid_stage_name", "stageName 不合法");

  return {
    traceContext: { runId, traceId: uiTraceId, stageId },
    backendTraceId: optionalBackendTraceId(body.backendTraceId),
    event,
    stageName,
    artifactId: optionalId(body.artifactId),
    parentArtifactId: optionalId(body.parentArtifactId),
    inputSummary: sanitizePayload(body.inputSummary),
    outputSummary: sanitizePayload(body.outputSummary),
    durationMs: normalizeDuration(body.durationMs),
    errorSummary: normalizeErrorSummary(body.errorSummary),
    debugPayload: sanitizePayload(body.debugPayload),
  };
}

function optionalBackendTraceId(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^trace_[A-Za-z0-9_-]+$/.test(value)) throw badRequest("invalid_backend_trace_id", "backendTraceId 不合法");
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw badRequest(`missing_${field}`, `${field} 必填`);
  return value.trim();
}

function optionalId(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 128) throw badRequest("invalid_artifact_id", "artifactId 不合法");
  return value;
}

function normalizeDuration(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw badRequest("invalid_duration", "durationMs 不合法");
  return Math.round(number);
}

function normalizeErrorSummary(value) {
  if (!value) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw badRequest("invalid_error_summary", "errorSummary 不合法");
  return sanitizePayload({
    code: stringOrNull(value.code, 80),
    message: stringOrNull(value.message, 180),
    stageName: stringOrNull(value.stageName, 80),
    retryable: typeof value.retryable === "boolean" ? value.retryable : null,
    debugSnapshotUri: stringOrNull(value.debugSnapshotUri, 200),
  });
}

function sanitizePayload(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 4) return "[depth_limit]";
  if (typeof value === "string") return sanitizeString(value, 240);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizePayload(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([key, item]) => [sanitizeString(key, 80), sanitizePayload(item, depth + 1)]),
    );
  }
  return null;
}

function sanitizeString(value, maxLength) {
  const text = String(value).replace(/\s+/g, " ").trim();
  const redacted = text
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[path]")
    .replace(/\/(?:[^/\s]+\/){2,}[^\s]+/g, "[path]");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}...` : redacted;
}

function stringOrNull(value, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  return sanitizeString(value, maxLength);
}

function badRequest(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

module.exports = { readJsonBody, ingestUiDebugEvent, normalizeUiEvent };
