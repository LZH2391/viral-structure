const { buildAgentChatActionProjection } = require("../agent-chat/actions");
const { normalizeTurnStatus } = require("../active-turns/status");
const {
  normalizeRevision,
  normalizeText,
  nullableNumber,
  nullablePositiveNumber,
  safePreview,
} = require("./agent-chat-route-core");

const OWNER_PREFIX = "workbench-agent-chat";
const DEFAULT_TURN_TIMEOUT_SECONDS = 180;

async function startThreadPoolRoleSession({ body, handlers, traceContext }) {
  const role = normalizeText(body.role);
  if (!role) {
    const error = new Error("role 不能为空");
    error.statusCode = 400;
    error.code = "agent_chat_role_required";
    throw error;
  }
  const ownerId = normalizeText(body.ownerId ?? body.owner_id) || `${OWNER_PREFIX}-${traceContext.runId}`;
  const readiness = await handlers.threadPool.ensureRoleReady(role);
  if (!readiness?.ok) {
    return {
      ok: false,
      source: "threadpool-role",
      role,
      status: "unavailable",
      error: readiness?.error ?? "threadpool_role_unavailable",
      message: readiness?.message ?? "ThreadPool role 暂不可用",
      retryable: readiness?.retryable ?? true,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    };
  }
  const lease = await handlers.threadPool.acquireLease({ role, ownerId });
  const threadId = lease.thread_id ?? lease.threadId ?? null;
  if (lease?.ok === false || !threadId || !(lease.lease_id ?? lease.leaseId)) {
    return {
      ok: false,
      source: "threadpool-role",
      role,
      status: "unavailable",
      error: lease?.error ?? lease?.code ?? "threadpool_lease_unavailable",
      message: lease?.message ?? "ThreadPool 未返回有效 lease/thread",
      retryable: true,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    };
  }
  return {
    ok: lease.ok !== false,
    source: "threadpool-role",
    role,
    ownerId,
    leaseId: lease.lease_id ?? lease.leaseId ?? null,
    threadId,
    parentThreadId: lease.parent_thread_id ?? lease.parentThreadId ?? readiness.status?.seedThreadId ?? null,
    workspaceRoot: readiness.status?.workspaceRoot ?? handlers.rootDir,
    skillPath: readiness.status?.skillPath ?? null,
    status: lease.status ?? "forked",
    traceId: traceContext.traceId,
    runId: traceContext.runId,
    stageId: traceContext.stageId,
  };
}

async function releaseRetrySessionLease(session, handlers) {
  if (!session?.leaseId || !session?.ownerId || !handlers.threadPool?.releaseLease) return null;
  return handlers.threadPool.releaseLease({ leaseId: session.leaseId, ownerId: session.ownerId }).catch(() => null);
}

async function restoreRetryConversationBinding({ conversation, session, handlers, traceContext }) {
  if (!conversation?.conversationId || !session?.threadId || session.threadId === conversation.threadId) return null;
  return handlers.agentConversationStore?.bindThread?.({
    conversationId: conversation.conversationId,
    threadId: conversation.threadId,
    parentThreadId: conversation.parentThreadId ?? null,
    leaseId: conversation.leaseId ?? null,
    ownerId: conversation.ownerId ?? null,
    workspaceRoot: conversation.workspaceRoot ?? session.workspaceRoot ?? handlers.rootDir,
    skillPath: conversation.skillPath ?? null,
    source: conversation.source ?? session.source ?? null,
    traceId: traceContext?.traceId ?? conversation.traceId ?? null,
    runId: traceContext?.runId ?? conversation.runId ?? null,
    stageId: traceContext?.stageId ?? conversation.stageId ?? null,
    replace: true,
  }).catch(() => null);
}

async function persistRestructureSession(session, body, handlers) {
  if (session?.role !== "function-slot-restructure" || session?.ok === false) return session;
  const conversation = await handlers.agentConversationStore?.createOrUpdateFromSession?.(session, {
    conversationId: normalizeText(body.conversationId),
    sampleVideoId: normalizeText(body.sampleVideoId),
    expectedRevision: normalizeRevision(body.expectedRevision),
  });
  return {
    ...session,
    conversationId: conversation?.conversationId ?? null,
    conversationStatus: conversation?.status ?? null,
    conversationRevision: conversation?.revision ?? null,
  };
}

function normalizeSource(value) {
  return String(value ?? "").trim() === "threadpool-role" ? "threadpool-role" : "direct";
}

function maxRevision(...values) {
  const revisions = values.map(normalizeRevision).filter((value) => value != null);
  return revisions.length ? Math.max(...revisions) : null;
}

