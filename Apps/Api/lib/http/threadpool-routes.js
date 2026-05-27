const { createTraceContext } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../../../Infrastructure/Observability/trace");
const { sendJson } = require("./utils");
const { readJsonBody } = require("../observability/ui-debug-events");
const { summarizeThreadConversation } = require("../observability/thread-conversation");
const { summarizeAgentTurnTimeline, summarizeAgentTurnTimelineFromItems } = require("../observability/agent-turn-timeline");

async function handleThreadPoolRead(res, scope, action, handlers = {}) {
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  const activeLogger = handlers.logger;
  await activeLogger.writeStageLog({
    traceContext,
    stageName: "threadPool.status.read",
    event: "stage.start",
    inputSummary: { scope },
  });
  try {
    const result = await action();
    await activeLogger.writeStageLog({
      traceContext,
      stageName: "threadPool.status.read",
      event: "stage.end",
      outputSummary: summarizeThreadPoolRead(scope, result),
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, resolveThreadPoolReadStatus(result), result);
  } catch (error) {
    const snapshot = await activeLogger.writeDebugSnapshot({
      traceContext,
      stageName: "threadPool.status.read",
      reason: "threadpool_status_read_failed",
      inputSummary: { scope },
      debugPayload: { message: error instanceof Error ? error.message : "ThreadPool 读取失败" },
    });
    await activeLogger.writeStageLog({
      traceContext,
      stageName: "threadPool.status.read",
      event: "stage.fail",
      errorSummary: { code: "threadpool_status_read_failed", message: "ThreadPool 状态读取失败", retryable: true, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, 503, { ok: false, unavailable: true, error: "threadpool_status_read_failed", message: "ThreadPool 状态读取失败" });
  }
}

async function handleThreadDiscard(req, res, threadId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  return handleThreadPoolRead(res, "discard", () => handlers.threadPool.discardThread({ threadId, reason: body.reason || "manual-discard" }), handlers);
}

async function handleThreadConversation(res, threadId, handlers = {}) {
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  const activeLogger = handlers.logger;
  await activeLogger.writeStageLog({
    traceContext,
    stageName: "threadPool.conversation.read",
    event: "stage.start",
    inputSummary: { threadId },
  });
  try {
    const allowedThread = await handlers.threadPool.findAllowedThread(threadId);
    if (!allowedThread?.ok) {
      await activeLogger.writeStageLog({
        traceContext,
        stageName: "threadPool.conversation.read",
        event: "stage.end",
        outputSummary: {
          threadId,
          allowed: false,
          statusCode: 403,
          error: allowedThread?.error ?? null,
          message: allowedThread?.message ?? null,
        },
        durationMs: Date.now() - startedAt,
      });
      return sendJson(res, 403, allowedThread);
    }
    const resolvedThreadId = allowedThread.thread_id;
    const thread = await handlers.appServer.readThread({ workspaceRoot: handlers.rootDir, threadId: resolvedThreadId });
    const conversation = summarizeThreadConversation(thread.thread ?? {});
    await activeLogger.writeStageLog({
      traceContext,
      stageName: "threadPool.conversation.read",
      event: "stage.end",
      outputSummary: {
        requestedThreadId: threadId,
        threadId: conversation.threadId,
        turnCount: conversation.turns.length,
        status: conversation.status ?? null,
      },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, 200, conversation);
  } catch (error) {
    const snapshot = await activeLogger.writeDebugSnapshot({
      traceContext,
      stageName: "threadPool.conversation.read",
      reason: "threadpool_conversation_read_failed",
      inputSummary: { threadId },
      debugPayload: {
        message: error instanceof Error ? error.message : "Thread conversation 读取失败",
        detail: error?.debugPayload ?? null,
      },
    });
    await activeLogger.writeStageLog({
      traceContext,
      stageName: "threadPool.conversation.read",
      event: "stage.fail",
      errorSummary: { code: "threadpool_conversation_read_failed", message: "Thread conversation 读取失败", retryable: true, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, 503, { ok: false, unavailable: true, error: "threadpool_conversation_read_failed", message: "Thread conversation 读取失败" });
  }
}

async function handleThreadTurnTimeline(res, threadId, turnId, handlers = {}) {
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  const activeLogger = handlers.logger;
  await activeLogger.writeStageLog({
    traceContext,
    stageName: "threadPool.turnTimeline.read",
    event: "stage.start",
    inputSummary: { threadId, turnId },
  });
  try {
    const allowedThread = await handlers.threadPool.findAllowedThread(threadId);
    if (!allowedThread?.ok) {
      await activeLogger.writeStageLog({
        traceContext,
        stageName: "threadPool.turnTimeline.read",
        event: "stage.end",
        outputSummary: {
          threadId,
          turnId,
          allowed: false,
          statusCode: 403,
          error: allowedThread?.error ?? null,
        },
        durationMs: Date.now() - startedAt,
      });
      return sendJson(res, 403, allowedThread);
    }
    const resolvedThreadId = allowedThread.thread_id;
    const thread = await handlers.appServer.readThread({ workspaceRoot: handlers.rootDir, threadId: resolvedThreadId });
    const threadPayload = thread.thread ?? {};
    const turn = findTurn(threadPayload, turnId);
    let timeline = null;
    let source = "thread/read";
    if (typeof handlers.appServer.listTurnItems === "function") {
      const listed = await handlers.appServer.listTurnItems({ workspaceRoot: handlers.rootDir, threadId: resolvedThreadId, turnId, limit: 500, sortDirection: "asc" });
      if (Array.isArray(listed?.items) && listed.items.length > 0) {
        timeline = summarizeAgentTurnTimelineFromItems({ thread: threadPayload, turn, items: listed.items, turnId });
        source = "thread/turns/items/list";
      }
    }
    timeline = timeline ?? summarizeAgentTurnTimeline(threadPayload, turnId);
    if (!timeline) {
      await activeLogger.writeStageLog({
        traceContext,
        stageName: "threadPool.turnTimeline.read",
        event: "stage.end",
        outputSummary: { requestedThreadId: threadId, threadId: resolvedThreadId, turnId, found: false },
        durationMs: Date.now() - startedAt,
      });
      return sendJson(res, 404, {
        error: "thread_turn_not_found",
        code: "thread_turn_not_found",
        message: "未找到对应 turn",
      });
    }
    await activeLogger.writeStageLog({
      traceContext,
      stageName: "threadPool.turnTimeline.read",
      event: "stage.end",
      outputSummary: {
        requestedThreadId: threadId,
        threadId: timeline.threadId,
        turnId: timeline.turnId,
        itemCount: timeline.items.length,
        status: timeline.status,
        source,
      },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, 200, timeline);
  } catch (error) {
    const snapshot = await activeLogger.writeDebugSnapshot({
      traceContext,
      stageName: "threadPool.turnTimeline.read",
      reason: "threadpool_turn_timeline_read_failed",
      inputSummary: { threadId, turnId },
      debugPayload: {
        message: error instanceof Error ? error.message : "Thread turn timeline 读取失败",
        detail: error?.debugPayload ?? null,
      },
    });
    await activeLogger.writeStageLog({
      traceContext,
      stageName: "threadPool.turnTimeline.read",
      event: "stage.fail",
      errorSummary: { code: "threadpool_turn_timeline_read_failed", message: "Thread turn timeline 读取失败", retryable: true, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, 503, { ok: false, unavailable: true, error: "threadpool_turn_timeline_read_failed", message: "Thread turn timeline 读取失败" });
  }
}

async function handleOwnerLeaseRelease(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  return handleThreadPoolRead(res, "release-owner", () => handlers.threadPool.releaseOwnerLeases(body.ownerId || body.owner_id), handlers);
}

function summarizeThreadPoolRead(scope, result) {
  if (!result?.ok) return { scope, unavailable: Boolean(result?.unavailable), error: result?.error ?? null };
  if (scope === "roles") return { scope, roleCount: result.roles?.length ?? 0, warmingRoles: result.health?.warming_roles ?? [] };
  if (scope === "role-status") return { scope, role: result.role, idle: result.counts?.idle ?? 0, minIdle: result.minIdle ?? 0, leased: result.counts?.leased ?? 0 };
  return { scope, readyForLeases: result.ready_for_leases ?? result.readyForLeases ?? null, recovering: result.recovering ?? null };
}

function resolveThreadPoolReadStatus(result) {
  if (result?.ok !== false) return 200;
  if (result.unavailable) return 503;
  if (["threadpool_thread_not_allowed", "threadpool_thread_id_ambiguous", "threadpool_role_not_allowed"].includes(result.error)) return 403;
  return 200;
}

function findTurn(thread, turnId) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const target = String(turnId ?? "");
  if (!target) return turns.at(-1) ?? null;
  return turns.find((turn) => String(turn?.id ?? turn?.turnId ?? "") === target) ?? null;
}

module.exports = {
  handleOwnerLeaseRelease,
  handleThreadConversation,
  handleThreadDiscard,
  handleThreadPoolRead,
  handleThreadTurnTimeline,
};
