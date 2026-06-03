const { readJsonBody } = require("../observability/ui-debug-events");
const { buildAgentChatActionProjection, findReplayTask, latestAssistantStatus } = require("../agent-chat/actions");
const { normalizeTurnStatus } = require("../active-turns/status");
const {
  badRequestError,
  normalizeRevision,
  normalizeText,
  notFoundError,
  runAgentChatStage,
  safePreview,
  withConversationLock,
} = require("./agent-chat-route-core");
const {
  DEFAULT_TURN_TIMEOUT_SECONDS,
  OWNER_PREFIX,
  assertAgentChatTurnStarted,
  assertExpectedThreadResult,
  buildTextInputs,
  cancelTurnIfAvailable,
  createRetryThreadSession,
  isTerminalStatus,
  normalizeRetryMode,
  normalizeSource,
  registerAgentChatActiveTurn,
  releaseRetrySessionLease,
  restoreRetryConversationBinding,
  safeThreadPoolError,
} = require("./agent-chat-route-shared");

async function handleAgentChatTurnStop(req, res, threadId, turnId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.turn.stop",
    inputSummary: {
      threadId,
      turnId,
      conversationId: normalizeText(body.conversationId),
      expectedRevision: normalizeRevision(body.expectedRevision),
      reason: safePreview(body.reason, 120),
    },
    action: async ({ traceContext }) => {
      const conversationId = normalizeText(body.conversationId);
      return withConversationLock(conversationId, async () => {
        const workspaceRoot = normalizeText(body.workspaceRoot) || handlers.rootDir;
        let conversation = conversationId ? await handlers.agentConversationStore?.assertActive?.(conversationId, { expectedRevision: normalizeRevision(body.expectedRevision) }) : null;
        if (conversationId && !conversation) throw notFoundError("agent_chat_conversation_not_found", "未找到 Agent 会话");
        const cancelled = await cancelTurnIfAvailable({ handlers, workspaceRoot, threadId, turnId, traceContext });
        conversation = await handlers.agentConversationStore?.recordTurnStopped?.({
          conversationId,
          turnId,
          text: normalizeText(body.reason) ? `已停止当前 turn：${normalizeText(body.reason)}` : "已停止当前 turn",
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        }) ?? conversation;
        return {
          ok: true,
          action: "stop_turn",
          threadId,
          turnId,
          status: cancelled.status ?? "canceled",
          conversationRevision: conversation?.revision ?? null,
          latestTurnId: conversation?.latestTurnId ?? turnId,
          threadStopped: Boolean(conversation?.threadStopped),
          retryable: true,
          activeTurnStatus: normalizeTurnStatus(cancelled.status ?? "canceled"),
          actionProjection: buildAgentChatActionProjection({
            conversation,
            threadId,
            turnId,
            status: "canceled",
            retryable: true,
          }),
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        };
      });
    },
    summarizeOutput: (result) => ({
      action: result.action,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      conversationRevision: result.conversationRevision,
      availableActions: result.actionProjection.availableActions,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatThreadStop(req, res, threadId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.thread.stop",
    inputSummary: {
      threadId,
      activeTurnId: normalizeText(body.activeTurnId ?? body.turnId),
      conversationId: normalizeText(body.conversationId),
      source: normalizeSource(body.source),
      leaseId: normalizeText(body.leaseId),
      discardThread: Boolean(body.discardThread),
      archiveConversation: Boolean(body.archiveConversation),
      reason: safePreview(body.reason, 120),
    },
    action: async ({ traceContext }) => {
      const conversationId = normalizeText(body.conversationId);
      return withConversationLock(conversationId, async () => {
        const workspaceRoot = normalizeText(body.workspaceRoot) || handlers.rootDir;
        let conversation = conversationId ? await handlers.agentConversationStore?.assertActive?.(conversationId, { expectedRevision: normalizeRevision(body.expectedRevision) }) : null;
        if (conversationId && !conversation) throw notFoundError("agent_chat_conversation_not_found", "未找到 Agent 会话");
        const activeTurnId = normalizeText(body.activeTurnId ?? body.turnId ?? conversation?.latestTurnId);
        const turnStop = activeTurnId ? await cancelTurnIfAvailable({ handlers, workspaceRoot, threadId, turnId: activeTurnId, traceContext }) : null;
        let leaseRelease = null;
        let threadDiscard = null;
        if (normalizeSource(body.source ?? conversation?.source) === "threadpool-role") {
          const leaseId = normalizeText(body.leaseId ?? conversation?.leaseId);
          const ownerId = normalizeText(body.ownerId ?? conversation?.ownerId) || OWNER_PREFIX;
          if (leaseId && typeof handlers.threadPool?.releaseLease === "function") {
            leaseRelease = await handlers.threadPool.releaseLease({ leaseId, ownerId }).catch((error) => safeThreadPoolError(error));
          }
          if (body.discardThread && typeof handlers.threadPool?.discardThread === "function") {
            threadDiscard = await handlers.threadPool.discardThread({
              threadId,
              reason: normalizeText(body.reason) || "agent-chat-thread-stopped",
            }).catch((error) => safeThreadPoolError(error));
          }
        }
        conversation = await handlers.agentConversationStore?.stopThread?.({
          conversationId,
          reason: normalizeText(body.reason),
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        }) ?? conversation;
        if (body.archiveConversation && conversationId) {
          conversation = await handlers.agentConversationStore?.archive?.(conversationId, { expectedRevision: null }) ?? conversation;
        }
        return {
          ok: true,
          action: "stop_thread",
          threadId,
          activeTurnId,
          turnStop,
          leaseRelease,
          threadDiscard,
          conversationStatus: conversation?.status ?? null,
          conversationRevision: conversation?.revision ?? null,
          latestTurnId: conversation?.latestTurnId ?? activeTurnId,
          threadStopped: Boolean(conversation?.threadStopped),
          retryable: true,
          activeTurnStatus: normalizeTurnStatus(turnStop?.status ?? latestAssistantStatus(conversation, activeTurnId)),
          actionProjection: buildAgentChatActionProjection({
            conversation,
            threadId,
            turnId: activeTurnId,
            status: turnStop?.status ?? latestAssistantStatus(conversation, activeTurnId),
            retryable: true,
          }),
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        };
      });
    },
    summarizeOutput: (result) => ({
      action: result.action,
      threadId: result.threadId,
      activeTurnId: result.activeTurnId,
      turnStopStatus: result.turnStop?.status ?? null,
      leaseRelease: result.leaseRelease?.status ?? null,
      threadDiscard: result.threadDiscard?.status ?? null,
      conversationStatus: result.conversationStatus,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatTurnRetry(req, res, threadId, turnId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const mode = normalizeRetryMode(body.mode);
  return runAgentChatStage(res, handlers, {
    stageName: mode === "new_thread" ? "agentChat.thread.retry" : "agentChat.turn.retry",
    inputSummary: {
      threadId,
      turnId,
      mode,
      conversationId: normalizeText(body.conversationId),
      source: normalizeSource(body.source),
      role: normalizeText(body.role),
    },
    action: async ({ traceContext }) => {
      const conversationId = normalizeText(body.conversationId);
      if (!conversationId) throw badRequestError("agent_chat_conversation_required", "重试需要 conversationId 以读取可重放任务");
      return withConversationLock(conversationId, async () => {
        const conversation = await handlers.agentConversationStore?.assertActive?.(conversationId, { expectedRevision: normalizeRevision(body.expectedRevision) });
        if (!conversation) throw notFoundError("agent_chat_conversation_not_found", "未找到 Agent 会话");
        const replayTask = findReplayTask(conversation, turnId);
        if (!replayTask) throw badRequestError("agent_chat_replay_task_missing", "未找到可重放任务");
        const sourceStatus = latestAssistantStatus(conversation, replayTask.sourceTurnId);
        if (!isTerminalStatus(sourceStatus)) {
          throw badRequestError("agent_chat_retry_source_not_terminal", "当前 turn 尚未结束，不能安全重试");
        }
        const session = mode === "new_thread"
          ? await createRetryThreadSession({ body, conversation, handlers, traceContext })
          : {
              source: conversation.source ?? body.source ?? "direct",
              role: conversation.role ?? body.role ?? null,
              threadId,
              leaseId: conversation.leaseId ?? body.leaseId ?? null,
              parentThreadId: conversation.parentThreadId ?? body.parentThreadId ?? null,
              workspaceRoot: normalizeText(body.workspaceRoot) || conversation.workspaceRoot || handlers.rootDir,
              skillPath: normalizeText(body.skillPath) || conversation.skillPath || null,
            };
        let boundConversation = conversation;
        if (mode === "new_thread") {
          boundConversation = await handlers.agentConversationStore?.bindThread?.({
            conversationId,
            threadId: session.threadId,
            parentThreadId: session.parentThreadId,
            leaseId: session.leaseId,
            ownerId: session.ownerId,
            workspaceRoot: session.workspaceRoot,
            skillPath: session.skillPath,
            source: session.source,
            traceId: traceContext.traceId,
            runId: traceContext.runId,
            stageId: traceContext.stageId,
          }) ?? conversation;
        }
        let result;
        try {
          result = await handlers.appServer.startTurnWithInputs({
            workspaceRoot: session.workspaceRoot || handlers.rootDir,
            threadId: session.threadId,
            inputs: buildTextInputs(replayTask.text),
            skillPath: session.skillPath,
            timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
          });
          assertAgentChatTurnStarted(result);
          assertExpectedThreadResult(result, session.threadId, "agent_chat_turn_start_thread_mismatch");
        } catch (error) {
          if (mode === "new_thread") {
            await releaseRetrySessionLease(session, handlers);
            await restoreRetryConversationBinding({ conversation, session, handlers, traceContext });
          }
          throw error;
        }
        const retryTurnId = result.turnId ?? result.turn?.id ?? null;
        const recorded = await handlers.agentConversationStore?.recordUserTurn?.({
          conversationId,
          turnId: retryTurnId,
          text: replayTask.text,
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        }) ?? boundConversation;
        await registerAgentChatActiveTurn(handlers, {
          payload: {
            conversationId,
            source: session.source,
            role: session.role,
            leaseId: session.leaseId,
            threadPoolOwnerId: session.ownerId,
            workspaceRoot: session.workspaceRoot,
            threadId: session.threadId,
            turnId: retryTurnId,
            status: result.status ?? "submitted",
            traceId: traceContext.traceId,
            runId: traceContext.runId,
            stageId: traceContext.stageId,
          },
          conversation: recorded,
          message: replayTask.text,
          traceContext,
          stageName: mode === "new_thread" ? "agentChat.thread.retry" : "agentChat.turn.retry",
          sourceTurnId: replayTask.sourceTurnId,
        });
        return {
          ok: true,
          action: mode === "new_thread" ? "retry_new_thread" : "retry_same_thread",
          sourceTurnId: replayTask.sourceTurnId,
          threadId: session.threadId,
          previousThreadId: threadId,
          turnId: retryTurnId,
          status: result.status ?? "submitted",
          conversationRevision: recorded?.revision ?? null,
          latestTurnId: recorded?.latestTurnId ?? retryTurnId,
          threadStopped: Boolean(recorded?.threadStopped),
          retryable: true,
          activeTurnStatus: normalizeTurnStatus(result.status ?? "submitted"),
          actionProjection: buildAgentChatActionProjection({
            conversation: recorded,
            threadId: session.threadId,
            turnId: retryTurnId,
            status: result.status ?? "submitted",
            retryable: true,
          }),
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        };
      });
    },
    summarizeOutput: (result) => ({
      action: result.action,
      sourceTurnId: result.sourceTurnId,
      previousThreadId: result.previousThreadId,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      conversationRevision: result.conversationRevision,
    }),
    successStatus: 202,
  });
}

module.exports = {
  handleAgentChatThreadStop,
  handleAgentChatTurnRetry,
  handleAgentChatTurnStop,
};
