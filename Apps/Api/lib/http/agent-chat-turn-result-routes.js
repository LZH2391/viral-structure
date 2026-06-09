const { buildAgentActivityFromTurnResult, summarizeAgentTurnTimeline, summarizeAgentTurnTimelineFromItems } = require("../observability/agent-turn-timeline");
const { findTurn: findRolloutTurn, mergeThreadWithRollout, mergeTurnItems, resolveTurnId } = require("../observability/codex-rollout-reader");
const { buildAgentChatActionProjection } = require("../agent-chat/actions");
const { maybeAutoTransformRestructureResult } = require("../agent-chat/restructure-auto-display");
const { maybeAutoReviewShotDialogue } = require("../agent-chat/shot-dialogue-auto-review");
const { maybeCollectConversationTitle } = require("../agent-chat/title-service");
const { normalizeTurnStatus } = require("../active-turns/status");
const { guardUncertainTerminalResult } = require("../active-turns/runtime");
const {
  normalizeText,
  runAgentChatStage,
  safePreview,
} = require("./agent-chat-route-core");
const { maybeCompleteAutomaticAdvance } = require("./agent-chat-auto-advance-routes");
const { maybeSubmitAutomaticDialogueRework } = require("./agent-chat-dialogue-routes");
const {
  DEFAULT_TURN_TIMEOUT_SECONDS,
  assertExpectedTurnResult,
  findTurn,
  isTerminalStatus,
  maxRevision,
  normalizeActiveMessage,
} = require("./agent-chat-route-shared");

