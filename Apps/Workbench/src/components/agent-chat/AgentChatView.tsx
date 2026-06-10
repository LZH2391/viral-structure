import type { FormEvent, PointerEvent, RefObject } from "react";
import type { AgentChatSessionResponse } from "../../api/client";
import type { AgentChatConversation, AgentChatDialogueRoboticReview, AgentChatSlotAtomDisplay, AgentTurnTimeline, ReplacementDraft, ThreadPoolRoleSummary } from "../../types";
import { shortId } from "../../utils/format";
import { SplitResizeHandle } from "../SplitResizeHandle";
import { ContextUsageIndicator, DialogueReviewSummary, TimelineView } from "./AgentChatPanels";
import { SlotAtomView } from "./SlotAtomReplacementPanel";
import type { ChatMessage, ChatMode, RightPanelTab } from "./agentChatModel";

type AgentChatViewProps = {
  embedded: boolean;
  layoutRef: RefObject<HTMLElement>;
  layout: {
    startResize: (pane: "left" | "right", event: PointerEvent<HTMLElement>) => void;
    resetSize: (pane: "left" | "right") => void;
    nudgeSize: (pane: "left" | "right", direction: number) => void;
  };
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
  roles: ThreadPoolRoleSummary[];
  selectedRole: string;
  setSelectedRole: (role: string) => void;
  session: AgentChatSessionResponse | null;
  conversations: AgentChatConversation[];
  activeConversationId: string | null;
  activeConversationRevision: number | null;
  activeConversationInvalidated: boolean;
  activeConversationConfirmedPlan: AgentChatConversation["confirmedPlan"];
  messages: ChatMessage[];
  draft: string;
  setDraft: (draft: string) => void;
  currentTurnId: string | null;
  threadStopped: boolean;
  timeline: AgentTurnTimeline | null;
  rightPanelTab: RightPanelTab;
  setRightPanelTab: (tab: RightPanelTab) => void;
  statusText: string;
  busy: boolean;
  compacting: boolean;
  confirming: boolean;
  registeringTrace: boolean;
  reviewingDialogue: boolean;
  dialogueReworking: boolean;
  errorText: string | null;
  contextUsage: AgentTurnTimeline["activity"]["tokenUsage"] | null;
  activeSlotAtomDisplay: AgentChatSlotAtomDisplay | null;
  currentRestructureFinalPath: string | null;
  activeDialogueReview: AgentChatDialogueRoboticReview | null;
  currentShotDesignFinalPath: string | null;
  composerLocked: boolean;
  canReviewDialogue: boolean;
  canReworkDialogue: boolean;
  canRegisterPlanTrace: boolean;
  canConfirmRestructure: boolean;
  canStopCurrentTurn: boolean;
  turnActionBusy: "stop_turn" | null;
  startNewConversation: () => void;
  handleResumeConversation: (conversationId: string) => Promise<void>;
  handleArchiveConversation: () => Promise<void>;
  handleRelease: () => Promise<void>;
  handleDialogueReview: () => Promise<void>;
  handleDialogueRework: () => void;
  handleRegisterPlanTrace: () => Promise<void>;
  handleConfirmRestructure: () => Promise<void>;
  handleSend: () => Promise<void>;
  handleStopTurn: () => Promise<void>;
  handleManualReplacementSubmit: (replacementDraft: ReplacementDraft, summary: string) => Promise<void>;
};

