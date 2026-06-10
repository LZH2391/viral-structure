import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentChatConversation, AgentChatMessageSnapshot, AgentTurnTimeline } from "../../types";
import { RestructureWorkspaceChat } from "./RestructureWorkspaceChat";
import { RestructureWorkspaceComposer, buildRestructureSendContext } from "./RestructureWorkspaceComposer";
import { buildRestructureMessageRenderItems } from "./restructureWorkspaceMessageModel";
import { usePseudoStreamedAssistantMessages, usePseudoStreamedProcessMessages, usePseudoStreamedTimelineAgentMessages } from "./restructureWorkspacePseudoStream";
import { hasConversationStoryboardResultForConfirmedPlan, resolveActiveStoryboardConfirmation, resolveConfirmedPlanStatusDisplay } from "./restructureWorkspaceStoryboard";
import { buildRestructureTimelineDisplayItems, useRestructureTurnTimeline } from "./RestructureWorkspaceTimeline";
import type { NewUiMaterialPackOption, NewUiPendingStoryboardConfirmation, NewUiRestructureSendContext, NewUiStructureOption, NewUiTurnTimelineTarget, RestructureTimelineDisplayItem } from "./restructureWorkspaceTypes";
import { hasRealUserMessageForPending, isThinkingStatus, normalizeTimelineText, resolveContextUsageFallbackTarget, resolveRestructureTitle, resolveSendErrorMessage, useLastKnownContextUsage } from "./restructureWorkspaceUtils";

type NewUiRestructureWorkspaceProps = {
  conversation: AgentChatConversation | null;
  creatingConversation: boolean;
  draftingConversation: boolean;
  loadingConversations?: boolean;
  compactingContext?: boolean;
  stoppingTurn?: boolean;
  onNewConversation: () => void;
  onContextUsageChange?: (usage: AgentTurnTimeline["activity"]["tokenUsage"] | null) => void;
  onSendMessage: (message: string, context?: NewUiRestructureSendContext) => Promise<void>;
  materialPackOptions?: NewUiMaterialPackOption[];
  structureOptions?: NewUiStructureOption[];
  selectedMaterialPack?: NewUiMaterialPackOption | null;
  onSelectedMaterialPackChange?: (option: NewUiMaterialPackOption | null) => void;
  loadingMaterialPackOptions?: boolean;
  uploadingMaterial?: boolean;
  loadingStructureOptions?: boolean;
  onRefreshMaterialPackOptions?: () => Promise<void> | void;
  onRefreshStructureOptions?: () => Promise<void> | void;
  onOpenMaterialUpload?: () => void;
  onOpenMaterialPackDetail?: (option: NewUiMaterialPackOption) => void;
  onStopTurn?: () => Promise<void> | void;
  onOpenPlanTrace?: (message: AgentChatMessageSnapshot) => Promise<void> | void;
  onConfirmPlan?: (message: AgentChatMessageSnapshot) => Promise<void> | void;
  onAutoAdvanceToggle?: (enabled: boolean) => void;
  activeTurnTarget?: NewUiTurnTimelineTarget | null;
  pendingAssistantMessage?: AgentChatMessageSnapshot | null;
  pendingUserMessage?: AgentChatMessageSnapshot | null;
  sendErrorMessage?: string | null;
  sendingMessage: boolean;
  autoAdvanceEnabled?: boolean;
  autoAdvanceBusy?: boolean;
  openingPlanTraceMessageId?: string | null;
  confirmingPlanMessageId?: string | null;
  pendingStoryboardConfirmation?: NewUiPendingStoryboardConfirmation | null;
};

export type { NewUiMaterialPackOption, NewUiPendingStoryboardConfirmation, NewUiRestructureSendContext, NewUiStructureOption, NewUiTurnTimelineTarget } from "./restructureWorkspaceTypes";