async function handleAgentChatTurnCollect(res, threadId, turnId, handlers = {}, url = null) {
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.turn.collect",
    inputSummary: { threadId, turnId },
    action: async ({ traceContext }) => {
      const workspaceRoot = url?.searchParams?.get("workspaceRoot") || handlers.rootDir;
      const rawResult = await handlers.appServer.collectTurnResult({
        workspaceRoot,
        threadId,
        turnId,
        timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
      });
      const activeBinding = await handlers.activeTurnRuntime?.getByTurnId?.(turnId).catch(() => null);
      const result = guardUncertainTerminalResult(activeBinding, rawResult);
      assertExpectedTurnResult(result, turnId, "agent_chat_turn_collect_mismatch");
      await hydrateResultActivityFromRollout(result, { handlers, threadId, turnId });
      const activity = buildAgentActivityFromTurnResult(result);
      const payload = {
        ok: true,
        threadId: result.threadId ?? threadId,
        turnId: result.turnId ?? turnId,
        status: result.status ?? "unknown",
        finalMessage: result.finalMessage ?? null,
        activeThreadMessage: result.activeThreadMessage ?? null,
        turnActivity: result.turnActivity ?? null,
        terminalConfidence: result.terminalConfidence ?? null,
        statusReason: result.statusReason ?? null,
        originalStatus: result.originalStatus ?? null,
        originalFinalMessageSummary: result.originalFinalMessageSummary ?? null,
        activity,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
      const materializedDisplay = await maybeMaterializeRestructureDisplay({
        payload,
        handlers,
        traceContext,
        url,
      });
      if (materializedDisplay) payload.materializedDisplay = materializedDisplay;
      const conversationId = normalizeText(url?.searchParams?.get("conversationId"));
      if (conversationId) payload.conversationId = conversationId;
      let recorded = null;
      const autoDisplayTransform = await maybeAutoTransformRestructureResult({
        payload,
        handlers,
        traceContext,
        conversationId,
        url,
      });
      if (autoDisplayTransform) payload.autoDisplayTransform = autoDisplayTransform;
      const autoDialogueRoboticReview = await maybeAutoReviewShotDialogue({
        payload,
        handlers,
        traceContext,
        conversationId,
        url,
        activeBinding,
      });
      if (autoDialogueRoboticReview) payload.autoDialogueRoboticReview = autoDialogueRoboticReview;
      const activeText = normalizeActiveMessage(payload.activeThreadMessage);
      if (conversationId) {
        recorded = await handlers.agentConversationStore?.recordAssistantTurn?.({
          conversationId,
          turnId: payload.turnId,
          text: payload.finalMessage || activeText || (isTerminalStatus(payload.status) ? "" : "生成中"),
          status: payload.status,
          traceId: payload.traceId,
          runId: payload.runId,
          stageId: payload.stageId,
          slotAtomDisplay: payload.autoDisplayTransform?.slotAtomDisplay ?? null,
          dialogueRoboticReview: hasReusableDialogueReview(payload.autoDialogueRoboticReview)
            ? payload.autoDialogueRoboticReview
            : null,
        });
      }
      const titleConversation = conversationId
        ? await maybeCollectConversationTitle({
          handlers,
          conversation: recorded ?? await handlers.agentConversationStore?.get?.(conversationId).catch(() => null),
          traceContext,
        }).catch(() => null)
        : null;
      if (titleConversation?.revision) recorded = titleConversation;
      if (conversationId && payload.autoDialogueRoboticReview?.status === "processed" && payload.autoDialogueRoboticReview.decision === "rework" && payload.autoDialogueRoboticReview.reviewOutputPath) {
        payload.autoDialogueRework = await maybeSubmitAutomaticDialogueRework({
          handlers,
          conversationId,
          review: payload.autoDialogueRoboticReview,
          sourceConversation: recorded ?? await handlers.agentConversationStore?.get?.(conversationId).catch(() => null),
          traceContext,
          sourceTurnId: payload.turnId,
        });
      }
      if (conversationId && payload.autoDialogueRoboticReview?.status === "processed" && payload.autoDialogueRoboticReview.decision === "pass") {
        payload.autoAdvanceConfirmation = await maybeCompleteAutomaticAdvance({
          handlers,
          conversationId,
          payload,
          traceContext,
        });
      }
      const markedActiveTurn = await handlers.activeTurnRuntime?.markCollectResult?.({
        turnId: payload.turnId,
        result: payload,
        traceContext,
        skipOwnerHandler: true,
      }).catch(() => null);
      if (markedActiveTurn?.result && markedActiveTurn.result !== payload) {
        Object.assign(payload, markedActiveTurn.result);
      }
      payload.conversationRevision = recorded?.revision ?? null;
      if (recorded?.title) payload.conversationTitle = recorded.title;
      if (recorded?.titleState) payload.conversationTitleState = recorded.titleState;
      if (titleConversation?.titleState) payload.titleGeneration = summarizeTitleState(titleConversation.titleState);
      payload.latestTurnId = recorded?.latestTurnId ?? payload.turnId;
      payload.threadStopped = Boolean(recorded?.threadStopped);
      if (payload.autoDialogueRework?.ok) {
        payload.conversationRevision = maxRevision(payload.conversationRevision, payload.autoDialogueRework.conversationRevision);
        payload.latestTurnId = payload.autoDialogueRework.latestTurnId ?? payload.autoDialogueRework.turnId ?? payload.latestTurnId;
        payload.threadStopped = Boolean(payload.autoDialogueRework.threadStopped);
      }
      if (payload.autoAdvanceConfirmation?.ok) {
        payload.conversationRevision = maxRevision(payload.conversationRevision, payload.autoAdvanceConfirmation.conversationRevision);
      }
      payload.retryable = true;
      payload.activeTurnStatus = normalizeTurnStatus(payload.status);
      payload.actionProjection = buildAgentChatActionProjection({
        conversation: recorded,
        threadId: payload.autoDialogueRework?.threadId ?? payload.threadId,
        turnId: payload.autoDialogueRework?.turnId ?? payload.turnId,
        status: payload.autoDialogueRework?.status ?? payload.status,
        retryable: true,
      });
      if (payload.autoDialogueRework?.actionProjection) payload.actionProjection = payload.autoDialogueRework.actionProjection;
      return payload;
    },
    summarizeOutput: (result) => ({
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      finalMessageChars: result.finalMessage ? String(result.finalMessage).length : 0,
      activityStatus: result.activity?.status ?? null,
      autoDisplayStatus: result.autoDisplayTransform?.status ?? null,
      autoDialogueReviewStatus: result.autoDialogueRoboticReview?.status ?? null,
      autoDialogueReworkStatus: result.autoDialogueRework?.status ?? null,
      autoAdvanceConfirmationStatus: result.autoAdvanceConfirmation?.status ?? null,
      titleStatus: result.titleGeneration?.status ?? null,
    }),
    successStatus: 200,
  });
}

function summarizeTitleState(titleState) {
  if (!titleState) return null;
  return {
    status: titleState.status ?? null,
    titleTurnId: titleState.titleTurnId ?? null,
    error: titleState.errorSummary?.code ?? null,
  };
}

async function maybeMaterializeRestructureDisplay({ payload, handlers, traceContext, url }) {
  if (payload.status !== "completed") return null;
  if (!payload.finalMessage) return null;
  if (normalizeText(url?.searchParams?.get("role")) !== "function-slot-restructure-display-transformer") return null;
  const service = handlers.restructureDisplayOverlayService;
  if (!service?.materializeFromTurn) return null;
  return service.materializeFromTurn({
    finalMessage: payload.finalMessage,
    restructureFinalPath: normalizeText(url?.searchParams?.get("restructureFinalPath")),
    sourceTurnId: payload.turnId,
    parentArtifactId: normalizeText(url?.searchParams?.get("parentArtifactId")),
    confirmationId: normalizeText(url?.searchParams?.get("confirmationId")),
    traceContext,
  });
}

