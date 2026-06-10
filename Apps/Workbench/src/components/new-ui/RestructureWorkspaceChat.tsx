import { Fragment, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from "react";
import type { AgentChatConversation, AgentChatMessageSnapshot } from "../../types";
import { MaterialGapMatrixViewer } from "./MaterialGapMatrixViewer";
import { StoryboardResultViewer } from "./StoryboardResultViewer";
import { NewConversationGlyph, RestructureTimelineIcon } from "./RestructureWorkspaceGlyphs";
import { RestructureMessage, RestructureMessageWithStoryboardState, RestructureProcessMessageGroup, RestructureProcessMessageItem } from "./RestructureWorkspaceMessages";
import { RestructureSendErrorAlert } from "./RestructureWorkspaceComposer";
import { hasTerminalAssistantMessageForProcessGroup, shouldInsertTimelineBeforeRenderItem, shouldRenderConversationMessage } from "./restructureWorkspaceMessageModel";
import { resolveStoryboardResultStatusLabel, shouldShowStoryboardResultMessage } from "./restructureWorkspaceStoryboard";
import type { ConfirmedPlanStatusDisplay, NewUiPendingStoryboardConfirmation, RestructureMessageRenderItem, RestructureTimelineDisplayItem } from "./restructureWorkspaceTypes";
import { isNearScrollBottom } from "./restructureWorkspaceUtils";
import { RestructureTimelineItemGroup } from "./RestructureWorkspaceTimeline";

export function RestructureWorkspaceChat(props: RestructureWorkspaceChatProps) {
  const { loadingConversations, conversation, draftingConversation, sendingMessage, creatingConversation, visiblePendingUserMessage, visiblePendingAssistantMessage, visibleSendError, composer, messageListRef, shouldStickToBottomRef, compactingTimelineItems, displayTitle, onNewConversation, confirmedPlanStatusDisplay, messages, timelineDisplayItems, timelineItemsAfterMessages, timelineInsertMessageId, timelineScopeKey, timelineActivityExpanded, activeTurnRunning, timelineHasAgentMessages, timelineTurnId, messageRenderItems, processMessageExpandedByScope, setProcessMessageExpandedByScope, expandedMaterialGapMatrixByMessageId, setExpandedMaterialGapMatrixByMessageId, activeStoryboardConfirmation, hasStoryboardResultForConfirmedPlan, onOpenPlanTrace, onConfirmPlan, openingPlanTraceMessageId, confirmingPlanMessageId, getDisplayText, isPseudoStreaming, getTimelineDisplayText, isTimelinePseudoStreaming, getProcessDisplayText, isProcessPseudoStreaming, onToggleTimelineActivity } = props;
  const errorAlert = visibleSendError ? <RestructureSendErrorAlert message={visibleSendError} /> : null;
  if (loadingConversations && !conversation && !draftingConversation && !sendingMessage && !creatingConversation) {
    return <section className="new-ui-restructure-workspace is-loading" aria-label="重组工作区加载中"><div className="new-ui-restructure-loading"><span /><span /><span /></div></section>;
  }
  if (!conversation && (visiblePendingUserMessage || visiblePendingAssistantMessage)) {
    return (
      <section className="new-ui-restructure-workspace" aria-label="重组工作区">
        <header className="new-ui-restructure-header"><div className="new-ui-restructure-title-block"><h1>重组</h1></div></header>
        <div className="new-ui-restructure-shell"><main className="new-ui-restructure-chat" aria-label="重组对话">
          {errorAlert}
          <div ref={messageListRef} className="new-ui-restructure-message-list" onScroll={(event) => { shouldStickToBottomRef.current = isNearScrollBottom(event.currentTarget); }}>
            {visiblePendingUserMessage ? <RestructureMessage message={visiblePendingUserMessage} displayText={getDisplayText(visiblePendingUserMessage)} pseudoStreaming={isPseudoStreaming(visiblePendingUserMessage)} /> : null}
            <RestructureTimelineItemGroup items={compactingTimelineItems} scopeKey="context-compacting" expanded running getDisplayText={getTimelineDisplayText} isPseudoStreaming={() => false} onToggle={() => undefined} />
            {visiblePendingAssistantMessage ? <RestructureMessage message={visiblePendingAssistantMessage} displayText={getDisplayText(visiblePendingAssistantMessage)} pseudoStreaming={isPseudoStreaming(visiblePendingAssistantMessage)} /> : null}
          </div>
          {composer}
        </main></div>
      </section>
    );
  }
  if (!conversation && (draftingConversation || sendingMessage || creatingConversation)) {
    return <section className="new-ui-restructure-workspace is-draft" aria-label="新建重组对话"><main className="new-ui-restructure-draft"><div className="new-ui-restructure-draft-stack">{errorAlert}<h1>给一个主题，或者直接告诉我你想做什么。</h1>{composer}</div></main></section>;
  }
  if (!conversation) {
    return <section className="new-ui-restructure-workspace is-empty" aria-label="重组工作区"><div className="new-ui-restructure-empty"><div><h1>重组会话</h1><p>选择左侧会话，或创建一个新的结构重组对话。</p></div><button className="new-ui-restructure-primary" type="button" disabled={creatingConversation} onClick={onNewConversation}><NewConversationGlyph /><span>{creatingConversation ? "创建中" : "新会话"}</span></button></div></section>;
  }
  return (
    <section className="new-ui-restructure-workspace" aria-label="重组工作区">
      <header className="new-ui-restructure-header"><div className="new-ui-restructure-title-block"><h1 data-tooltip={displayTitle}>{displayTitle}</h1></div></header>
      <div className="new-ui-restructure-shell"><main className="new-ui-restructure-chat" aria-label="重组对话">
        {errorAlert}
        {messages.length || timelineDisplayItems.length || visiblePendingUserMessage || visiblePendingAssistantMessage ? (
          <>
            <div ref={messageListRef} className="new-ui-restructure-message-list" onScroll={(event) => { shouldStickToBottomRef.current = isNearScrollBottom(event.currentTarget); }}>
              {confirmedPlanStatusDisplay ? <ConfirmedPlanStatusActivity display={confirmedPlanStatusDisplay} /> : null}
              {messageRenderItems.map((renderItem) => (
                <Fragment key={renderItem.kind === "message" ? renderItem.message.id : renderItem.id}>
                  {shouldInsertTimelineBeforeRenderItem(renderItem, timelineInsertMessageId) ? <RestructureTimelineItemGroup items={timelineDisplayItems} scopeKey={timelineScopeKey} expanded={timelineActivityExpanded} running={activeTurnRunning} getDisplayText={getTimelineDisplayText} isPseudoStreaming={isTimelinePseudoStreaming} onToggle={onToggleTimelineActivity} /> : null}
                  <RenderConversationItem renderItem={renderItem} messages={messages} conversation={conversation} processMessageExpandedByScope={processMessageExpandedByScope} setProcessMessageExpandedByScope={setProcessMessageExpandedByScope} expandedMaterialGapMatrixByMessageId={expandedMaterialGapMatrixByMessageId} setExpandedMaterialGapMatrixByMessageId={setExpandedMaterialGapMatrixByMessageId} activeStoryboardConfirmation={activeStoryboardConfirmation} hasStoryboardResultForConfirmedPlan={hasStoryboardResultForConfirmedPlan} timelineTurnId={timelineTurnId} timelineHasAgentMessages={timelineHasAgentMessages} sendingMessage={sendingMessage} onOpenPlanTrace={onOpenPlanTrace} onConfirmPlan={onConfirmPlan} openingPlanTraceMessageId={openingPlanTraceMessageId} confirmingPlanMessageId={confirmingPlanMessageId} getDisplayText={getDisplayText} isPseudoStreaming={isPseudoStreaming} getProcessDisplayText={getProcessDisplayText} isProcessPseudoStreaming={isProcessPseudoStreaming} />
                </Fragment>
              ))}
              <RestructureTimelineItemGroup items={timelineItemsAfterMessages} scopeKey={timelineScopeKey} expanded={timelineActivityExpanded} running={activeTurnRunning} getDisplayText={getTimelineDisplayText} isPseudoStreaming={isTimelinePseudoStreaming} onToggle={onToggleTimelineActivity} />
              {visiblePendingUserMessage ? <RestructureMessage message={visiblePendingUserMessage} displayText={getDisplayText(visiblePendingUserMessage)} pseudoStreaming={isPseudoStreaming(visiblePendingUserMessage)} /> : null}
              {visiblePendingAssistantMessage ? <RestructureMessage message={visiblePendingAssistantMessage} displayText={getDisplayText(visiblePendingAssistantMessage)} pseudoStreaming={isPseudoStreaming(visiblePendingAssistantMessage)} /> : null}
            </div>
            {composer}
          </>
        ) : <div className="new-ui-restructure-empty-chat-stack"><div className="new-ui-restructure-thread-empty"><h2>给一个主题，或者直接告诉我你想做什么。</h2></div>{composer}</div>}
      </main></div>
    </section>
  );
}

type RestructureWorkspaceChatProps = {
  loadingConversations: boolean; conversation: AgentChatConversation | null; draftingConversation: boolean; sendingMessage: boolean; creatingConversation: boolean;
  visiblePendingUserMessage: AgentChatMessageSnapshot | null; visiblePendingAssistantMessage: AgentChatMessageSnapshot | null; visibleSendError: string | null; composer: ReactNode;
  messageListRef: MutableRefObject<HTMLDivElement | null>; shouldStickToBottomRef: MutableRefObject<boolean>; compactingTimelineItems: RestructureTimelineDisplayItem[]; displayTitle: string; onNewConversation: () => void;
  confirmedPlanStatusDisplay: ConfirmedPlanStatusDisplay | null; messages: AgentChatMessageSnapshot[]; timelineDisplayItems: RestructureTimelineDisplayItem[]; timelineItemsAfterMessages: RestructureTimelineDisplayItem[]; timelineInsertMessageId: string | null; timelineScopeKey: string | null; timelineActivityExpanded: boolean; activeTurnRunning: boolean; timelineHasAgentMessages: boolean; timelineTurnId: string | null; messageRenderItems: RestructureMessageRenderItem[];
  processMessageExpandedByScope: Record<string, boolean>; setProcessMessageExpandedByScope: Dispatch<SetStateAction<Record<string, boolean>>>; expandedMaterialGapMatrixByMessageId: Record<string, boolean>; setExpandedMaterialGapMatrixByMessageId: Dispatch<SetStateAction<Record<string, boolean>>>;
  activeStoryboardConfirmation: NewUiPendingStoryboardConfirmation | null; hasStoryboardResultForConfirmedPlan: boolean; onOpenPlanTrace?: (message: AgentChatMessageSnapshot) => Promise<void> | void; onConfirmPlan?: (message: AgentChatMessageSnapshot) => Promise<void> | void; openingPlanTraceMessageId: string | null; confirmingPlanMessageId: string | null;
  getDisplayText: (message: AgentChatMessageSnapshot) => string; isPseudoStreaming: (message: AgentChatMessageSnapshot) => boolean; getTimelineDisplayText: (item: RestructureTimelineDisplayItem) => string; isTimelinePseudoStreaming: (item: RestructureTimelineDisplayItem) => boolean; getProcessDisplayText: (message: AgentChatMessageSnapshot) => string; isProcessPseudoStreaming: (message: AgentChatMessageSnapshot) => boolean; onToggleTimelineActivity: () => void;
};

function RenderConversationItem(props: RenderConversationItemProps) {
  const { renderItem, messages, conversation, processMessageExpandedByScope, setProcessMessageExpandedByScope, expandedMaterialGapMatrixByMessageId, setExpandedMaterialGapMatrixByMessageId, activeStoryboardConfirmation, hasStoryboardResultForConfirmedPlan, timelineTurnId, timelineHasAgentMessages, sendingMessage, onOpenPlanTrace, onConfirmPlan, openingPlanTraceMessageId, confirmingPlanMessageId, getDisplayText, isPseudoStreaming, getProcessDisplayText, isProcessPseudoStreaming } = props;
  if (renderItem.kind === "process_group") {
    const defaultExpanded = !hasTerminalAssistantMessageForProcessGroup(renderItem, messages);
    return <RestructureProcessMessageGroup group={renderItem} expanded={processMessageExpandedByScope[renderItem.id] ?? defaultExpanded} getDisplayText={getProcessDisplayText} isPseudoStreaming={isProcessPseudoStreaming} onToggle={() => setProcessMessageExpandedByScope((current) => ({ ...current, [renderItem.id]: !(current[renderItem.id] ?? defaultExpanded) }))} />;
  }
  if (renderItem.message.materialGapMatrix) return <><RestructureProcessMessageItem message={renderItem.message} displayText={getProcessDisplayText(renderItem.message)} pseudoStreaming={isProcessPseudoStreaming(renderItem.message)} /><MaterialGapMatrixViewer matrix={renderItem.message.materialGapMatrix} expanded={expandedMaterialGapMatrixByMessageId[renderItem.message.id] ?? false} onExpandedChange={(expanded) => setExpandedMaterialGapMatrixByMessageId((current) => ({ ...current, [renderItem.message.id]: expanded }))} /></>;
  if (renderItem.message.storyboardResult && conversation.conversationId) return shouldShowStoryboardResultMessage(renderItem.message, conversation, activeStoryboardConfirmation) ? <StoryboardResultViewer conversationId={conversation.conversationId} resultId={renderItem.message.id} statusLabel={resolveStoryboardResultStatusLabel(renderItem.message.storyboardResult.status)} /> : null;
  if (!shouldRenderConversationMessage(renderItem.message, { timelineTurnId, timelineHasAgentMessages })) return null;
  return <RestructureMessageWithStoryboardState message={renderItem.message} displayText={getDisplayText(renderItem.message)} pseudoStreaming={isPseudoStreaming(renderItem.message)} conversation={conversation} onOpenPlanTrace={onOpenPlanTrace} onConfirmPlan={onConfirmPlan} actionsDisabled={sendingMessage} openingPlanTrace={openingPlanTraceMessageId === renderItem.message.id} confirmingPlan={confirmingPlanMessageId === renderItem.message.id} hasStoryboardResultForConfirmedPlan={hasStoryboardResultForConfirmedPlan} pendingStoryboardConfirmation={activeStoryboardConfirmation} />;
}

type RenderConversationItemProps = {
  renderItem: RestructureMessageRenderItem; messages: AgentChatMessageSnapshot[]; conversation: AgentChatConversation; processMessageExpandedByScope: Record<string, boolean>; setProcessMessageExpandedByScope: Dispatch<SetStateAction<Record<string, boolean>>>; expandedMaterialGapMatrixByMessageId: Record<string, boolean>; setExpandedMaterialGapMatrixByMessageId: Dispatch<SetStateAction<Record<string, boolean>>>; activeStoryboardConfirmation: NewUiPendingStoryboardConfirmation | null; hasStoryboardResultForConfirmedPlan: boolean; timelineTurnId: string | null; timelineHasAgentMessages: boolean; sendingMessage: boolean; onOpenPlanTrace?: (message: AgentChatMessageSnapshot) => Promise<void> | void; onConfirmPlan?: (message: AgentChatMessageSnapshot) => Promise<void> | void; openingPlanTraceMessageId: string | null; confirmingPlanMessageId: string | null; getDisplayText: (message: AgentChatMessageSnapshot) => string; isPseudoStreaming: (message: AgentChatMessageSnapshot) => boolean; getProcessDisplayText: (message: AgentChatMessageSnapshot) => string; isProcessPseudoStreaming: (message: AgentChatMessageSnapshot) => boolean;
};

function ConfirmedPlanStatusActivity({ display }: { display: ConfirmedPlanStatusDisplay }) {
  return <article className="new-ui-restructure-activity is-process-message"><span className="new-ui-restructure-activity-icon" aria-hidden="true"><RestructureTimelineIcon kind={display.status === "failed" ? "dialogue_review" : "reasoning"} /></span><p><span>方案状态</span><strong>{display.label}</strong></p></article>;
}
