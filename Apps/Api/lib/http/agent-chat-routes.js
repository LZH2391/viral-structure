const { createTraceContext } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../../../Infrastructure/Observability/trace");
const { sendJson } = require("./utils");
const { readJsonBody } = require("../observability/ui-debug-events");
const { buildAgentActivityFromTurnResult, summarizeAgentTurnTimeline, summarizeAgentTurnTimelineFromItems } = require("../observability/agent-turn-timeline");

const OWNER_PREFIX = "workbench-agent-chat";
const DEFAULT_TURN_TIMEOUT_SECONDS = 180;

async function handleAgentChatThreadStart(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const source = normalizeSource(body.source);
  return runAgentChatStage(res, handlers, {
    stageName: source === "threadpool-role" ? "agentChat.threadPool.fork" : "agentChat.thread.start",
    inputSummary: {
      source,
      role: body.role ?? null,
      mode: body.mode ?? null,
    },
    action: async ({ traceContext }) => {
      if (source === "threadpool-role") {
        return startThreadPoolRoleSession({ body, handlers, traceContext });
      }
      const result = await handlers.appServer.startThread({
        workspaceRoot: handlers.rootDir,
        timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
      });
      return {
        ok: true,
        source: "direct",
        status: result.status ?? "created",
        threadId: result.threadId ?? result.thread?.id ?? null,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
        workspaceRoot: handlers.rootDir,
      };
    },
    summarizeOutput: (result) => ({
      source: result.source,
      role: result.role ?? null,
      threadId: result.threadId ?? null,
      parentThreadId: result.parentThreadId ?? null,
      leaseId: result.leaseId ?? null,
      status: result.status ?? null,
    }),
    successStatus: 201,
  });
}

async function handleAgentChatTurnSubmit(req, res, threadId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const message = normalizeMessage(body.message ?? body.text);
  if (!message) {
    return sendJson(res, 400, {
      error: "agent_chat_message_required",
      code: "agent_chat_message_required",
      message: "消息不能为空",
    });
  }
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.turn.submit",
    inputSummary: {
      threadId,
      source: body.source ?? null,
      role: body.role ?? null,
      leaseId: body.leaseId ?? null,
      messageChars: message.length,
      messagePreview: safePreview(message, 80),
    },
    action: async ({ traceContext }) => {
      const workspaceRoot = normalizeText(body.workspaceRoot) || handlers.rootDir;
      const result = await handlers.appServer.startTurnWithInputs({
        workspaceRoot,
        threadId,
        inputs: buildTextInputs(message),
        skillPath: normalizeText(body.skillPath),
        timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
      });
      return {
        ok: true,
        source: body.source ?? "direct",
        role: body.role ?? null,
        leaseId: body.leaseId ?? null,
        parentThreadId: body.parentThreadId ?? null,
        workspaceRoot,
        threadId: result.threadId ?? threadId,
        turnId: result.turnId ?? result.turn?.id ?? null,
        status: result.status ?? "submitted",
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({
      source: result.source,
      role: result.role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
    }),
    successStatus: 202,
  });
}

async function handleAgentChatTurnCollect(res, threadId, turnId, handlers = {}, url = null) {
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.turn.collect",
    inputSummary: { threadId, turnId },
    action: async ({ traceContext }) => {
      const workspaceRoot = url?.searchParams?.get("workspaceRoot") || handlers.rootDir;
      const result = await handlers.appServer.collectTurnResult({
        workspaceRoot,
        threadId,
        turnId,
        timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
      });
      const activity = buildAgentActivityFromTurnResult(result);
      return {
        ok: true,
        threadId: result.threadId ?? threadId,
        turnId: result.turnId ?? turnId,
        status: result.status ?? "unknown",
        finalMessage: result.finalMessage ?? null,
        activeThreadMessage: result.activeThreadMessage ?? null,
        activity,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      finalMessageChars: result.finalMessage ? String(result.finalMessage).length : 0,
      activityStatus: result.activity?.status ?? null,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatTurnTimeline(res, threadId, turnId, handlers = {}, url = null) {
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.timeline.read",
    inputSummary: { threadId, turnId },
    action: async () => {
      const workspaceRoot = url?.searchParams?.get("workspaceRoot") || handlers.rootDir;
      const threadResult = await handlers.appServer.readThread({ workspaceRoot, threadId });
      const thread = threadResult.thread ?? {};
      const turn = findTurn(thread, turnId);
      let timeline = null;
      let source = "thread/read";
      let itemListFallback = null;
      if (typeof handlers.appServer.listTurnItems === "function") {
        try {
          const listed = await handlers.appServer.listTurnItems({ workspaceRoot, threadId, turnId, limit: 500, sortDirection: "asc" });
          if (Array.isArray(listed?.items) && listed.items.length > 0) {
            timeline = summarizeAgentTurnTimelineFromItems({ thread, turn, items: listed.items, turnId });
            source = "thread/turns/items/list";
          }
        } catch (error) {
          itemListFallback = {
            code: error?.code ?? "appserver_turn_items_list_failed",
            message: safePreview(error instanceof Error ? error.message : "turn item list unavailable", 160),
          };
        }
      }
      timeline = timeline ?? summarizeAgentTurnTimeline(thread, turnId);
      if (!timeline) {
        const error = new Error("未找到对应 turn");
        error.statusCode = 404;
        error.code = "agent_chat_turn_not_found";
        throw error;
      }
      return {
        ...timeline,
        source,
        itemListFallback,
      };
    },
    summarizeOutput: (result) => ({
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      itemCount: result.items?.length ?? 0,
      source: result.source,
      itemListFallback: result.itemListFallback,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatLeaseRelease(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.threadPool.release",
    inputSummary: {
      leaseId: body.leaseId ?? body.lease_id ?? null,
      ownerId: body.ownerId ?? body.owner_id ?? null,
    },
    action: async ({ traceContext }) => {
      const ownerId = normalizeText(body.ownerId ?? body.owner_id) || OWNER_PREFIX;
      const leaseId = normalizeText(body.leaseId ?? body.lease_id);
      if (!leaseId) {
        const error = new Error("leaseId 不能为空");
        error.statusCode = 400;
        error.code = "agent_chat_lease_id_required";
        throw error;
      }
      const result = await handlers.threadPool.releaseLease({ leaseId, ownerId });
      return {
        ok: result.ok !== false,
        leaseId,
        ownerId,
        status: result.status ?? "released",
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({ leaseId: result.leaseId, ownerId: result.ownerId, status: result.status }),
    successStatus: 200,
  });
}

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

function normalizeSource(value) {
  return String(value ?? "").trim() === "threadpool-role" ? "threadpool-role" : "direct";
}

function normalizeMessage(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function buildTextInputs(message) {
  return [{ type: "text", text: message, text_elements: [] }];
}

function findTurn(thread, turnId) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const target = String(turnId ?? "");
  return turns.find((turn) => String(turn?.id ?? turn?.turnId ?? "") === target) ?? null;
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
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
  handleAgentChatLeaseRelease,
  handleAgentChatThreadStart,
  handleAgentChatTurnCollect,
  handleAgentChatTurnSubmit,
  handleAgentChatTurnTimeline,
};
