const { createTraceIds } = require("../../../../Infrastructure/Observability/trace");

async function recordApiRequestFailure(logger, req, error) {
  const statusCode = normalizeStatusCode(error.statusCode);
  const traceContext = createTraceIds();
  const stageName = "api.request.handle";
  const inputSummary = {
    method: req.method ?? null,
    pathname: safePathname(req.url),
  };
  const errorSummary = {
    code: error.code ?? "api_request_failed",
    message: statusCode < 500 ? safeMessage(error.message, "请求参数不合法") : "请求处理失败",
    stageName,
    retryable: statusCode >= 500,
  };
  await logger.writeStageLog({
    traceContext,
    stageName,
    event: "stage.start",
    inputSummary,
  });
  const snapshot = await logger.writeDebugSnapshot({
    traceContext,
    stageName,
    reason: errorSummary.code,
    inputSummary,
    outputSummary: { statusCode },
    debugPayload: {
      ...inputSummary,
      statusCode,
      errorCode: errorSummary.code,
      rawErrorMessage: safeMessage(error.message, "请求处理失败"),
      rawErrorCode: error.code ?? null,
      upstreamError: summarizeDebugPayload(error.debugPayload),
      message: errorSummary.message,
      retryable: errorSummary.retryable,
    },
  });
  await logger.writeStageLog({
    traceContext,
    stageName,
    event: "stage.fail",
    outputSummary: { statusCode },
    errorSummary: { ...errorSummary, debugSnapshotUri: snapshot.uri },
  });
  return { traceContext, snapshot, errorSummary: { ...errorSummary, debugSnapshotUri: snapshot.uri } };
}

function normalizeStatusCode(value) {
  const statusCode = Number(value);
  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) return statusCode;
  return 500;
}

function summarizeDebugPayload(value) {
  if (!value || typeof value !== "object") return null;
  return {
    error: safeMessage(value.error, ""),
    message: safeMessage(value.message, ""),
    operation: safeMessage(value.operation, ""),
    threadId: safeMessage(value.threadId, ""),
    turnId: safeMessage(value.turnId, ""),
  };
}

function safePathname(value) {
  try {
    return new URL(value ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

function safeMessage(value, fallback) {
  const text = String(value ?? fallback).replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}

module.exports = { recordApiRequestFailure, safePathname, normalizeStatusCode };