export function NewUiRestructureWorkspace({
  conversation,
  creatingConversation,
  draftingConversation,
  loadingConversations = false,
  compactingContext = false,
  stoppingTurn = false,
  onNewConversation,
  onContextUsageChange,
  onSendMessage,
  materialPackOptions = [],
  structureOptions = [],
  selectedMaterialPack: controlledSelectedMaterialPack,
  onSelectedMaterialPackChange,
  loadingMaterialPackOptions = false,
  uploadingMaterial = false,
  loadingStructureOptions = false,
  onRefreshMaterialPackOptions,
  onRefreshStructureOptions,
  onOpenMaterialUpload,
  onOpenMaterialPackDetail,
  onStopTurn,
  onOpenPlanTrace,
  onConfirmPlan,
  onAutoAdvanceToggle,
  activeTurnTarget = null,
  pendingAssistantMessage = null,
  pendingUserMessage = null,
  sendErrorMessage = null,
  sendingMessage,
  autoAdvanceEnabled = false,
  autoAdvanceBusy = false,
  openingPlanTraceMessageId = null,
  confirmingPlanMessageId = null,
  pendingStoryboardConfirmation = null,
}: NewUiRestructureWorkspaceProps) {
  const messages = conversation?.messages ?? [];
  const displayTitle = resolveRestructureTitle(conversation?.title);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [activeAttachmentPanel, setActiveAttachmentPanel] = useState<"material" | "structure" | null>(null);
  const [uncontrolledSelectedMaterialPack, setUncontrolledSelectedMaterialPack] = useState<NewUiMaterialPackOption | null>(null);
  const [selectedStructure, setSelectedStructure] = useState<NewUiStructureOption | null>(null);
  const [expandedMaterialGapMatrixByMessageId, setExpandedMaterialGapMatrixByMessageId] = useState<Record<string, boolean>>({});
  const [timelineActivityExpandedByScope, setTimelineActivityExpandedByScope] = useState<Record<string, boolean>>({});
  const [processMessageExpandedByScope, setProcessMessageExpandedByScope] = useState<Record<string, boolean>>({});
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const timeline = useRestructureTurnTimeline(activeTurnTarget);
  const contextUsageFallbackTarget = resolveContextUsageFallbackTarget(conversation, activeTurnTarget);
  const contextUsageFallbackTimeline = useRestructureTurnTimeline(contextUsageFallbackTarget);
  const rawContextUsage = conversation ? timeline?.activity?.tokenUsage ?? contextUsageFallbackTimeline?.activity?.tokenUsage ?? null : null;
  const confirmedPlanStatusDisplay = resolveConfirmedPlanStatusDisplay(conversation?.confirmedPlan?.status);
  const activeStoryboardConfirmation = resolveActiveStoryboardConfirmation(conversation, pendingStoryboardConfirmation);
  const hasStoryboardResultForConfirmedPlan = hasConversationStoryboardResultForConfirmedPlan(conversation);
  const contextUsageScopeKey = conversation?.conversationId ?? conversation?.threadId ?? null;
  const contextUsage = useLastKnownContextUsage(rawContextUsage, contextUsageScopeKey);
  const canStopTurn = Boolean(activeTurnTarget?.running && activeTurnTarget.threadId && activeTurnTarget.turnId && !stoppingTurn);
  const materialPackSelectionControlled = controlledSelectedMaterialPack !== undefined;
  const selectedMaterialPack = controlledSelectedMaterialPack !== undefined ? controlledSelectedMaterialPack : uncontrolledSelectedMaterialPack;
  const setSelectedMaterialPack = onSelectedMaterialPackChange ?? setUncontrolledSelectedMaterialPack;
  const rawTimelineDisplayItems = buildRestructureTimelineDisplayItems(timeline?.items ?? []);
  const timelineTurnId = activeTurnTarget?.turnId && rawTimelineDisplayItems.length ? activeTurnTarget.turnId : null;
  const timelineConversationAssistantMessage = timelineTurnId
    ? messages.find((message) => message.role === "assistant" && message.turnId === timelineTurnId) ?? null
    : null;
  const timelineFinalMessageText = timelineConversationAssistantMessage && !isThinkingStatus(timelineConversationAssistantMessage.status)
    ? normalizeTimelineText(timelineConversationAssistantMessage.text)
    : null;
  const timelineDisplayItems = timelineFinalMessageText
    ? rawTimelineDisplayItems.filter((item) => (
        item.kind !== "agent_message"
        || normalizeTimelineText(item.text) !== timelineFinalMessageText
      ))
    : rawTimelineDisplayItems;
  const compactingTimelineItems = useMemo<RestructureTimelineDisplayItem[]>(() => (
    compactingContext
      ? [{
          id: "new-ui-restructure-context-compacting",
          sourceKey: "new-ui-restructure-context-compacting",
          kind: "context_compacting",
          label: "Compacting",
          detail: "正在压缩上下文",
          status: "running",
        }]
      : []
  ), [compactingContext]);
  const timelineInsertMessageId = timelineConversationAssistantMessage?.id ?? null;
  const timelineItemsAfterMessages = timelineInsertMessageId ? [] : timelineDisplayItems;
  const timelineHasAgentMessages = rawTimelineDisplayItems.some((item) => item.kind === "agent_message");
  const timelineScopeKey = timelineTurnId ? `${timeline?.threadId ?? activeTurnTarget?.threadId ?? ""}:${timelineTurnId}` : null;
  const timelineTurnHasFinalMessage = Boolean(timelineConversationAssistantMessage && !isThinkingStatus(timelineConversationAssistantMessage.status));
  const timelineActivityDefaultExpanded = Boolean(timelineTurnId && !timelineTurnHasFinalMessage);
  const timelineActivityExpanded = timelineScopeKey ? timelineActivityExpandedByScope[timelineScopeKey] ?? timelineActivityDefaultExpanded : false;
  const messageRenderItems = useMemo(
    () => buildRestructureMessageRenderItems(
      messages,
      timelineTurnId && timelineDisplayItems.length ? timelineTurnId : null,
    ),
    [messages, timelineTurnId, timelineDisplayItems.length],
  );
  const visiblePendingUserMessage = pendingUserMessage && !hasRealUserMessageForPending(pendingUserMessage, messages)
    ? pendingUserMessage
    : null;
  const visiblePendingAssistantMessage = pendingAssistantMessage && !messages.some((message) => (
    message.role === "assistant"
    && (
      (pendingAssistantMessage.turnId && message.turnId === pendingAssistantMessage.turnId)
      || message.id === pendingAssistantMessage.id
    )
  ))
    ? pendingAssistantMessage
    : null;
  const canUseComposer = Boolean(conversation?.threadId || draftingConversation);
  const canSend = Boolean(canUseComposer && draft.trim() && !sendingMessage && !creatingConversation);
  const visibleSendError = sendErrorMessage ?? sendError;
  const pseudoStreamMessages = useMemo(
    () => [
      ...messages,
      visiblePendingUserMessage,
      visiblePendingAssistantMessage,
    ].filter((message): message is AgentChatMessageSnapshot => Boolean(message)),
    [messages, visiblePendingUserMessage, visiblePendingAssistantMessage],
  );
  const { isPseudoStreaming, getDisplayText } = usePseudoStreamedAssistantMessages(
    conversation?.conversationId ?? visiblePendingUserMessage?.id ?? visiblePendingAssistantMessage?.id ?? null,
    pseudoStreamMessages,
    {
      activeTurnId: activeTurnTarget?.turnId ?? null,
      pendingAssistantId: pendingAssistantMessage?.id ?? null,
      pendingAssistantTurnId: pendingAssistantMessage?.turnId ?? null,
      pendingSpecialUserId: pendingUserMessage?.userInputOrigin ? pendingUserMessage.id : null,
      pendingSpecialUserTurnId: pendingUserMessage?.userInputOrigin ? pendingUserMessage.turnId ?? null : null,
    },
  );
  const {
    isPseudoStreaming: isTimelinePseudoStreaming,
    getDisplayText: getTimelineDisplayText,
  } = usePseudoStreamedTimelineAgentMessages(
    timelineTurnId ? `${timeline?.threadId ?? ""}:${timelineTurnId}` : null,
    timelineDisplayItems,
    Boolean(activeTurnTarget?.running),
  );
  const processMessages = useMemo(
    () => messageRenderItems.flatMap((item) => item.kind === "process_group" ? item.messages : []),
    [messageRenderItems],
  );
  const {
    isPseudoStreaming: isProcessPseudoStreaming,
    getDisplayText: getProcessDisplayText,
  } = usePseudoStreamedProcessMessages(
    conversation?.conversationId ?? null,
    processMessages,
    Boolean(activeTurnTarget?.running),
    {
      activeTurnId: activeTurnTarget?.turnId ?? null,
      pendingAssistantId: pendingAssistantMessage?.id ?? null,
      pendingAssistantTurnId: pendingAssistantMessage?.turnId ?? null,
      pendingSpecialUserId: pendingUserMessage?.userInputOrigin ? pendingUserMessage.id : null,
      pendingSpecialUserTurnId: pendingUserMessage?.userInputOrigin ? pendingUserMessage.turnId ?? null : null,
    },
  );

  useEffect(() => {
    setSendError(null);
    setActiveAttachmentPanel(null);
    if (!materialPackSelectionControlled) {
      setUncontrolledSelectedMaterialPack((current) => current?.pending ? current : null);
    }
    setSelectedStructure(null);
    setTimelineActivityExpandedByScope({});
    setProcessMessageExpandedByScope({});
    shouldStickToBottomRef.current = true;
  }, [conversation?.conversationId, draftingConversation, materialPackSelectionControlled]);

  useEffect(() => {
    onContextUsageChange?.(contextUsage);
  }, [contextUsage, onContextUsageChange]);

  useLayoutEffect(() => {
    if (!shouldStickToBottomRef.current) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      if (!list) return;
      list.scrollTop = list.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [
    conversation?.conversationId,
    draftingConversation,
    messages.length,
    messages[messages.length - 1]?.id,
    messages[messages.length - 1]?.text,
    messages[messages.length - 1]?.status,
    visiblePendingUserMessage?.id,
    visiblePendingAssistantMessage?.id,
    timelineDisplayItems.length,
    timelineDisplayItems[timelineDisplayItems.length - 1]?.id,
    timelineDisplayItems[timelineDisplayItems.length - 1]?.status,
  ]);

  const submitDraft = async () => {
    if (!canSend) return;
    const message = draft.trim();
    const sendContext = buildRestructureSendContext(selectedMaterialPack, selectedStructure);
    setSendError(null);
    setDraft("");
    setActiveAttachmentPanel(null);
    setSelectedMaterialPack(selectedMaterialPack?.pending ? selectedMaterialPack : null);
    setSelectedStructure(null);
    shouldStickToBottomRef.current = true;
    try {
      await onSendMessage(message, sendContext);
    } catch (error) {
      setDraft(message);
      setSelectedMaterialPack(selectedMaterialPack);
      setSelectedStructure(selectedStructure);
      setSendError(resolveSendErrorMessage(error));
    }
  };

  const composer = (
    <RestructureWorkspaceComposer
      draft={draft}
      setDraft={setDraft}
      sendError={sendError}
      setSendError={setSendError}
      visibleSendError={visibleSendError}
      activeAttachmentPanel={activeAttachmentPanel}
      setActiveAttachmentPanel={setActiveAttachmentPanel}
      selectedMaterialPack={selectedMaterialPack}
      setSelectedMaterialPack={setSelectedMaterialPack}
      selectedStructure={selectedStructure}
      setSelectedStructure={setSelectedStructure}
      materialPackOptions={materialPackOptions}
      structureOptions={structureOptions}
      loadingMaterialPackOptions={loadingMaterialPackOptions}
      uploadingMaterial={uploadingMaterial}
      loadingStructureOptions={loadingStructureOptions}
      onRefreshMaterialPackOptions={onRefreshMaterialPackOptions}
      onRefreshStructureOptions={onRefreshStructureOptions}
      onOpenMaterialUpload={onOpenMaterialUpload}
      onOpenMaterialPackDetail={onOpenMaterialPackDetail}
      onAutoAdvanceToggle={onAutoAdvanceToggle}
      autoAdvanceEnabled={autoAdvanceEnabled}
      autoAdvanceBusy={autoAdvanceBusy}
      contextUsage={contextUsage}
      onStopTurn={onStopTurn}
      activeTurnTarget={activeTurnTarget}
      stoppingTurn={stoppingTurn}
      canStopTurn={canStopTurn}
      canUseComposer={canUseComposer}
      canSend={canSend}
      sendingMessage={sendingMessage}
      creatingConversation={creatingConversation}
      onSubmitDraft={submitDraft}
    />
  );
  const activeTurnRunning = Boolean(activeTurnTarget?.running);
  const handleToggleTimelineActivity = () => {
    if (!timelineScopeKey) return;
    setTimelineActivityExpandedByScope((current) => ({
      ...current,
      [timelineScopeKey]: !(current[timelineScopeKey] ?? timelineActivityDefaultExpanded),
    }));
  };

  return (
    <RestructureWorkspaceChat
      loadingConversations={loadingConversations}
      conversation={conversation}
      draftingConversation={draftingConversation}
      sendingMessage={sendingMessage}
      creatingConversation={creatingConversation}
      visiblePendingUserMessage={visiblePendingUserMessage}
      visiblePendingAssistantMessage={visiblePendingAssistantMessage}
      visibleSendError={visibleSendError}
      composer={composer}
      messageListRef={messageListRef}
      shouldStickToBottomRef={shouldStickToBottomRef}
      compactingTimelineItems={compactingTimelineItems}
      displayTitle={displayTitle}
      onNewConversation={onNewConversation}
      confirmedPlanStatusDisplay={confirmedPlanStatusDisplay}
      messages={messages}
      timelineDisplayItems={timelineDisplayItems}
      timelineItemsAfterMessages={timelineItemsAfterMessages}
      timelineInsertMessageId={timelineInsertMessageId}
      timelineScopeKey={timelineScopeKey}
      timelineActivityExpanded={timelineActivityExpanded}
      activeTurnRunning={activeTurnRunning}
      timelineHasAgentMessages={timelineHasAgentMessages}
      timelineTurnId={timelineTurnId}
      messageRenderItems={messageRenderItems}
      processMessageExpandedByScope={processMessageExpandedByScope}
      setProcessMessageExpandedByScope={setProcessMessageExpandedByScope}
      expandedMaterialGapMatrixByMessageId={expandedMaterialGapMatrixByMessageId}
      setExpandedMaterialGapMatrixByMessageId={setExpandedMaterialGapMatrixByMessageId}
      activeStoryboardConfirmation={activeStoryboardConfirmation}
      hasStoryboardResultForConfirmedPlan={hasStoryboardResultForConfirmedPlan}
      onOpenPlanTrace={onOpenPlanTrace}
      onConfirmPlan={onConfirmPlan}
      openingPlanTraceMessageId={openingPlanTraceMessageId}
      confirmingPlanMessageId={confirmingPlanMessageId}
      getDisplayText={getDisplayText}
      isPseudoStreaming={isPseudoStreaming}
      getTimelineDisplayText={getTimelineDisplayText}
      isTimelinePseudoStreaming={isTimelinePseudoStreaming}
      getProcessDisplayText={getProcessDisplayText}
      isProcessPseudoStreaming={isProcessPseudoStreaming}
      onToggleTimelineActivity={handleToggleTimelineActivity}
    />
  );
}
