const { createTraceContext } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../../../Infrastructure/Observability/trace");
const { sendJson } = require("./utils");

const conversationLocks = new Map();

async function runAgentChatStage(res, handlers, { stageName, inputSummary, action, summarizeOutput, successStatus }) {
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  const activeLogger = handlers.logger;
  await activeLogger.writeStageLog({
    traceContext,
    stageName,
    event: "stage.start",
    inputSummary,
  });
  try {
    const result = await action({ traceContext });
    await activeLogger.writeStageLog({
      traceContext,
      stageName,
      event: "stage.end",
      outputSummary: summarizeOutput(result),
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, result?.ok === false ? 503 : successStatus, result);
  } catch (error) {
    const safeError = {
      code: error?.code ?? "agent_chat_request_failed",
      message: safePreview(error instanceof Error ? error.message : "Agent chat 请求失败", 240),
      retryable: error?.statusCode ? error.statusCode >= 500 : true,
    };
    const snapshot = await activeLogger.writeDebugSnapshot({
      traceContext,
      stageName,
      reason: safeError.code,
      inputSummary,
      debugPayload: {
        message: safeError.message,
        code: safeError.code,
        detail: error?.debugPayload ? summarizeDebugPayload(error.debugPayload) : null,
      },
    });
    await activeLogger.writeStageLog({
      traceContext,
      stageName,
      event: "stage.fail",
      errorSummary: { ...safeError, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, error?.statusCode ?? 503, {
      ok: false,
      error: safeError.code,
      code: safeError.code,
      message: safeError.message,
      retryable: safeError.retryable,
      traceId: traceContext.traceId,
      debugSnapshotUri: snapshot.uri,
      stageName,
    });
  }
}

async function withConversationLock(conversationId, action) {
  if (!conversationId) return action();
  const key = String(conversationId);
  const previous = conversationLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  conversationLocks.set(key, previous.then(() => current, () => current));
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (conversationLocks.get(key) === current) conversationLocks.delete(key);
  }
}

function normalizeMessage(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeArtifactRef(value) {
  if (!value || typeof value !== "object") return null;
  return {
    artifactId: normalizeText(value.artifactId),
    traceId: normalizeText(value.traceId),
    runId: normalizeText(value.runId),
    stageId: normalizeText(value.stageId),
    status: normalizeText(value.status),
  };
}

function normalizeRevision(value) {
  if (value == null || value === "") return null;
  const revision = Number(value);
  return Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : null;
}

function badRequestError(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  error.retryable = false;
  return error;
}

function notFoundError(code, message) {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = code;
  error.retryable = false;
  return error;
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullablePositiveNumber(value) {
  const number = nullableNumber(value);
  return number != null && number > 0 ? number : null;
}

function summarizeDebugPayload(value) {
  if (!value || typeof value !== "object") return safePreview(value, 400);
  return {
    error: value.error ?? null,
    status: value.status ?? null,
    message: safePreview(value.message, 240),
    stderr: safePreview(value.stderr, 500),
    stdout: safePreview(value.stdout, 500),
    structured: value.structured ? safePreview(JSON.stringify(value.structured), 500) : null,
  };
}

module.exports = {
  badRequestError,
  normalizeArtifactRef,
  normalizeMessage,
  normalizeRevision,
  normalizeText,
  notFoundError,
  nullableNumber,
  nullablePositiveNumber,
  runAgentChatStage,
  safePreview,
  withConversationLock,
};
