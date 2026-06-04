const TRACE_DETAIL_SCHEMA_VERSION = "platform_trace_detail.v1";

function createTraceResolver({ runtimeRoot = null, readDebugTracesImpl = null, readDebugTraceDetailImpl = null } = {}) {
  async function list() {
    const result = await readDebugTracesImpl?.(runtimeRoot) ?? { traces: [] };
    return {
      schemaVersion: "platform_trace_list.v1",
      traces: (Array.isArray(result.traces) ? result.traces : []).map(toTraceSummary).filter(Boolean),
    };
  }

  async function read({ traceId } = {}) {
    const id = normalizeTraceId(traceId);
    if (!id) return null;
    const detail = await readDebugTraceDetailImpl?.(runtimeRoot, id);
    if (!detail) return null;
    return toTraceDetail(detail);
  }

  return {
    schemaVersion: TRACE_DETAIL_SCHEMA_VERSION,
    list,
    read,
  };
}

function toTraceDetail(trace) {
  const events = Array.isArray(trace.events) ? trace.events : [];
  const summary = toTraceSummary(trace);
  if (!summary) return null;
  return {
    schemaVersion: TRACE_DETAIL_SCHEMA_VERSION,
    traceId: summary.traceId,
    status: summary.status,
    updatedAt: summary.updatedAt,
    latestEvent: summary.latestEvent,
    latestStageName: summary.latestStageName,
    runId: summary.runId,
    stageId: summary.stageId,
    artifactId: summary.artifactId,
    parentArtifactId: summary.parentArtifactId,
    logUri: summary.logUri,
    errorSummary: summary.errorSummary,
    eventCount: events.length,
    stages: events.map(toTraceEventSummary).filter(Boolean),
    source: {
      sourceOfTruth: "Runtime/DebugSnapshots/<traceId>.log.jsonl",
      indexSource: "Apps/Api/lib/observability/debug-traces.js",
    },
  };
}

function toTraceSummary(trace) {
  const traceId = normalizeTraceId(trace?.traceId);
  if (!traceId) return null;
  const events = Array.isArray(trace.events) ? trace.events : [];
  const latest = events.at(-1) ?? null;
  const latestEvent = normalizeText(trace.latestEvent ?? latest?.event);
  const errorSummary = safeErrorSummary(trace.errorSummary ?? latest?.errorSummary);
  return {
    schemaVersion: "platform_trace_summary.v1",
    traceId,
    status: latestEvent === "stage.fail" || errorSummary ? "failed" : latestEvent ?? "updated",
    updatedAt: normalizeText(trace.updatedAt),
    latestEvent,
    latestStageName: normalizeText(trace.latestStageName ?? latest?.stageName),
    runId: normalizeText(latest?.runId ?? firstNonNull(events, "runId")),
    stageId: normalizeText(latest?.stageId),
    artifactId: normalizeText(latest?.artifactId),
    parentArtifactId: normalizeText(latest?.parentArtifactId),
    logUri: safeRuntimeUri(trace.logUri),
    errorSummary,
  };
}

function toTraceEventSummary(event) {
  if (!event || typeof event !== "object") return null;
  return {
    event: normalizeText(event.event),
    runId: normalizeText(event.runId),
    traceId: normalizeTraceId(event.traceId),
    stageId: normalizeText(event.stageId),
    stageName: normalizeText(event.stageName),
    artifactId: normalizeText(event.artifactId),
    parentArtifactId: normalizeText(event.parentArtifactId),
    relatedTraceId: normalizeTraceId(event.relatedTraceId),
    createdAt: normalizeText(event.createdAt),
    durationMs: typeof event.durationMs === "number" ? event.durationMs : null,
    inputSummary: summarizeObject(event.inputSummary),
    outputSummary: summarizeObject(event.outputSummary),
    errorSummary: safeErrorSummary(event.errorSummary),
  };
}

function summarizeObject(value) {
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, summarizeValue(item)]));
}

function summarizeValue(value) {
  if (value == null) return null;
  if (typeof value === "string") return sanitizeText(value, 160);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return { type: "array", count: value.length };
  if (typeof value === "object") return { type: "object", keys: Object.keys(value).slice(0, 12) };
  return sanitizeText(value, 160);
}

function safeErrorSummary(value) {
  if (!value || typeof value !== "object") return null;
  return {
    code: normalizeText(value.code ?? value.error),
    message: sanitizeText(value.message ?? value.summary, 240),
    stageName: normalizeText(value.stageName),
    retryable: typeof value.retryable === "boolean" ? value.retryable : null,
    debugSnapshotUri: safeRuntimeUri(value.debugSnapshotUri),
  };
}

function firstNonNull(values, key) {
  return values.find((value) => normalizeText(value?.[key]))?.[key] ?? null;
}

function safeRuntimeUri(uri) {
  const text = normalizeText(uri);
  if (!text || !text.startsWith("/runtime/")) return null;
  return text;
}

function normalizeTraceId(value) {
  const text = normalizeText(value);
  if (!text || !/^(trace_|uiTrace_)[A-Za-z0-9_-]+$/.test(text)) return null;
  return text;
}

function sanitizeText(value, limit) {
  const text = String(value ?? "").replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, "[local-path]").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

module.exports = {
  TRACE_DETAIL_SCHEMA_VERSION,
  createTraceResolver,
};
