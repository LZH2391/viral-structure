const { sendJson } = require("./utils");
const { readJsonBody } = require("../observability/ui-debug-events");
const { summarizeThreadConversation } = require("../observability/thread-conversation");
const {
  normalizeArtifactRef,
  normalizeMessage,
  normalizeRevision,
  normalizeText,
  runAgentChatStage,
  safePreview,
  withConversationLock,
} = require("./agent-chat-route-core");
const { hydrateConversationSlotAtomDisplays: hydrateSlotAtomDisplays } = require("../agent-chat/restructure-auto-display-utils");
const { maybeCollectConversationTitle } = require("../agent-chat/title-service");

async function handleAgentChatConversationList(res, handlers = {}, url = null) {
  const limit = parsePositiveInteger(url?.searchParams?.get("limit"), null, { max: 100 });
  const offset = parsePositiveInteger(url?.searchParams?.get("offset"), 0);
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.conversation.list",
    inputSummary: {
      role: url?.searchParams?.get("role") ?? null,
      status: url?.searchParams?.get("status") ?? "active",
      limit,
      offset,
    },
    action: async ({ traceContext }) => {
      const allConversations = await handlers.agentConversationStore.list({
        role: normalizeText(url?.searchParams?.get("role")),
        status: normalizeText(url?.searchParams?.get("status")) || "active",
      });
      const total = allConversations.length;
      const conversations = limit == null
        ? allConversations.slice(offset)
        : allConversations.slice(offset, offset + limit);
      const nextOffset = offset + conversations.length;
      return {
        ok: true,
        conversations: await Promise.all(conversations.map((conversation) => hydrateConversationForAgentChat(conversation, { handlers, traceContext }))),
        total,
        limit: limit ?? null,
        offset,
        hasMore: nextOffset < total,
        nextOffset: nextOffset < total ? nextOffset : null,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({ count: result.conversations.length, total: result.total, limit: result.limit, offset: result.offset }),
    successStatus: 200,
  });
}

function parsePositiveInteger(value, fallback, { max = Number.POSITIVE_INFINITY } = {}) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(number)));
}

