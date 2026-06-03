const { readJsonBody } = require("../observability/ui-debug-events");
const {
  normalizeRevision,
  normalizeText,
  runAgentChatStage,
  withConversationLock,
} = require("./agent-chat-route-core");
const {
  DEFAULT_TURN_TIMEOUT_SECONDS,
  OWNER_PREFIX,
  assertDirectThreadStarted,
  isUnknownActiveLeaseError,
  normalizeSource,
  persistRestructureSession,
  startThreadPoolRoleSession,
  summarizeCompactUsage,
} = require("./agent-chat-route-shared");

async function handleAgentChatThreadStart(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const source = normalizeSource(body.source);
  return runAgentChatStage(res, handlers, {
    stageName: source === "threadpool-role" ? "agentChat.threadPool.fork" : "agentChat.thread.start",
    inputSummary: {
      source,
      role: body.role ?? null,
      mode: body.mode ?? null,
      conversationId: normalizeText(body.conversationId),
      expectedRevision: normalizeRevision(body.expectedRevision),
    },
    action: async ({ traceContext }) => {
      if (source === "threadpool-role") {
        const conversationId = normalizeText(body.conversationId);
        return withConversationLock(conversationId, async () => {
          if (conversationId) {
            const error = new Error("ThreadPool 会话和 thread 一一对应，不能给已有会话重新绑定新 thread");
            error.statusCode = 409;
            error.code = "agent_chat_thread_rebind_forbidden";
            error.retryable = false;
            throw error;
          }
          const session = await startThreadPoolRoleSession({ body, handlers, traceContext });
          return persistRestructureSession(session, body, handlers);
        });
      }
      const result = await handlers.appServer.startThread({
        workspaceRoot: handlers.rootDir,
        timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
      });
      assertDirectThreadStarted(result);
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

async function handleAgentChatThreadCompact(req, res, threadId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.context.compact",
    inputSummary: {
      threadId,
      conversationId: normalizeText(body.conversationId),
      workspaceRoot: normalizeText(body.workspaceRoot),
      contextUsage: summarizeCompactUsage(body.contextUsage),
    },
    action: async ({ traceContext }) => {
      if (typeof handlers.appServer?.compactThread !== "function") {
        const error = new Error("AppServer compact 能力不可用");
        error.statusCode = 503;
        error.code = "appserver_thread_compact_unavailable";
        throw error;
      }
      const workspaceRoot = normalizeText(body.workspaceRoot) || handlers.rootDir;
      const result = await handlers.appServer.compactThread({
        workspaceRoot,
        threadId,
        timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
      });
      const conversationId = normalizeText(body.conversationId);
      let conversation = null;
      if (conversationId) {
        conversation = await handlers.agentConversationStore?.recordSystemMessage?.({
          conversationId,
          text: "上下文已自动压缩",
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
          expectedRevision: normalizeRevision(body.expectedRevision),
        });
        if (!conversation) {
          const error = new Error("未找到 Agent 会话");
          error.statusCode = 404;
          error.code = "agent_chat_conversation_not_found";
          throw error;
        }
      }
      return {
        ok: true,
        threadId: result.threadId ?? threadId,
        status: result.status ?? "started",
        compactStatus: result.status ?? "started",
        conversationRevision: conversation?.revision ?? null,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({
      threadId: result.threadId,
      status: result.status,
      compactStatus: result.compactStatus,
      conversationRevision: result.conversationRevision ?? null,
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
      let result;
      try {
        result = await handlers.threadPool.releaseLease({ leaseId, ownerId });
      } catch (error) {
        if (!isUnknownActiveLeaseError(error)) throw error;
        result = { ok: true, status: "already_released" };
      }
      const conversationId = normalizeText(body.conversationId ?? body.conversation_id);
      const deletedConversation = conversationId ? await handlers.agentConversationStore?.remove?.(conversationId) : null;
      return {
        ok: result.ok !== false,
        leaseId,
        ownerId,
        status: result.status ?? "released",
        conversationDeleted: Boolean(deletedConversation),
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({ leaseId: result.leaseId, ownerId: result.ownerId, status: result.status, conversationDeleted: result.conversationDeleted }),
    successStatus: 200,
  });
}

module.exports = {
  handleAgentChatLeaseRelease,
  handleAgentChatThreadCompact,
  handleAgentChatThreadStart,
};