function normalizeActiveMessage(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) return String(value.text ?? "");
  return "";
}

function isTerminalStatus(status) {
  return ["completed", "complete", "failed", "cancelled", "canceled"].includes(String(status ?? "").toLowerCase());
}

function isUnknownActiveLeaseError(error) {
  const values = [
    error?.code,
    error?.message,
    error?.payload?.detail,
    error?.payload?.message,
    error?.payload?.error,
  ];
  return values.some((value) => String(value ?? "").includes("unknown active lease"));
}

async function cancelTurnIfAvailable({ handlers, workspaceRoot, threadId, turnId, traceContext = null }) {
  if (!turnId) return { status: "not_requested" };
  if (typeof handlers.activeTurnRuntime?.cancel === "function") {
    return handlers.activeTurnRuntime.cancel({
      workspaceRoot,
      threadId,
      turnId,
      timeoutSeconds: 30,
      traceContext,
    });
  }
  if (typeof handlers.appServer?.cancelTurn !== "function") {
    const error = new Error("AppServer turn/interrupt 能力不可用");
    error.statusCode = 503;
    error.code = "appserver_turn_cancel_unavailable";
    throw error;
  }
  const result = await handlers.appServer.cancelTurn({
    workspaceRoot,
    threadId,
    turnId,
    timeoutSeconds: 30,
  });
  assertCancelTurnSucceeded(result);
  return {
    ok: result?.ok !== false,
    threadId: result?.threadId ?? threadId,
    turnId: result?.turnId ?? turnId,
    status: normalizeText(result?.status) || "canceled",
  };
}

async function registerAgentChatActiveTurn(handlers, { payload, conversation, message, traceContext, stageName, sourceTurnId }) {
  if (!handlers.activeTurnRuntime?.register || !payload?.turnId || !message) return null;
  const conversationId = normalizeText(payload.conversationId ?? conversation?.conversationId);
  if (!conversationId) return null;
  return handlers.activeTurnRuntime.register({
    threadId: payload.threadId,
    turnId: payload.turnId,
    ownerType: "agent-chat",
    ownerId: conversationId,
    currentAttemptId: payload.turnId,
    stageName,
    traceId: traceContext.traceId,
    runId: traceContext.runId,
    stageId: traceContext.stageId,
    artifactId: payload.artifactId ?? null,
    parentArtifactId: payload.parentArtifactId ?? sourceTurnId ?? null,
    leaseId: payload.leaseId ?? conversation?.leaseId ?? null,
    threadPoolOwnerId: payload.threadPoolOwnerId ?? conversation?.ownerId ?? null,
    replayRef: {
      type: "agent-chat-message",
      refId: `user-${payload.turnId}`,
      messageId: `user-${payload.turnId}`,
      sourceTurnId,
    },
    status: payload.status ?? "submitted",
  }).catch(() => null);
}

function attachAgentChatProjection(payload, conversation, status) {
  payload.latestTurnId = conversation?.latestTurnId ?? payload.turnId ?? null;
  payload.threadStopped = Boolean(conversation?.threadStopped);
  payload.retryable = true;
  payload.activeTurnStatus = normalizeTurnStatus(status);
  payload.actionProjection = buildAgentChatActionProjection({
    conversation,
    threadId: payload.threadId,
    turnId: payload.turnId,
    status,
    retryable: true,
  });
  return payload;
}

async function createRetryThreadSession({ body, conversation, handlers, traceContext }) {
  const source = normalizeSource(body.source ?? conversation.source);
  if (source === "threadpool-role") {
    const session = await startThreadPoolRoleSession({
      body: {
        ...body,
        source,
        role: normalizeText(body.role) || conversation.role,
      },
      handlers,
      traceContext,
    });
    if (session?.ok === false || !session.threadId) {
      const error = new Error(session?.message || "ThreadPool role 暂不可用");
      error.statusCode = 503;
      error.code = session?.error || "threadpool_role_unavailable";
      throw error;
    }
    return session;
  }
  const workspaceRoot = normalizeText(body.workspaceRoot) || conversation.workspaceRoot || handlers.rootDir;
  const result = await handlers.appServer.startThread({
    workspaceRoot,
    timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
  });
  assertDirectThreadStarted(result);
  return {
    ok: true,
    source: "direct",
    role: conversation.role ?? normalizeText(body.role),
    threadId: result.threadId ?? result.thread?.id ?? null,
    parentThreadId: conversation.threadId ?? null,
    leaseId: null,
    ownerId: null,
    workspaceRoot,
    skillPath: normalizeText(body.skillPath) || conversation.skillPath || null,
  };
}

