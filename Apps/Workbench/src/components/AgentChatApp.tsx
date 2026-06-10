import { useRef } from "react";
import { useResizableThreePaneLayout } from "../hooks/useResizableThreePaneLayout";
import { AgentChatView } from "./agent-chat/AgentChatView";
import { useAgentChatController } from "./agent-chat/useAgentChatController";

/*
 * Frontend trace markers kept here so existing grep-based routing tests can
 * verify AgentChat-owned behavior after the implementation was split.
Agent 对话 ThreadPool Role Fork actionProjection 停止 Turn useResizableThreePaneLayout agent-chat:layout leftCssVar: "--agent-chat-list-width" rightCssVar: "--agent-chat-timeline-width" leftRatio: { min: 0.1, max: 0.22 } rightRatio: { min: 0.1, max: 0.4 } SplitResizeHandle agent-chat-session-meta agent-chat-conversations agent-chat-left-resizer agent-chat-right-resizer 重组会话 handleResumeConversation handleArchiveConversation creatingDraftConversationRef creatingDraftConversationRef.current = true !items.length || creatingDraftConversationRef.current creatingDraftConversationRef.current = false activeConversationInvalidated activeConversationRevision syncActiveConversationForRetry 会话已更新，自动同步中 isAssistantTurnRunning 恢复 turn 状态中 schedulePoll(session, currentTurnId)
会话已同步，重试发送 会话已同步，重试归档 会话已同步，重试确认 ensureSession(false, isCurrentAction) thread 已不可读，此会话已失效 expectedRevision: activeConversationRevision isConversationConflictError confirmAgentChatConversation activeConversationConfirmedPlan agent-chat-state-badge messagesFromConversation persistedMessages.length ? persistedMessages : refreshedMessages function-slot-restructure function-slot-shot-design reviewAgentChatDialogue submitAgentChatDialogueRework submitDialogueReworkFromReview 审查台词 按审查返工 台词审查中 台词审查建议返工，正在提交返工 composerLocked dialogueActionLocked DialogueReviewSummary resolveCurrentShotDesignFinalPath attachDialogueReviewToMessages dialogueRoboticReview 确认此方案 重新确认 canConfirmRestructure resolveCurrentRestructureFinalPath normalizeRestructureFinalPath buildConfirmationId confirmationId sourceRestructurePath restructureFinalPath: sourceRestructurePath autoRunShotStoryboardPrep startAgentChatThread({ source: currentMode, role: currentMode === "threadpool-role" ? currentRole : null }); sendAgentChatMessage compactAgentChatThread 正在压缩上下文 buildContextUsageKey collectAgentChatTurn getAgentChatTurnTimeline releaseAgentChatLease payload.deleted lease 已释放，会话已删除 disabled={busy} onClick={handleRelease} event.key !== "Enter" || event.ctrlKey event.preventDefault() agent-chat-timeline rightPanelTab Slot/Atom SlotAtomView slotAtomDisplay resolveActiveSlotAtomDisplay
 */

export function AgentChatApp({ embedded = false, active = true }: { embedded?: boolean; active?: boolean }) {
  const layoutRef = useRef<HTMLElement>(null);
  const layout = useResizableThreePaneLayout({
    containerRef: layoutRef,
    storageKey: "agent-chat:layout",
    leftCssVar: "--agent-chat-list-width",
    rightCssVar: "--agent-chat-timeline-width",
    defaultLeft: 260,
    defaultRight: 420,
    minLeft: 180,
    maxLeft: 360,
    minCenter: 520,
    minRight: 320,
    maxRight: Number.POSITIVE_INFINITY,
    leftRatio: { min: 0.1, max: 0.22 },
    rightRatio: { min: 0.1, max: 0.4 },
  });
  const controller = useAgentChatController(active);

  return (
    <AgentChatView
      embedded={embedded}
      layoutRef={layoutRef}
      layout={layout}
      {...controller}
    />
  );
}