async function handleAgentChatConversationResume(res, conversationId, handlers = {}) {
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.conversation.resume",
    inputSummary: { conversationId },
    action: async ({ traceContext }) => {
      const conversation = await handlers.agentConversationStore.get(conversationId);
      if (!conversation || conversation.status === "archived") {
        const error = new Error("未找到 active Agent 会话");
        error.statusCode = 404;
        error.code = "agent_chat_conversation_not_found";
        throw error;
      }
      let refreshed = null;
      let refreshError = null;
      let deleted = false;
      if (conversation.threadId) {
        try {
          const thread = await handlers.appServer.readThread({ workspaceRoot: conversation.workspaceRoot || handlers.rootDir, threadId: conversation.threadId });
          refreshed = summarizeThreadConversation(thread.thread ?? {});
        } catch (error) {
          refreshError = {
            code: error?.code ?? "agent_chat_conversation_thread_unavailable",
            message: safePreview(error instanceof Error ? error.message : "会话线程暂不可读", 160),
          };
          await handlers.agentConversationStore.remove(conversationId);
          deleted = true;
        }
      }
      return {
        ok: true,
        conversation: await hydrateConversationForAgentChat(conversation, { handlers, traceContext }),
        refreshed,
        refreshError,
        deleted,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({
      conversationId,
      threadId: result.conversation.threadId,
      refreshed: Boolean(result.refreshed),
      refreshError: result.refreshError,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatConversationSystemMessage(req, res, conversationId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const text = normalizeMessage(body.message ?? body.text);
  if (!text) {
    return sendJson(res, 400, {
      error: "agent_chat_system_message_required",
      code: "agent_chat_system_message_required",
      message: "系统消息不能为空",
    });
  }
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.conversation.systemMessage",
    inputSummary: { conversationId, messageChars: text.length, messagePreview: safePreview(text, 80) },
    action: async ({ traceContext }) => {
      const conversation = await withConversationLock(conversationId, () => handlers.agentConversationStore.recordSystemMessage({
          conversationId,
          text,
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
          expectedRevision: normalizeRevision(body.expectedRevision),
        }),
      );
      if (!conversation) {
        const error = new Error("未找到 Agent 会话");
        error.statusCode = 404;
        error.code = "agent_chat_conversation_not_found";
        throw error;
      }
      return {
        ok: true,
        conversation,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({ conversationId: result.conversation.conversationId, messageCount: result.conversation.messages?.length ?? 0 }),
    successStatus: 200,
  });
}

async function handleAgentChatConversationConfirm(req, res, conversationId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.conversation.confirm",
    inputSummary: {
      conversationId,
      turnId: normalizeText(body.turnId),
      confirmationId: normalizeText(body.confirmationId),
      expectedRevision: normalizeRevision(body.expectedRevision),
      sourceRestructurePath: normalizeText(body.sourceRestructurePath),
      sourceShotDesignPath: normalizeText(body.sourceShotDesignPath),
      displayArtifactId: normalizeText(body.displayArtifact?.artifactId),
      storyboardArtifactId: normalizeText(body.storyboardArtifact?.artifactId),
    },
    action: async ({ traceContext }) => {
      const normalizedTurnId = normalizeText(body.turnId);
      const normalizedConfirmationId = normalizeText(body.confirmationId);
      const normalizedRestructurePath = normalizeText(body.sourceRestructurePath);
      const normalizedShotDesignPath = normalizeText(body.sourceShotDesignPath);
      const normalizedStoryboardArtifact = normalizeArtifactRef(body.storyboardArtifact);
      const normalizedStatus = normalizeText(body.status);
      const normalizedVersions = Array.isArray(body.versions) ? body.versions : Array.isArray(body.storyboardVersions) ? body.storyboardVersions : [];
      const normalizedMode = normalizeText(body.mode ?? body.storyboardMode);
      const normalizedDefaultVersionId = normalizeText(body.defaultVersionId);
      const conversation = await withConversationLock(conversationId, () => handlers.agentConversationStore.confirmPlan({
          conversationId,
          turnId: normalizedTurnId,
          confirmationId: normalizedConfirmationId,
          note: normalizeText(body.note),
          sourceRestructurePath: normalizedRestructurePath,
          sourceShotDesignPath: normalizedShotDesignPath,
          displayArtifact: normalizeArtifactRef(body.displayArtifact),
          storyboardArtifact: normalizedStoryboardArtifact,
          storyboardMode: normalizedMode,
          defaultVersionId: normalizedDefaultVersionId,
          storyboardVersions: normalizedVersions,
          status: normalizedStatus,
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
          expectedRevision: normalizeRevision(body.expectedRevision),
        }),
      );
      if (!conversation) {
        const error = new Error("未找到 Agent 会话");
        error.statusCode = 404;
        error.code = "agent_chat_conversation_not_found";
        throw error;
      }
      if ((normalizedStoryboardArtifact || normalizedVersions.length) && normalizedConfirmationId && handlers.agentConversationStore?.createStoryboardResultMessage) {
        await handlers.agentConversationStore.createStoryboardResultMessage({
          conversationId,
          turnId: normalizedTurnId ?? conversation.confirmedPlan?.turnId ?? null,
          confirmationId: normalizedConfirmationId,
          planRevisionKey: buildPlanRevisionKey({
            conversationId,
            turnId: normalizedTurnId ?? conversation.confirmedPlan?.turnId ?? null,
            sourceRestructurePath: normalizedRestructurePath ?? conversation.confirmedPlan?.sourceRestructurePath ?? null,
            sourceShotDesignPath: normalizedShotDesignPath ?? conversation.confirmedPlan?.sourceShotDesignPath ?? null,
          }),
          sourceRestructurePath: normalizedRestructurePath ?? conversation.confirmedPlan?.sourceRestructurePath ?? null,
          sourceShotDesignPath: normalizedShotDesignPath ?? conversation.confirmedPlan?.sourceShotDesignPath ?? null,
          storyboardArtifact: normalizedStoryboardArtifact,
          mode: normalizedMode,
          defaultVersionId: normalizedDefaultVersionId,
          versions: normalizedVersions,
          status: normalizedStatus ?? conversation.confirmedPlan?.status ?? "storyboard_processing",
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        });
      }
      const updatedConversation = await handlers.agentConversationStore.get?.(conversationId) ?? conversation;
      return {
        ok: true,
        conversation: updatedConversation,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({
      conversationId: result.conversation.conversationId,
      confirmedStatus: result.conversation.confirmedPlan?.status ?? null,
      revision: result.conversation.revision ?? null,
    }),
    successStatus: 200,
  });
}

function buildPlanRevisionKey({ conversationId, turnId, sourceRestructurePath, sourceShotDesignPath }) {
  return [
    normalizeText(conversationId) ?? "conversation",
    normalizeText(turnId) ?? "turn",
    normalizeText(sourceRestructurePath) ?? "restructure",
    normalizeText(sourceShotDesignPath) ?? "shot-design",
  ].join(":");
}

async function handleAgentChatConversationArchive(req, res, conversationId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.conversation.archive",
    inputSummary: { conversationId, expectedRevision: normalizeRevision(body.expectedRevision) },
    action: async ({ traceContext }) => {
      const conversation = await withConversationLock(conversationId, () => handlers.agentConversationStore.archive(conversationId, {
          expectedRevision: normalizeRevision(body.expectedRevision),
        }),
      );
      if (!conversation) {
        const error = new Error("未找到 Agent 会话");
        error.statusCode = 404;
        error.code = "agent_chat_conversation_not_found";
        throw error;
      }
      let threadDiscard = null;
      if (conversation.role === "function-slot-restructure" && conversation.threadId && typeof handlers.threadPool?.discardThread === "function") {
        threadDiscard = await handlers.threadPool.discardThread({
          threadId: conversation.threadId,
          reason: "agent-chat-conversation-archived",
        }).catch((error) => ({
          ok: false,
          error: error?.code ?? "threadpool_discard_failed",
          message: safePreview(error instanceof Error ? error.message : "ThreadPool discard failed", 160),
        }));
      }
      return {
        ok: true,
        conversation,
        threadDiscard,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({ conversationId: result.conversation.conversationId, status: result.conversation.status, threadDiscard: result.threadDiscard }),
    successStatus: 200,
  });
}

async function hydrateConversationForAgentChat(conversation, { handlers, traceContext } = {}) {
  const titleRefreshed = await maybeCollectConversationTitle({ handlers, conversation, traceContext }).catch(() => conversation);
  return hydrateSlotAtomDisplays(titleRefreshed ?? conversation, { rootDir: handlers.rootDir });
}

module.exports = {
  handleAgentChatConversationArchive,
  handleAgentChatConversationConfirm,
  handleAgentChatConversationList,
  handleAgentChatConversationResume,
  handleAgentChatConversationSystemMessage,
};
