const { readJsonBody } = require("../observability/ui-debug-events");
const { buildAgentChatActionProjection } = require("../agent-chat/actions");
const { maybeAutoReviewShotDialogue, reviewShotDialogueForConversation } = require("../agent-chat/shot-dialogue-auto-review");
const { normalizeTurnStatus } = require("../active-turns/status");
const { buildDialogueReworkMessage, findLatestDialogueReviewValue, readDialogueReviewDetails } = require("./agent-chat-dialogue-helpers");
const {
  badRequestError,
  normalizeRevision,
  normalizeText,
  notFoundError,
  nullableNumber,
  runAgentChatStage,
  safePreview,
} = require("./agent-chat-route-core");
const {
  DEFAULT_TURN_TIMEOUT_SECONDS,
  assertAgentChatTurnStarted,
  assertExpectedThreadResult,
  buildTextInputs,
  registerAgentChatActiveTurn,
} = require("./agent-chat-route-shared");

async function handleAgentChatConversationDialogueReview(req, res, conversationId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.dialogueReview.manual",
    inputSummary: {
      conversationId,
      turnId: normalizeText(body.turnId),
      shotDesignFinalPath: normalizeText(body.shotDesignFinalPath),
      expectedRevision: normalizeRevision(body.expectedRevision),
      force: body.force !== false,
    },
    action: async ({ traceContext }) => {
      const conversation = await handlers.agentConversationStore?.assertActive?.(conversationId, {
        expectedRevision: normalizeRevision(body.expectedRevision),
      });
      if (!conversation) throw notFoundError("agent_chat_conversation_not_found", "未找到 Agent 会话");
      const review = await reviewShotDialogueForConversation({
        handlers,
        traceContext,
        conversationId,
        shotDesignFinalPath: normalizeText(body.shotDesignFinalPath),
        sourceTurnId: normalizeText(body.turnId) ?? conversation.latestTurnId ?? null,
        parentArtifactId: normalizeText(body.parentArtifactId) ?? normalizeText(body.turnId) ?? conversation.latestTurnId ?? null,
        trigger: "manual_button",
        force: body.force !== false,
      });
      const updated = review.status === "processed"
        ? await handlers.agentConversationStore?.attachDialogueRoboticReview?.({
            conversationId,
            turnId: normalizeText(body.turnId) ?? conversation.latestTurnId ?? null,
            dialogueRoboticReview: review,
            traceId: review.traceId,
            runId: review.runId,
            stageId: review.stageId,
          }) ?? conversation
        : conversation;
      return {
        ok: review.ok !== false,
        review,
        conversation: updated,
        conversationRevision: updated?.revision ?? null,
        traceId: review.traceId ?? traceContext.traceId,
        runId: review.runId ?? traceContext.runId,
        stageId: review.stageId ?? traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({
      conversationId: result.conversation?.conversationId ?? conversationId,
      status: result.review?.status ?? null,
      decision: result.review?.decision ?? null,
      issueCount: result.review?.issueCount ?? null,
      conversationRevision: result.conversationRevision ?? null,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatConversationDialogueRework(req, res, conversationId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.dialogueReview.rework",
    inputSummary: {
      conversationId,
      threadId: normalizeText(body.threadId),
      sourceReviewOutputPath: normalizeText(body.reviewOutputPath),
      sourceShotDesignFinalPath: normalizeText(body.shotDesignFinalPath),
      expectedRevision: normalizeRevision(body.expectedRevision),
    },
    action: async ({ traceContext }) => {
      const conversation = await handlers.agentConversationStore?.assertActive?.(conversationId, {
        expectedRevision: normalizeRevision(body.expectedRevision),
      });
      return submitDialogueReworkTurn({
        handlers,
        conversationId,
        conversation,
        body,
        traceContext,
        stageName: "agentChat.dialogueReview.rework",
      });
    },
    summarizeOutput: (result) => ({
      role: result.role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      conversationRevision: result.conversationRevision ?? null,
    }),
    successStatus: 202,
  });
}

async function maybeSubmitAutomaticDialogueRework({ handlers, conversationId, review, sourceConversation, traceContext, sourceTurnId }) {
  if (!conversationId || !review?.reviewOutputPath) return null;
  try {
    const conversation = sourceConversation ?? await handlers.agentConversationStore?.get?.(conversationId);
    return await submitDialogueReworkTurn({
      handlers,
      conversationId,
      conversation,
      body: {
        threadId: conversation?.threadId,
        workspaceRoot: conversation?.workspaceRoot,
        skillPath: conversation?.skillPath,
        source: conversation?.source,
        role: conversation?.role,
        leaseId: conversation?.leaseId,
        shotDesignFinalPath: review.shotDesignFinalPath,
        reviewOutputPath: review.reviewOutputPath,
        decision: review.decision,
        issueCount: review.issueCount,
        parentArtifactId: review.artifactId ?? review.reviewOutputPath,
      },
      traceContext,
      stageName: "agentChat.dialogueReview.autoRework",
      sourceTurnId,
      skipExpectedRevision: true,
    });
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      error: error?.code ?? "agent_chat_dialogue_auto_rework_failed",
      message: safePreview(error instanceof Error ? error.message : "自动台词返工提交失败", 240),
      retryable: error?.retryable !== false,
      reviewOutputPath: review.reviewOutputPath ?? null,
      shotDesignFinalPath: review.shotDesignFinalPath ?? null,
    };
  }
}

async function submitDialogueReworkTurn({
  handlers,
  conversationId,
  conversation,
  body = {},
  traceContext,
  stageName,
  sourceTurnId = null,
  skipExpectedRevision = false,
}) {
  if (!conversation) throw notFoundError("agent_chat_conversation_not_found", "未找到 Agent 会话");
  if (conversation.role !== "function-slot-restructure" && conversation.role !== "function-slot-shot-design") {
    throw badRequestError("agent_chat_dialogue_rework_role_invalid", "台词返工只能提交给 function-slot-restructure 或 function-slot-shot-design 会话");
  }
  const threadId = normalizeText(body.threadId) ?? conversation.threadId;
  if (!threadId) throw badRequestError("agent_chat_dialogue_rework_thread_missing", "当前会话缺少可返工的 thread");
  if (conversation.threadId && conversation.threadId !== threadId) {
    throw badRequestError("agent_chat_dialogue_rework_thread_mismatch", "返工 threadId 与会话不一致");
  }
  const workspaceRoot = normalizeText(body.workspaceRoot) || conversation.workspaceRoot || handlers.rootDir;
  const shotDesignFinalPath = normalizeText(body.shotDesignFinalPath) || findLatestDialogueReviewValue(conversation, "shotDesignFinalPath");
  const reviewOutputPath = normalizeText(body.reviewOutputPath) || findLatestDialogueReviewValue(conversation, "reviewOutputPath");
  if (!shotDesignFinalPath || !reviewOutputPath) {
    throw badRequestError("agent_chat_dialogue_rework_review_missing", "缺少台词 review 结果，需先触发台词审查");
  }
  const reviewDetails = await readDialogueReviewDetails({
    rootDir: workspaceRoot,
    reviewOutputPath,
  });
  const message = buildDialogueReworkMessage({
    shotDesignFinalPath,
    reviewOutputPath,
    decision: normalizeText(body.decision) || findLatestDialogueReviewValue(conversation, "decision"),
    issueCount: nullableNumber(body.issueCount) ?? nullableNumber(findLatestDialogueReviewValue(conversation, "issueCount")),
    reviewDetails,
    userInstruction: normalizeText(body.userInstruction),
  });
  const result = await handlers.appServer.startTurnWithInputs({
    workspaceRoot,
    threadId,
    inputs: buildTextInputs(message),
    skillPath: conversation.skillPath || normalizeText(body.skillPath),
    timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
  });
  assertAgentChatTurnStarted(result);
  assertExpectedThreadResult(result, threadId, "agent_chat_dialogue_rework_thread_mismatch");
  const turnId = result.turnId ?? result.turn?.id ?? null;
  const recorded = await handlers.agentConversationStore?.recordUserTurn?.({
    conversationId,
    turnId,
    text: message,
    traceId: traceContext.traceId,
    runId: traceContext.runId,
    stageId: traceContext.stageId,
    expectedRevision: skipExpectedRevision ? null : normalizeRevision(body.expectedRevision),
  }) ?? conversation;
  await registerAgentChatActiveTurn(handlers, {
    payload: {
      conversationId,
      source: conversation.source ?? body.source ?? "threadpool-role",
      role: conversation.role,
      leaseId: conversation.leaseId ?? body.leaseId ?? null,
      threadPoolOwnerId: conversation.ownerId ?? body.ownerId ?? null,
      workspaceRoot,
      threadId: result.threadId ?? threadId,
      turnId,
      status: result.status ?? "submitted",
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      parentArtifactId: normalizeText(body.parentArtifactId) ?? reviewOutputPath,
    },
    conversation: recorded,
    message,
    traceContext,
    stageName,
    sourceTurnId: sourceTurnId ?? conversation.latestTurnId ?? null,
  });
  return {
    ok: true,
    source: conversation.source ?? body.source ?? "threadpool-role",
    role: conversation.role,
    conversationId,
    conversationRevision: recorded?.revision ?? null,
    workspaceRoot,
    threadId: result.threadId ?? threadId,
    turnId,
    status: result.status ?? "submitted",
    userTurnText: message,
    traceId: traceContext.traceId,
    runId: traceContext.runId,
    stageId: traceContext.stageId,
    actionProjection: buildAgentChatActionProjection({
      conversation: recorded,
      threadId: result.threadId ?? threadId,
      turnId,
      status: result.status ?? "submitted",
      retryable: true,
    }),
    latestTurnId: recorded?.latestTurnId ?? turnId,
    threadStopped: Boolean(recorded?.threadStopped),
    retryable: true,
    activeTurnStatus: normalizeTurnStatus(result.status ?? "submitted"),
  };
}

module.exports = {
  handleAgentChatConversationDialogueReview,
  handleAgentChatConversationDialogueRework,
  maybeAutoReviewShotDialogue,
  maybeSubmitAutomaticDialogueRework,
  submitDialogueReworkTurn,
};