function normalizeRetryMode(value) {
  return String(value ?? "").trim() === "new_thread" ? "new_thread" : "same_thread";
}

function safeThreadPoolError(error) {
  return {
    ok: false,
    error: error?.code ?? "threadpool_operation_failed",
    message: safePreview(error instanceof Error ? error.message : "ThreadPool 操作失败", 160),
  };
}

function assertDirectThreadStarted(result) {
  const threadId = result?.threadId ?? result?.thread?.id ?? null;
  if (result?.ok !== false && threadId) return;
  const error = new Error(result?.message ?? "AppServer thread/start 未返回有效 threadId");
  error.statusCode = result?.statusCode ?? 502;
  error.code = result?.error ?? result?.code ?? "appserver_thread_start_failed";
  error.retryable = true;
  throw error;
}

function assertAgentChatTurnStarted(result) {
  const turnId = result?.turnId ?? result?.turn?.id ?? null;
  if (result?.ok !== false && turnId) return;
  const error = new Error(result?.message ?? "AgentChat turn start 未返回有效 turnId");
  error.statusCode = result?.statusCode ?? 502;
  error.code = result?.error ?? result?.code ?? "agent_chat_turn_start_failed";
  error.retryable = true;
  throw error;
}

function assertExpectedTurnResult(result, expectedTurnId, code) {
  const actualTurnId = normalizeText(result?.turnId ?? result?.turn?.id);
  const expected = normalizeText(expectedTurnId);
  if (!actualTurnId || !expected || actualTurnId === expected) return;
  const error = new Error("AgentChat turn 返回了非目标 turn");
  error.statusCode = 502;
  error.code = code;
  error.retryable = true;
  error.debugPayload = {
    expectedTurnId: expected,
    actualTurnId,
    status: result?.status ?? null,
  };
  throw error;
}

function assertExpectedThreadResult(result, expectedThreadId, code) {
  const actualThreadId = normalizeText(result?.threadId ?? result?.thread?.id);
  const expected = normalizeText(expectedThreadId);
  if (!actualThreadId || !expected || actualThreadId === expected) return;
  const error = new Error("AgentChat turn 返回了非目标 thread");
  error.statusCode = 502;
  error.code = code;
  error.retryable = true;
  error.debugPayload = {
    expectedThreadId: expected,
    actualThreadId,
    turnId: result?.turnId ?? result?.turn?.id ?? null,
    status: result?.status ?? null,
  };
  throw error;
}

function assertCancelTurnSucceeded(result) {
  if (result?.ok !== false) return;
  const error = new Error(result?.message ?? "AgentChat turn cancel 失败");
  error.statusCode = result?.statusCode ?? 502;
  error.code = result?.error ?? result?.code ?? "agent_chat_turn_cancel_failed";
  error.retryable = true;
  error.debugPayload = result;
  throw error;
}

function buildTextInputs(message) {
  return [{ type: "text", text: message, text_elements: [] }];
}

function summarizeCompactUsage(value) {
  const usage = value && typeof value === "object" ? value : null;
  if (!usage) return null;
  return {
    inputTokens: nullableNumber(usage.inputTokens),
    modelContextWindow: nullablePositiveNumber(usage.modelContextWindow),
    contextThresholdTokens: nullableNumber(usage.contextThresholdTokens),
    contextUsageRatio: nullableNumber(usage.contextUsageRatio),
    contextUsageState: normalizeText(usage.contextUsageState),
  };
}

function findTurn(thread, turnId) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const target = String(turnId ?? "");
  return turns.find((turn) => String(turn?.id ?? turn?.turnId ?? "") === target) ?? null;
}

module.exports = {
  DEFAULT_TURN_TIMEOUT_SECONDS,
  OWNER_PREFIX,
  assertAgentChatTurnStarted,
  assertDirectThreadStarted,
  assertExpectedThreadResult,
  assertExpectedTurnResult,
  attachAgentChatProjection,
  buildTextInputs,
  cancelTurnIfAvailable,
  createRetryThreadSession,
  findTurn,
  isTerminalStatus,
  isUnknownActiveLeaseError,
  maxRevision,
  normalizeActiveMessage,
  normalizeRetryMode,
  normalizeSource,
  persistRestructureSession,
  registerAgentChatActiveTurn,
  releaseRetrySessionLease,
  restoreRetryConversationBinding,
  safeThreadPoolError,
  startThreadPoolRoleSession,
  summarizeCompactUsage,
};