async function handleAgentChatTurnTimeline(res, threadId, turnId, handlers = {}, url = null) {
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.timeline.read",
    inputSummary: { threadId, turnId },
    action: async () => {
      const workspaceRoot = url?.searchParams?.get("workspaceRoot") || handlers.rootDir;
      const rollout = await handlers.codexRolloutReader?.readThread?.({ threadId, turnId }).catch(() => null);
      const threadResult = await handlers.appServer.readThread({ workspaceRoot, threadId }).catch((error) => {
        if (rollout?.thread) return { thread: rollout.thread, rolloutReadFallback: error };
        throw error;
      });
      const thread = mergeThreadWithRollout(threadResult.thread ?? {}, rollout?.thread);
      const effectiveTurnId = resolveTurnId(rollout?.thread, turnId) ?? resolveTurnId(thread, turnId) ?? turnId;
      const turn = findTurn(thread, effectiveTurnId);
      let timeline = null;
      let source = "thread/read";
      let itemListFallback = null;
      if (typeof handlers.appServer.listTurnItems === "function") {
        try {
          const listed = await handlers.appServer.listTurnItems({ workspaceRoot, threadId, turnId: effectiveTurnId, limit: 500, sortDirection: "asc" });
          if (Array.isArray(listed?.items) && listed.items.length > 0) {
            const rolloutTurn = findRolloutTurn(rollout?.thread, effectiveTurnId);
            const items = mergeTurnItems(listed.items, rolloutTurn?.items);
            timeline = summarizeAgentTurnTimelineFromItems({ thread, turn, items, turnId: effectiveTurnId });
            source = "thread/turns/items/list";
            if (rolloutTurn?.items?.length) source = "thread/turns/items/list+codex-rollout";
          }
        } catch (error) {
          itemListFallback = {
            code: error?.code ?? "appserver_turn_items_list_failed",
            message: safePreview(error instanceof Error ? error.message : "turn item list unavailable", 160),
          };
        }
      }
      timeline = timeline ?? summarizeAgentTurnTimeline(thread, effectiveTurnId);
      if (timeline && source === "thread/read" && rollout?.thread) source = "thread/read+codex-rollout";
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

async function hydrateResultActivityFromRollout(result, { handlers, threadId, turnId }) {
  if (result?.turnActivity?.tokenUsage && result.turnActivity.itemCount != null) return;
  const rollout = await handlers.codexRolloutReader?.readThread?.({ threadId: result?.threadId ?? threadId, turnId: result?.turnId ?? turnId }).catch(() => null);
  const rolloutTurn = findRolloutTurn(rollout?.thread, result?.turnId ?? turnId);
  if (!rolloutTurn) return;
  const activity = buildAgentActivityFromTurnResult({
    threadId: result?.threadId ?? threadId,
    turnId: result?.turnId ?? turnId,
    status: result?.status,
    turnActivity: null,
    activeThreadMessage: result?.activeThreadMessage,
  }) ?? {};
  const timelineActivity = summarizeAgentTurnTimeline(rollout.thread, rolloutTurn.id)?.activity;
  result.turnActivity = {
    ...timelineActivity,
    ...result.turnActivity,
    tokenUsage: result.turnActivity?.tokenUsage ?? timelineActivity?.tokenUsage ?? null,
    itemCount: result.turnActivity?.itemCount ?? timelineActivity?.itemCount ?? activity.itemCount ?? null,
    effectiveItemCount: result.turnActivity?.effectiveItemCount ?? timelineActivity?.effectiveItemCount ?? activity.effectiveItemCount ?? null,
    latestItemType: result.turnActivity?.latestItemType ?? timelineActivity?.latestItemType ?? activity.latestItemType ?? null,
    latestMessagePreview: result.turnActivity?.latestMessagePreview ?? timelineActivity?.latestMessagePreview ?? activity.latestMessagePreview ?? null,
    latestToolName: result.turnActivity?.latestToolName ?? timelineActivity?.latestToolName ?? activity.latestToolName ?? null,
  };
}

function hasReusableDialogueReview(review) {
  if (!review?.decision) return false;
  return review.status === "processed" || review.status === "skipped_unchanged";
}

module.exports = {
  handleAgentChatTurnCollect,
  handleAgentChatTurnTimeline,
};
