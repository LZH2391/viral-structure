const { createTraceIds } = require("../../../Infrastructure/Observability/trace");

async function recordApiRequestFailure(logger, req, error) {
  const statusCode = error.statusCode === 400 ? 400 : 500;
  const traceContext = createTraceIds();
  const stageName = "api.request.handle";
  const inputSummary = {
    method: req.method ?? null,
    pathname: safePathname(req.url),
  };
  const errorSummary = {
    code: error.code ?? "api_request_failed",
    message: statusCode === 400 ? safeMessage(error.message, "请求参数不合法") : "请求处理失败",
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

module.exports = { recordApiRequestFailure, safePathname };