export function AgentChatView(props: AgentChatViewProps) {
  const {
    embedded,
    layoutRef,
    layout,
    mode,
    setMode,
    roles,
    selectedRole,
    setSelectedRole,
    session,
    conversations,
    activeConversationId,
    activeConversationRevision,
    activeConversationInvalidated,
    activeConversationConfirmedPlan,
    messages,
    draft,
    setDraft,
    currentTurnId,
    threadStopped,
    timeline,
    rightPanelTab,
    setRightPanelTab,
    statusText,
    busy,
    compacting,
    confirming,
    registeringTrace,
    reviewingDialogue,
    dialogueReworking,
    errorText,
    contextUsage,
    activeSlotAtomDisplay,
    currentRestructureFinalPath,
    activeDialogueReview,
    currentShotDesignFinalPath,
    composerLocked,
    canReviewDialogue,
    canReworkDialogue,
    canRegisterPlanTrace,
    canConfirmRestructure,
    canStopCurrentTurn,
    turnActionBusy,
    startNewConversation,
    handleResumeConversation,
    handleArchiveConversation,
    handleRelease,
    handleDialogueReview,
    handleDialogueRework,
    handleRegisterPlanTrace,
    handleConfirmRestructure,
    handleSend,
    handleStopTurn,
    handleManualReplacementSubmit,
  } = props;

  const submitMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!canStopCurrentTurn) void handleSend();
  };

  return (
    <div className={embedded ? "agent-chat-shell embedded-view" : "agent-chat-shell"}>
      <main ref={layoutRef} className="agent-chat-layout">
        <aside className="agent-chat-conversations" aria-label="重组会话列表">
          <div className="agent-chat-conversation-head">
            <div>
              <div className="section-heading">重组会话</div>
              <small>{conversations.length} active</small>
            </div>
            <button className="primary-button agent-chat-action" type="button" onClick={startNewConversation}>新建</button>
          </div>
          <div className="agent-chat-conversation-list">
            {conversations.length ? conversations.map((conversation) => (
              <button
                key={conversation.conversationId}
                className={`agent-chat-conversation-item ${conversation.conversationId === activeConversationId ? "active" : ""}`}
                type="button"
                onClick={() => void handleResumeConversation(conversation.conversationId)}
              >
                <strong>{conversation.title || shortId(conversation.threadId ?? conversation.conversationId)}</strong>
                <span>{shortId(conversation.threadId ?? "未绑定")} · {conversation.latestTurnId ? shortId(conversation.latestTurnId) : "无 turn"}</span>
              </button>
            )) : <div className="empty-state"><strong>暂无会话</strong><span>发送消息后会自动保存</span></div>}
          </div>
          <button className="ghost-button agent-chat-archive-button" type="button" disabled={!activeConversationId} onClick={() => void handleArchiveConversation()}>
            归档当前会话
          </button>
        </aside>
        <SplitResizeHandle className="workspace-resize-handle agent-chat-resizer agent-chat-left-resizer" label="调整重组会话列表宽度" orientation="vertical" onResizeStart={(event) => layout.startResize("left", event)} onReset={() => layout.resetSize("left")} onNudge={(direction) => layout.nudgeSize("left", direction)} />
        <section className="agent-chat-main" aria-label="Agent 对话">
          <header className="agent-chat-toolbar">
            <div className="agent-chat-title">
              <div className="section-heading">Agent 对话</div>
              <small>{statusText}</small>
            </div>
            <div className="agent-chat-controls">
              <div className="agent-chat-session-meta" aria-label="当前会话状态">
                <span>thread {shortId(session?.threadId ?? "未连接")}</span>
                <span>turn {shortId(currentTurnId ?? "等待")}</span>
                <span>trace {shortId(session?.traceId ?? "等待")}</span>
                <span>rev {activeConversationRevision ?? "-"}</span>
                <ContextUsageIndicator usage={contextUsage} />
              </div>
              <select value={mode} disabled={busy || Boolean(session)} onChange={(event) => setMode(event.target.value as ChatMode)}>
                <option value="direct">普通对话</option>
                <option value="threadpool-role">ThreadPool Role Fork</option>
              </select>
              {mode === "threadpool-role" ? (
                <select value={selectedRole} disabled={busy || Boolean(session)} onChange={(event) => setSelectedRole(event.target.value)}>
                  {roles.map((role) => <option key={role.role} value={role.role}>{role.role}</option>)}
                </select>
              ) : null}
              {session?.role === "function-slot-restructure" || session?.role === "function-slot-shot-design" ? (
                <button className="ghost-button agent-chat-action" type="button" disabled={!canReviewDialogue} onClick={() => void handleDialogueReview()} title={currentShotDesignFinalPath ? "审查当前 shot-design.final.md 台词自然度" : "需要当前对话里有 shot-design.final.md 路径"}>
                  {reviewingDialogue ? "审查中" : "审查台词"}
                </button>
              ) : null}
              {session?.role === "function-slot-restructure" ? (
                <>
                  <button className="ghost-button agent-chat-action" type="button" disabled={!canRegisterPlanTrace} onClick={() => void handleRegisterPlanTrace()} title={canRegisterPlanTrace ? "预览当前方案溯源图" : "需要当前方案已自动生成 restructure.display.json"}>
                    {registeringTrace ? "预览中" : "进入溯源图"}
                  </button>
                  <button className="primary-button agent-chat-action" type="button" disabled={!canConfirmRestructure} onClick={() => void handleConfirmRestructure()}>
                    {confirming ? "确认中" : activeConversationConfirmedPlan?.turnId === currentTurnId ? "重新确认" : "确认此方案"}
                  </button>
                </>
              ) : null}
              {session?.leaseId ? <button className="ghost-button agent-chat-action" type="button" disabled={busy} onClick={handleRelease}>释放</button> : null}
            </div>
          </header>
          <div className="agent-chat-conversation-bar">
            <span>{activeConversationId ? `当前会话 ${shortId(activeConversationId)}` : "新会话"}</span>
            {session?.role ? <span>role {session.role}</span> : null}
            {activeConversationInvalidated ? <span className="agent-chat-state-badge danger">thread 失效</span> : null}
            {threadStopped ? <span className="agent-chat-state-badge danger">thread 已停止</span> : null}
            {activeConversationConfirmedPlan ? <span className="agent-chat-state-badge success">方案已确认</span> : null}
          </div>
          <div className="agent-chat-messages">
            {messages.length ? messages.map((message) => (
              <article key={message.id} className={`agent-chat-message ${message.role} ${message.status ?? ""}`}>
                <b>{message.role === "user" ? "User" : message.role === "assistant" ? "Agent" : "System"}</b>
                <p>{message.text}</p>
                {message.dialogueRoboticReview ? <DialogueReviewSummary review={message.dialogueRoboticReview} canRework={message.dialogueRoboticReview === activeDialogueReview && canReworkDialogue} reworking={dialogueReworking} onRework={handleDialogueRework} /> : null}
              </article>
            )) : <div className="empty-state"><strong>还没有对话</strong><span>输入一条消息后会通过 app-server 发送</span></div>}
          </div>
          {errorText ? <div className="agent-chat-error">{errorText}</div> : null}
          <form className="agent-chat-composer" onSubmit={submitMessage}>
            <textarea
              value={draft}
              rows={3}
              placeholder="输入要发给 Agent 的消息"
              disabled={composerLocked}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.ctrlKey) return;
                event.preventDefault();
                if (!composerLocked) void handleSend();
              }}
            />
            {canStopCurrentTurn ? (
              <button className="ghost-button agent-chat-stop-button" type="button" disabled={Boolean(turnActionBusy)} onClick={() => void handleStopTurn()}>
                {turnActionBusy === "stop_turn" ? "停止中" : "停止 Turn"}
              </button>
            ) : (
              <button className="primary-button" type="submit" disabled={composerLocked || !draft.trim() || (mode === "threadpool-role" && !selectedRole)}>
                {compacting ? "正在压缩上下文..." : reviewingDialogue ? "审查中" : dialogueReworking ? "返工中" : "发送"}
              </button>
            )}
          </form>
        </section>
        <SplitResizeHandle className="workspace-resize-handle agent-chat-resizer agent-chat-right-resizer" label="调整 Timeline 宽度" orientation="vertical" onResizeStart={(event) => layout.startResize("right", event)} onReset={() => layout.resetSize("right")} onNudge={(direction) => layout.nudgeSize("right", direction)} />
        <aside className="agent-chat-timeline" aria-label="Agent timeline">
          <div className="agent-chat-side-tabs" role="tablist" aria-label="右侧信息面板">
            <button className={rightPanelTab === "timeline" ? "active" : ""} type="button" role="tab" aria-selected={rightPanelTab === "timeline"} onClick={() => setRightPanelTab("timeline")}>Timeline</button>
            <button className={rightPanelTab === "slotAtom" ? "active" : ""} type="button" role="tab" aria-selected={rightPanelTab === "slotAtom"} onClick={() => setRightPanelTab("slotAtom")}>Slot/Atom</button>
          </div>
          {rightPanelTab === "timeline" ? <TimelineView timeline={timeline} /> : (
            <SlotAtomView display={activeSlotAtomDisplay} busy={busy} sourceRestructureFinalPath={currentRestructureFinalPath} sourceTurnId={currentTurnId} onSubmitReplacement={handleManualReplacementSubmit} />
          )}
        </aside>
      </main>
    </div>
  );
}
