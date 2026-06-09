import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type FormEvent, type KeyboardEvent, type MutableRefObject, type ReactNode, type SetStateAction } from "react";
import { IconArrowRight, IconAtom } from "@tabler/icons-react";
import { getAgentChatTurnTimeline, type AgentChatMaterialPackRef, type AgentChatStructureRef } from "../../api/client";
import type { AgentChatConversation, AgentChatMessageSnapshot, AgentChatSlotAtomDisplay, AgentTimelineItem, AgentTurnTimeline } from "../../types";
import { formatSecondsCompact, shortId } from "../../utils/format";
import { StoryboardResultViewer } from "./StoryboardResultViewer";

const PSEUDO_STREAM_CHAR_INTERVAL_MS = 15;
const PSEUDO_STREAM_MAX_DURATION_MS = 4000;
const RESTRUCTURE_TIMELINE_SETTLED_POLL_COUNT = 3;

export type NewUiTurnTimelineTarget = {
  threadId?: string | null;
  turnId?: string | null;
  workspaceRoot?: string | null;
  running?: boolean;
  pending?: boolean;
};

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
};

export type NewUiRestructureSendContext = {
  materialPackRef?: AgentChatMaterialPackRef | null;
  structureRef?: AgentChatStructureRef | null;
};

export type NewUiMaterialPackOption = AgentChatMaterialPackRef & {
  coverUrl?: string | null;
  durationSeconds?: number | null;
  updatedAt?: string | null;
};

export type NewUiStructureOption = AgentChatStructureRef & {
  updatedAt?: string | null;
};

type RestructureTimelineActivityItem = {
  id: string;
  sourceKey: string;
  kind: "reasoning" | "context_compacting" | "context_compacted" | "tool_call" | "dialogue_review";
  label: string;
  detail: string | null;
  status: AgentTimelineItem["status"];
};

type RestructureTimelineAgentMessageItem = {
  id: string;
  sourceKey: string;
  kind: "agent_message";
  text: string;
  status: AgentTimelineItem["status"];
};

type RestructureTimelineDisplayItem = RestructureTimelineActivityItem | RestructureTimelineAgentMessageItem;
type RestructureTimelineStreamableItem =
  | (RestructureTimelineActivityItem & { detail: string })
  | RestructureTimelineAgentMessageItem;
type RestructureMessageRenderItem =
  | { kind: "message"; message: AgentChatMessageSnapshot }
  | { kind: "process_group"; id: string; messages: AgentChatMessageSnapshot[] };
type RestructureNotePillTone = "neutral" | "success" | "warning" | "danger";
type RestructureNotePillIcon = "slot" | "atom" | "check" | "review" | "rework" | "issue" | "trace" | "confirm" | "rerun";
type ConfirmedPlanStatusDisplay = { label: string; status: AgentTimelineItem["status"] };

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
}: NewUiRestructureWorkspaceProps) {
  const messages = conversation?.messages ?? [];
  const displayTitle = resolveRestructureTitle(conversation?.title);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [activeAttachmentPanel, setActiveAttachmentPanel] = useState<"material" | "structure" | null>(null);
  const [uncontrolledSelectedMaterialPack, setUncontrolledSelectedMaterialPack] = useState<NewUiMaterialPackOption | null>(null);
  const [selectedStructure, setSelectedStructure] = useState<NewUiStructureOption | null>(null);
  const [timelineActivityExpandedByScope, setTimelineActivityExpandedByScope] = useState<Record<string, boolean>>({});
  const [processMessageExpandedByScope, setProcessMessageExpandedByScope] = useState<Record<string, boolean>>({});
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const timeline = useRestructureTurnTimeline(activeTurnTarget);
  const contextUsageFallbackTarget = resolveContextUsageFallbackTarget(conversation, activeTurnTarget);
  const contextUsageFallbackTimeline = useRestructureTurnTimeline(contextUsageFallbackTarget);
  const rawContextUsage = conversation ? timeline?.activity?.tokenUsage ?? contextUsageFallbackTimeline?.activity?.tokenUsage ?? null : null;
  const confirmedPlanStatusDisplay = resolveConfirmedPlanStatusDisplay(conversation?.confirmedPlan?.status);
  const contextUsageScopeKey = conversation?.conversationId ?? conversation?.threadId ?? null;
  const contextUsage = useLastKnownContextUsage(rawContextUsage, contextUsageScopeKey);
  const canStopTurn = Boolean(activeTurnTarget?.running && activeTurnTarget.threadId && activeTurnTarget.turnId && !stoppingTurn);
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
  );

  useEffect(() => {
    setSendError(null);
    setActiveAttachmentPanel(null);
    setSelectedMaterialPack(null);
    setSelectedStructure(null);
    setTimelineActivityExpandedByScope({});
    setProcessMessageExpandedByScope({});
    shouldStickToBottomRef.current = true;
  }, [conversation?.conversationId, draftingConversation]);

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
    setSelectedMaterialPack(null);
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitDraft();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submitDraft();
  };

  const composer = (
    <form className="new-ui-restructure-composer" aria-label="重组输入区" onSubmit={(event) => void handleSubmit(event)}>
      <div className="new-ui-restructure-composer-field">
        <textarea
          rows={2}
          placeholder="描述目标品类、素材情况、想迁移的结构或要返工的点"
          value={draft}
          disabled={!canUseComposer || sendingMessage || creatingConversation}
          aria-describedby={visibleSendError ? "new-ui-restructure-send-error" : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (sendError) setSendError(null);
          }}
          onKeyDown={handleComposerKeyDown}
        />
        <div className="new-ui-restructure-composer-tools" aria-label="重组输入工具">
          <button
            className={`new-ui-restructure-tool-button ${activeAttachmentPanel === "material" ? "is-active" : ""}`.trim()}
            type="button"
            aria-expanded={activeAttachmentPanel === "material"}
            data-tooltip="选择素材识别包"
            onClick={() => {
              setActiveAttachmentPanel((current) => current === "material" ? null : "material");
              void onRefreshMaterialPackOptions?.();
            }}
          >
            <UploadMaterialGlyph />
            <span>上传素材</span>
          </button>
          <button
            className={`new-ui-restructure-tool-button ${activeAttachmentPanel === "structure" ? "is-active" : ""}`.trim()}
            type="button"
            aria-expanded={activeAttachmentPanel === "structure"}
            data-tooltip="固定一个样例结构"
            onClick={() => {
              setActiveAttachmentPanel((current) => current === "structure" ? null : "structure");
              void onRefreshStructureOptions?.();
            }}
          >
            <ReferenceStructureGlyph />
            <span>引用结构</span>
          </button>
        </div>
        {selectedMaterialPack || selectedStructure ? (
          <div className="new-ui-restructure-composer-attachments" aria-label="已选择的重组上下文">
            {selectedMaterialPack ? (
              <AttachmentChip label="素材包" title={selectedMaterialPack.title || selectedMaterialPack.sampleVideoId} onRemove={() => setSelectedMaterialPack(null)} />
            ) : null}
            {selectedStructure ? (
              <AttachmentChip label="结构" title={selectedStructure.title || selectedStructure.artifactId} onRemove={() => setSelectedStructure(null)} />
            ) : null}
          </div>
        ) : null}
        {activeAttachmentPanel === "material" ? (
          <MaterialPackPickerPanel
            options={materialPackOptions}
            selected={selectedMaterialPack}
            loading={loadingMaterialPackOptions}
            uploading={uploadingMaterial}
            onSelect={(option) => {
              setSelectedMaterialPack(option);
              setActiveAttachmentPanel(null);
            }}
            onUpload={onOpenMaterialUpload}
          />
        ) : null}
        {activeAttachmentPanel === "structure" ? (
          <StructurePickerPanel
            options={structureOptions}
            selected={selectedStructure}
            loading={loadingStructureOptions}
            onSelect={(option) => {
              setSelectedStructure(option);
              setActiveAttachmentPanel(null);
            }}
          />
        ) : null}
        {onAutoAdvanceToggle ? (
          <button
            className={`new-ui-restructure-auto-advance-toggle ${autoAdvanceEnabled ? "is-on" : ""}`.trim()}
            type="button"
            aria-pressed={autoAdvanceEnabled}
            data-tooltip={autoAdvanceEnabled ? "槽位完成后自动完善 Shot 设计；Shot 设计审查通过后自动确认方案" : "开启后，槽位完成会自动推进到 Shot 设计和确认方案"}
            disabled={autoAdvanceBusy}
            onClick={() => onAutoAdvanceToggle(!autoAdvanceEnabled)}
          >
            <span className="new-ui-restructure-auto-advance-switch" aria-hidden="true">
              <i />
            </span>
            <span>{autoAdvanceBusy ? "推进中" : "自动推进"}</span>
          </button>
        ) : null}
        <ContextUsageIndicator usage={contextUsage} />
        {onStopTurn && (activeTurnTarget?.running || stoppingTurn) ? (
          <button
            className="new-ui-restructure-send-button is-stop"
            type="button"
            aria-label="停止生成"
            data-tooltip={stoppingTurn ? "正在停止生成" : "停止生成"}
            disabled={!canStopTurn}
            onClick={() => {
              if (!canStopTurn) return;
              void onStopTurn();
            }}
          >
            <StopTurnGlyph />
          </button>
        ) : (
          <button className="new-ui-restructure-send-button" type="submit" aria-label="发送" data-tooltip="发送" disabled={!canSend}>
            <SendGlyph />
          </button>
        )}
      </div>
    </form>
  );
  const errorAlert = visibleSendError ? <RestructureSendErrorAlert message={visibleSendError} /> : null;

  if (loadingConversations && !conversation && !draftingConversation && !sendingMessage && !creatingConversation) {
    return (
      <section className="new-ui-restructure-workspace is-loading" aria-label="重组工作区加载中">
        <div className="new-ui-restructure-loading">
          <span />
          <span />
          <span />
        </div>
      </section>
    );
  }

  if (!conversation && (visiblePendingUserMessage || visiblePendingAssistantMessage)) {
    return (
      <section className="new-ui-restructure-workspace" aria-label="重组工作区">
        <header className="new-ui-restructure-header">
          <div className="new-ui-restructure-title-block">
            <h1>重组</h1>
          </div>
        </header>

        <div className="new-ui-restructure-shell">
          <main className="new-ui-restructure-chat" aria-label="重组对话">
            {errorAlert}
            <div
              ref={messageListRef}
              className="new-ui-restructure-message-list"
              onScroll={(event) => {
                shouldStickToBottomRef.current = isNearScrollBottom(event.currentTarget);
              }}
            >
              {visiblePendingUserMessage ? (
                <RestructureMessage
                  message={visiblePendingUserMessage}
                  displayText={getDisplayText(visiblePendingUserMessage)}
                  pseudoStreaming={isPseudoStreaming(visiblePendingUserMessage)}
                />
              ) : null}
              <RestructureTimelineItemGroup
                items={compactingTimelineItems}
                scopeKey="context-compacting"
                expanded
                running
                getDisplayText={getTimelineDisplayText}
                isPseudoStreaming={() => false}
                onToggle={() => undefined}
              />
              {visiblePendingAssistantMessage ? (
                <RestructureMessage
                  message={visiblePendingAssistantMessage}
                  displayText={getDisplayText(visiblePendingAssistantMessage)}
                  pseudoStreaming={isPseudoStreaming(visiblePendingAssistantMessage)}
                />
              ) : null}
            </div>
            {composer}
          </main>
        </div>
      </section>
    );
  }

  if (!conversation && (draftingConversation || sendingMessage || creatingConversation)) {
    return (
      <section className="new-ui-restructure-workspace is-draft" aria-label="新建重组对话">
        <main className="new-ui-restructure-draft">
          {errorAlert}
          <h1>给一个主题，或者直接告诉我你想做什么。</h1>
          {composer}
        </main>
      </section>
    );
  }

  if (!conversation) {
    return (
      <section className="new-ui-restructure-workspace is-empty" aria-label="重组工作区">
        <div className="new-ui-restructure-empty">
          <div>
            <h1>重组会话</h1>
            <p>选择左侧会话，或创建一个新的结构重组对话。</p>
          </div>
          <button className="new-ui-restructure-primary" type="button" disabled={creatingConversation} onClick={onNewConversation}>
            <NewConversationGlyph />
            <span>{creatingConversation ? "创建中" : "新会话"}</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="new-ui-restructure-workspace" aria-label="重组工作区">
      <header className="new-ui-restructure-header">
        <div className="new-ui-restructure-title-block">
          <h1 data-tooltip={displayTitle}>{displayTitle}</h1>
        </div>
      </header>

      <div className="new-ui-restructure-shell">
        <main className="new-ui-restructure-chat" aria-label="重组对话">
          {errorAlert}
          {messages.length || timelineDisplayItems.length || visiblePendingUserMessage || visiblePendingAssistantMessage ? (
            <div
              ref={messageListRef}
              className="new-ui-restructure-message-list"
              onScroll={(event) => {
                shouldStickToBottomRef.current = isNearScrollBottom(event.currentTarget);
              }}
            >
              {confirmedPlanStatusDisplay ? (
                <ConfirmedPlanStatusActivity display={confirmedPlanStatusDisplay} />
              ) : null}
              {messageRenderItems.map((renderItem) => (
                <Fragment key={renderItem.kind === "message" ? renderItem.message.id : renderItem.id}>
                  {shouldInsertTimelineBeforeRenderItem(renderItem, timelineInsertMessageId) ? (
                    <RestructureTimelineItemGroup
                      items={timelineDisplayItems}
                      scopeKey={timelineScopeKey}
                      expanded={timelineActivityExpanded}
                      running={Boolean(activeTurnTarget?.running)}
                      getDisplayText={getTimelineDisplayText}
                      isPseudoStreaming={isTimelinePseudoStreaming}
                      onToggle={() => {
                        if (!timelineScopeKey) return;
                        setTimelineActivityExpandedByScope((current) => ({ ...current, [timelineScopeKey]: !(current[timelineScopeKey] ?? timelineActivityDefaultExpanded) }));
                      }}
                    />
                  ) : null}
                  {renderItem.kind === "process_group" ? (
                    <RestructureProcessMessageGroup
                      group={renderItem}
                      expanded={processMessageExpandedByScope[renderItem.id] ?? !hasTerminalAssistantMessageForProcessGroup(renderItem, messages)}
                      getDisplayText={getProcessDisplayText}
                      isPseudoStreaming={isProcessPseudoStreaming}
                      onToggle={() => {
                        const defaultExpanded = !hasTerminalAssistantMessageForProcessGroup(renderItem, messages);
                        setProcessMessageExpandedByScope((current) => ({ ...current, [renderItem.id]: !(current[renderItem.id] ?? defaultExpanded) }));
                      }}
                    />
                  ) : renderItem.message.storyboardResult && conversation?.conversationId ? (
                    <StoryboardResultViewer
                      conversationId={conversation.conversationId}
                      resultId={renderItem.message.id}
                      statusLabel={resolveStoryboardResultStatusLabel(renderItem.message.storyboardResult.status)}
                    />
                  ) : shouldRenderConversationMessage(renderItem.message, { timelineTurnId, timelineHasAgentMessages }) ? (
                    <RestructureMessage
                      message={renderItem.message}
                      displayText={getDisplayText(renderItem.message)}
                      pseudoStreaming={isPseudoStreaming(renderItem.message)}
                      onOpenPlanTrace={onOpenPlanTrace}
                      onConfirmPlan={onConfirmPlan}
                      actionsDisabled={sendingMessage}
                      openingPlanTrace={openingPlanTraceMessageId === renderItem.message.id}
                      confirmingPlan={confirmingPlanMessageId === renderItem.message.id}
                      planAlreadyConfirmed={isMessagePlanConfirmed(renderItem.message, conversation)}
                    />
                  ) : null}
                </Fragment>
              ))}
              <RestructureTimelineItemGroup
                items={timelineItemsAfterMessages}
                scopeKey={timelineScopeKey}
                expanded={timelineActivityExpanded}
                running={Boolean(activeTurnTarget?.running)}
                getDisplayText={getTimelineDisplayText}
                isPseudoStreaming={isTimelinePseudoStreaming}
                onToggle={() => {
                  if (!timelineScopeKey) return;
                  setTimelineActivityExpandedByScope((current) => ({ ...current, [timelineScopeKey]: !(current[timelineScopeKey] ?? timelineActivityDefaultExpanded) }));
                }}
              />
              {visiblePendingUserMessage ? (
                <RestructureMessage
                  message={visiblePendingUserMessage}
                  displayText={getDisplayText(visiblePendingUserMessage)}
                  pseudoStreaming={isPseudoStreaming(visiblePendingUserMessage)}
                />
              ) : null}
              {visiblePendingAssistantMessage ? (
                <RestructureMessage
                  message={visiblePendingAssistantMessage}
                  displayText={getDisplayText(visiblePendingAssistantMessage)}
                  pseudoStreaming={isPseudoStreaming(visiblePendingAssistantMessage)}
                />
              ) : null}
            </div>
          ) : (
            <div className="new-ui-restructure-thread-empty">
              <h2>还没有消息</h2>
              <p>这个会话已创建，等待第一条重组 brief。</p>
            </div>
          )}

          {composer}
        </main>
      </div>
    </section>
  );
}

function ConfirmedPlanStatusActivity({ display }: { display: ConfirmedPlanStatusDisplay }) {
  return (
    <article className="new-ui-restructure-activity is-process-message">
      <span className="new-ui-restructure-activity-icon" aria-hidden="true">
        <RestructureTimelineIcon kind={display.status === "failed" ? "dialogue_review" : "reasoning"} />
      </span>
      <p>
        <span>方案状态</span>
        <strong>{display.label}</strong>
      </p>
    </article>
  );
}

function RestructureSendErrorAlert({ message }: { message: string }) {
  return (
    <div id="new-ui-restructure-send-error" className="new-ui-restructure-send-error-alert" role="alert">
      <ErrorAlertGlyph />
      <p>{message}</p>
    </div>
  );
}

function AttachmentChip({ label, title, onRemove }: { label: string; title: string; onRemove: () => void }) {
  return (
    <span className="new-ui-restructure-attachment-chip">
      <b>{label}</b>
      <span>{title}</span>
      <button type="button" aria-label={`移除${label}`} onClick={onRemove}>
        <CloseGlyph />
      </button>
    </span>
  );
}

function MaterialPackPickerPanel({
  options,
  selected,
  loading,
  uploading,
  onSelect,
  onUpload,
}: {
  options: NewUiMaterialPackOption[];
  selected: NewUiMaterialPackOption | null;
  loading: boolean;
  uploading: boolean;
  onSelect: (option: NewUiMaterialPackOption) => void;
  onUpload?: () => void;
}) {
  return (
    <section className="new-ui-restructure-picker-panel is-material" aria-label="选择素材识别包">
      <button className="new-ui-restructure-picker-card is-upload-card" type="button" disabled={!onUpload || uploading} onClick={onUpload}>
        <span className="new-ui-restructure-picker-card-icon" aria-hidden="true">
          <UploadMaterialGlyph />
        </span>
        <strong>{uploading ? "正在上传素材" : "上传新素材"}</strong>
        <small>{uploading ? "素材识别启动后会自动附加" : "选择视频并启动素材识别"}</small>
      </button>
      {loading ? <PickerStateCard text="正在读取素材包" /> : null}
      {!loading && !options.length ? <PickerStateCard text="暂无可用素材识别结果" /> : null}
      {!loading ? options.map((option) => (
        <button
          key={`${option.sampleVideoId}:${option.artifactId ?? ""}`}
          className={`new-ui-restructure-picker-card ${isSameMaterialPackOption(option, selected) ? "is-selected" : ""}`.trim()}
          type="button"
          onClick={() => onSelect(option)}
        >
          <span className="new-ui-restructure-picker-thumb" aria-hidden="true">
            {option.coverUrl ? <img src={option.coverUrl} alt="" loading="lazy" decoding="async" /> : <UploadMaterialGlyph />}
          </span>
          <strong>{option.title || `素材 ${shortId(option.sampleVideoId)}`}</strong>
          <small>{formatMaterialPackOptionMeta(option)}</small>
        </button>
      )) : null}
    </section>
  );
}

function StructurePickerPanel({
  options,
  selected,
  loading,
  onSelect,
}: {
  options: NewUiStructureOption[];
  selected: NewUiStructureOption | null;
  loading: boolean;
  onSelect: (option: NewUiStructureOption) => void;
}) {
  return (
    <section className="new-ui-restructure-picker-panel is-structure" aria-label="选择样例结构">
      {loading ? <PickerStateCard text="正在读取样例结构" /> : null}
      {!loading && !options.length ? <PickerStateCard text="暂无 FunctionSlotLibrary 样例" /> : null}
      {!loading ? options.map((option) => (
        <button
          key={option.artifactId}
          className={`new-ui-restructure-picker-card ${isSameStructureOption(option, selected) ? "is-selected" : ""}`.trim()}
          type="button"
          onClick={() => onSelect(option)}
        >
          <span className="new-ui-restructure-picker-card-icon" aria-hidden="true">
            <ReferenceStructureGlyph />
          </span>
          <strong>{option.title || `样例 ${shortId(option.sampleVideoId ?? option.artifactId)}`}</strong>
          <small>{formatStructureOptionMeta(option)}</small>
        </button>
      )) : null}
    </section>
  );
}

function PickerStateCard({ text }: { text: string }) {
  return (
    <div className="new-ui-restructure-picker-card is-state-card">
      <strong>{text}</strong>
    </div>
  );
}

function buildRestructureSendContext(materialPack: NewUiMaterialPackOption | null, structure: NewUiStructureOption | null): NewUiRestructureSendContext {
  return {
    materialPackRef: materialPack ? {
      sampleVideoId: materialPack.sampleVideoId,
      artifactId: materialPack.artifactId ?? null,
      title: materialPack.title ?? null,
      traceId: materialPack.traceId ?? null,
      shotCardCount: materialPack.shotCardCount ?? null,
      materialGroupCount: materialPack.materialGroupCount ?? null,
      proofCoverageCount: materialPack.proofCoverageCount ?? null,
    } : null,
    structureRef: structure ? {
      artifactId: structure.artifactId,
      sampleVideoId: structure.sampleVideoId ?? null,
      title: structure.title ?? null,
      traceId: structure.traceId ?? null,
      slotCount: structure.slotCount ?? null,
      atomCount: structure.atomCount ?? null,
    } : null,
  };
}

function isSameMaterialPackOption(left: NewUiMaterialPackOption | null, right: NewUiMaterialPackOption | null) {
  return Boolean(left && right && left.sampleVideoId === right.sampleVideoId && (left.artifactId ?? null) === (right.artifactId ?? null));
}

function isSameStructureOption(left: NewUiStructureOption | null, right: NewUiStructureOption | null) {
  return Boolean(left && right && left.artifactId === right.artifactId);
}

function formatMaterialPackOptionMeta(option: NewUiMaterialPackOption) {
  const counts = [
    option.shotCardCount != null ? `${option.shotCardCount} 镜头卡` : null,
    option.materialGroupCount != null ? `${option.materialGroupCount} 组` : null,
    option.proofCoverageCount != null ? `${option.proofCoverageCount} 证明项` : null,
  ].filter(Boolean);
  const duration = option.durationSeconds != null ? formatSecondsCompact(option.durationSeconds) : null;
  return [...counts, duration].filter(Boolean).join(" / ") || `sample ${shortId(option.sampleVideoId)}`;
}

function formatStructureOptionMeta(option: NewUiStructureOption) {
  const counts = [
    option.slotCount != null ? `${option.slotCount} 槽位` : null,
    option.atomCount != null ? `${option.atomCount} 原子` : null,
  ].filter(Boolean);
  return counts.join(" / ") || `artifact ${shortId(option.artifactId)}`;
}

function resolveRestructureTitle(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  if (!trimmed) return "重组";
  if (/^function-slot-restructure(?:\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?)?$/i.test(trimmed)) return "重组";
  return trimmed.replace(/\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/, "");
}

function resolveSendErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return normalizeSendErrorMessage(error.message.trim());
  return "发送失败，请稍后重试";
}

function normalizeSendErrorMessage(message: string) {
  const trimmed = message.trim() || "发送失败，请稍后重试";
  return trimmed.replace(/[。.\s]*请开启新对话\s*$/, "") || "发送失败，请稍后重试";
}

function hasRealUserMessageForPending(pending: AgentChatMessageSnapshot, messages: AgentChatMessageSnapshot[]) {
  return messages.some((message) => (
    message.role === "user"
    && (
      message.id === pending.id
      || (Boolean(pending.turnId) && message.turnId === pending.turnId)
    )
  ));
}

function isNearScrollBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

function resolveContextUsageFallbackTarget(conversation: AgentChatConversation | null, activeTarget: NewUiTurnTimelineTarget | null): NewUiTurnTimelineTarget | null {
  const activeThreadId = activeTarget?.threadId?.trim() ?? "";
  const activeTurnId = activeTarget?.turnId?.trim() ?? "";
  const threadId = conversation?.threadId?.trim() ?? "";
  const turnId = resolveConversationLatestTurnId(conversation);
  if (!threadId || !turnId) return null;
  if (activeThreadId === threadId && activeTurnId === turnId) return null;
  return {
    threadId,
    turnId,
    workspaceRoot: conversation?.workspaceRoot ?? null,
    running: false,
  };
}

function resolveConversationLatestTurnId(conversation: AgentChatConversation | null) {
  const explicit = conversation?.latestTurnId?.trim();
  if (explicit) return explicit;
  const latestMessage = [...(conversation?.messages ?? [])].reverse().find((message) => message.turnId?.trim());
  return latestMessage?.turnId?.trim() || null;
}

function resolveConfirmedPlanStatusDisplay(status: string | null | undefined): ConfirmedPlanStatusDisplay | null {
  const value = String(status ?? "").trim();
  if (value === "confirmed") return { label: "方案已确认", status: "completed" };
  if (value === "storyboard_processing") return { label: "故事板准备中", status: "running" };
  if (value === "storyboard_failed") return { label: "故事板准备失败", status: "failed" };
  if (value === "completed") return { label: "方案完成", status: "completed" };
  return null;
}

function resolveStoryboardResultStatusLabel(status: string | null | undefined) {
  const value = String(status ?? "").trim();
  if (value === "confirmed") return "方案已确认";
  if (value === "storyboard_processing") return "故事板准备中";
  if (value === "storyboard_failed") return "故事板准备失败";
  if (value === "completed") return "方案完成";
  return null;
}

function isMessagePlanConfirmed(message: AgentChatMessageSnapshot, conversation: AgentChatConversation | null) {
  const confirmed = conversation?.confirmedPlan;
  if (!confirmed?.status) return false;
  const messageTurnId = message.turnId?.trim();
  const confirmedTurnId = confirmed.turnId?.trim();
  if (!messageTurnId || !confirmedTurnId || messageTurnId !== confirmedTurnId) return false;
  const sourceRestructurePath = normalizeComparablePath(extractRestructureFinalPath(message.text)) || normalizeComparablePath(confirmed.sourceRestructurePath);
  const sourceShotDesignPath = normalizeComparablePath(message.dialogueRoboticReview?.shotDesignFinalPath) || normalizeComparablePath(extractShotDesignFinalPath(message.text)) || normalizeComparablePath(confirmed.sourceShotDesignPath);
  const confirmedRestructurePath = normalizeComparablePath(confirmed.sourceRestructurePath);
  const confirmedShotDesignPath = normalizeComparablePath(confirmed.sourceShotDesignPath);
  if (confirmedRestructurePath && sourceRestructurePath && confirmedRestructurePath !== sourceRestructurePath) return false;
  if (confirmedShotDesignPath && sourceShotDesignPath && confirmedShotDesignPath !== sourceShotDesignPath) return false;
  return true;
}

function normalizeComparablePath(pathText?: string | null) {
  return String(pathText ?? "").trim().replace(/\\/g, "/").toLowerCase() || null;
}

function extractRestructureFinalPath(text?: string | null) {
  const value = String(text ?? "");
  const saved = value.match(/保存路径[：:]\s*`([^`]+restructure\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  const artifactPath = value.match(/(Artifacts[\\/]+FunctionSlotRestructure[^\n`]*?restructure\.final\.md)/i);
  if (artifactPath?.[1]) return artifactPath[1];
  const absolutePath = value.match(/([A-Za-z]:[\\/][^\n`)]*?restructure\.final\.md)/i);
  return absolutePath?.[1] ?? null;
}

function extractShotDesignFinalPath(text?: string | null) {
  const value = String(text ?? "");
  const saved = value.match(/保存路径[：:]\s*`([^`]+shot-design\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  const artifactPath = value.match(/(Artifacts[\\/]+FunctionSlotRestructure[^\n`]*?shot-design\.final\.md)/i);
  if (artifactPath?.[1]) return artifactPath[1];
  const absolutePath = value.match(/([A-Za-z]:[\\/][^\n`)]*?shot-design\.final\.md)/i);
  return absolutePath?.[1] ?? null;
}

function useLastKnownContextUsage(usage: AgentTurnTimeline["activity"]["tokenUsage"] | null, scopeKey: string | null) {
  const lastRef = useRef<{ scopeKey: string | null; usage: AgentTurnTimeline["activity"]["tokenUsage"] | null }>({ scopeKey: null, usage: null });
  if (lastRef.current.scopeKey !== scopeKey) {
    lastRef.current = { scopeKey, usage: null };
  }
  if (hasKnownContextUsage(usage)) {
    lastRef.current = { scopeKey, usage };
    return usage;
  }
  return lastRef.current.usage;
}

function hasKnownContextUsage(usage: AgentTurnTimeline["activity"]["tokenUsage"] | null): usage is NonNullable<AgentTurnTimeline["activity"]["tokenUsage"]> {
  return typeof usage?.contextUsageRatio === "number" && Number.isFinite(usage.contextUsageRatio);
}

function ContextUsageIndicator({ usage }: { usage: AgentTurnTimeline["activity"]["tokenUsage"] | null }) {
  const ratio = typeof usage?.contextUsageRatio === "number" && Number.isFinite(usage.contextUsageRatio)
    ? Math.max(0, Math.min(1, usage.contextUsageRatio))
    : null;
  const percent = ratio == null ? "--" : String(Math.round(ratio * 100));
  const progress = ratio == null ? 0 : Math.round(ratio * 100);
  const state = usage?.contextUsageState ?? "unknown";
  const label = `${percent}% used`;
  return (
    <span
      className={`new-ui-restructure-context-usage ${state}`}
      aria-label={formatContextUsageTitle(usage)}
      data-tooltip={formatContextUsageTitle(usage)}
      style={{ "--context-progress": `${progress}%` } as CSSProperties}
    >
      <b>{label}</b>
      <i aria-hidden="true" />
    </span>
  );
}

function formatContextUsageTitle(usage: AgentTurnTimeline["activity"]["tokenUsage"] | null) {
  if (!usage || usage.contextUsageState === "unknown") return "上下文使用未知";
  return [
    usage.inputTokens != null ? `input ${usage.inputTokens}` : null,
    usage.modelContextWindow != null ? `window ${usage.modelContextWindow}` : null,
    usage.contextThresholdTokens != null ? `threshold ${usage.contextThresholdTokens}` : null,
  ].filter(Boolean).join(" / ") || "上下文使用未知";
}

function RestructureMessage({
  message,
  displayText,
  pseudoStreaming = false,
  onOpenPlanTrace,
  onConfirmPlan,
  actionsDisabled = false,
  openingPlanTrace = false,
  confirmingPlan = false,
  planAlreadyConfirmed = false,
}: {
  message: AgentChatMessageSnapshot;
  displayText?: string;
  pseudoStreaming?: boolean;
  onOpenPlanTrace?: (message: AgentChatMessageSnapshot) => Promise<void> | void;
  onConfirmPlan?: (message: AgentChatMessageSnapshot) => Promise<void> | void;
  actionsDisabled?: boolean;
  openingPlanTrace?: boolean;
  confirmingPlan?: boolean;
  planAlreadyConfirmed?: boolean;
}) {
  const renderedText = displayText ?? message.text;
  const isThinking = message.role === "assistant" && message.status === "running" && !hasRenderableAssistantText(renderedText);
  const showDetails = !isThinking && !pseudoStreaming;
  const userInputOrigin = resolveUserInputOriginDisplay(message);
  const planTraceDisabled = actionsDisabled || openingPlanTrace || !message.slotAtomDisplay?.displayJsonPath;
  const confirmPlanDisabled = actionsDisabled || confirmingPlan || !isDialogueReviewPassed(message);
  const confirmPlanActionLabel = planAlreadyConfirmed ? "重跑方案" : "确认方案";
  const confirmingPlanActionLabel = planAlreadyConfirmed ? "重跑中" : "确认中";
  const confirmPlanActionTooltip = planAlreadyConfirmed ? "重新触发故事板准备流水线" : "确认当前方案并触发故事板准备流水线";

  return (
    <article className={`new-ui-restructure-message is-${message.role} ${message.status ?? ""} ${pseudoStreaming ? "pseudo-streaming" : ""}`.trim()} aria-busy={isThinking || pseudoStreaming || undefined}>
      <div className="new-ui-restructure-message-body">
        <p className={isThinking ? "is-thinking-text" : undefined}>{isThinking ? "正在思考" : renderedText}</p>
        {showDetails && userInputOrigin ? (
          <div className="new-ui-restructure-message-note">
            <RestructureNotePill icon={userInputOrigin.icon} tone={userInputOrigin.tone} tooltip={userInputOrigin.tooltip}>
              {userInputOrigin.label}
            </RestructureNotePill>
          </div>
        ) : null}
        {showDetails && message.slotAtomDisplay ? (
          <div className="new-ui-restructure-message-note">
            <RestructureNotePill icon="slot">槽位 {message.slotAtomDisplay.slotCount ?? 0}</RestructureNotePill>
            <RestructureNotePill icon="atom">原子 {countSlotAtomDisplayAtoms(message.slotAtomDisplay)}</RestructureNotePill>
            {message.slotAtomDisplay.status ? (
              <RestructureNotePill icon="check" tone={slotAtomStatusTone(message.slotAtomDisplay.status)}>
                {formatSlotAtomStatus(message.slotAtomDisplay.status)}
              </RestructureNotePill>
            ) : null}
            {onOpenPlanTrace ? (
              <RestructureNotePill
                icon="trace"
                onClick={() => void onOpenPlanTrace(message)}
                disabled={planTraceDisabled}
                tooltip={message.slotAtomDisplay.displayJsonPath ? "登记当前方案并打开方案溯源图" : "需要当前方案已生成 restructure.display.json"}
              >
                {openingPlanTrace ? "登记中" : "查看溯源图"}
              </RestructureNotePill>
            ) : null}
          </div>
        ) : null}
        {showDetails && message.dialogueRoboticReview ? (
          <div className="new-ui-restructure-message-note">
            <RestructureNotePill icon="review" tone="warning">台词审查</RestructureNotePill>
            {message.dialogueRoboticReview.decision ? (
              <RestructureNotePill icon={dialogueReviewDecisionIcon(message.dialogueRoboticReview.decision)} tone={dialogueReviewDecisionTone(message.dialogueRoboticReview.decision)}>
                {formatDialogueReviewDecision(message.dialogueRoboticReview.decision)}
              </RestructureNotePill>
            ) : null}
            <RestructureNotePill icon="issue">{message.dialogueRoboticReview.issueCount ?? 0} 项问题</RestructureNotePill>
            {onConfirmPlan && isDialogueReviewPassed(message) ? (
              <RestructureNotePill
                icon={planAlreadyConfirmed ? "rerun" : "confirm"}
                tone="success"
                onClick={() => void onConfirmPlan(message)}
                disabled={confirmPlanDisabled}
                tooltip={confirmPlanActionTooltip}
              >
                {confirmingPlan ? confirmingPlanActionLabel : confirmPlanActionLabel}
              </RestructureNotePill>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function RestructureProcessMessageGroup({
  group,
  expanded,
  getDisplayText,
  isPseudoStreaming,
  onToggle,
}: {
  group: Extract<RestructureMessageRenderItem, { kind: "process_group" }>;
  expanded: boolean;
  getDisplayText: (message: AgentChatMessageSnapshot) => string;
  isPseudoStreaming: (message: AgentChatMessageSnapshot) => boolean;
  onToggle: () => void;
}) {
  const panelId = `new-ui-restructure-process-${sanitizeDomId(group.id)}`;
  return (
    <section className={`new-ui-restructure-activity-group ${expanded ? "is-expanded" : ""}`.trim()} aria-label="过程">
      <button
        className="new-ui-restructure-activity-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="new-ui-restructure-activity-chevron" aria-hidden="true">
          <ChevronGlyph />
        </span>
        <span className="new-ui-restructure-activity-summary">
          <span>{expanded ? "收起过程" : "显示过程"}</span>
        </span>
      </button>
      <div id={panelId} className="new-ui-restructure-activity-group-body" aria-hidden={!expanded}>
        {group.messages.map((message) => {
          const pseudoStreaming = isPseudoStreaming(message);
          return (
            <article key={message.id} className={`new-ui-restructure-activity is-process-message ${pseudoStreaming ? "pseudo-streaming" : ""}`.trim()} aria-busy={pseudoStreaming || undefined}>
              <span className="new-ui-restructure-activity-icon" aria-hidden="true">
                <ProcessMessageIcon message={message} />
              </span>
              <p>
                <span>{formatProcessMessageLabel(message)}</span>
                <strong>{getDisplayText(message)}</strong>
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProcessMessageIcon({ message }: { message: AgentChatMessageSnapshot }) {
  const kind = resolveProcessMessageKind(message);
  return <RestructureTimelineIcon kind={kind ?? "reasoning"} />;
}

function RestructureNotePill({
  children,
  icon,
  tone = "neutral",
  tooltip,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  icon: RestructureNotePillIcon;
  tone?: RestructureNotePillTone;
  tooltip?: string | null;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const className = `new-ui-restructure-note-pill is-${tone} ${onClick ? "is-action" : ""}`.trim();
  if (onClick) {
    return (
      <button className={className} type="button" data-tooltip={tooltip || undefined} disabled={disabled} onClick={onClick}>
        <RestructureNotePillIcon icon={icon} />
        <span>{children}</span>
      </button>
    );
  }
  return (
    <span className={className} data-tooltip={tooltip || undefined} tabIndex={tooltip ? 0 : undefined}>
      <RestructureNotePillIcon icon={icon} />
      <span>{children}</span>
    </span>
  );
}

function RestructureNotePillIcon({ icon }: { icon: RestructureNotePillIcon }) {
  if (icon === "slot") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M4.5 4.5h4v4h-4zM11.5 4.5h4v4h-4zM4.5 11.5h4v4h-4zM11.5 11.5h4v4h-4z" />
      </svg>
    );
  }
  if (icon === "atom") {
    return <IconAtom aria-hidden="true" focusable="false" />;
  }
  if (icon === "confirm") {
    return <IconArrowRight aria-hidden="true" focusable="false" />;
  }
  if (icon === "rerun") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M18.3 8.2A7 7 0 1 0 19 13" />
        <path d="M18.6 4.8v3.8h-3.8" />
      </svg>
    );
  }
  if (icon === "check") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="m4.6 10.4 3.3 3.2 7.5-7.2" />
      </svg>
    );
  }
  if (icon === "trace") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M3.5 13.5 7.7 8.8l3.4 3.1 5.4-6.3" />
        <circle cx="3.5" cy="13.5" r="1.1" />
        <circle cx="7.7" cy="8.8" r="1.1" />
        <circle cx="11.1" cy="11.9" r="1.1" />
        <circle cx="16.5" cy="5.6" r="1.1" />
      </svg>
    );
  }
  if (icon === "review") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M5.5 3.8h6.2l2.8 2.8v8.6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1Z" />
        <path d="M11.5 4v3h3M7.2 10h4.8M7.2 13h3" />
      </svg>
    );
  }
  if (icon === "rework") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M4.8 9a5.2 5.2 0 0 1 8.9-3.2L15.5 7" />
        <path d="M15.5 4.2V7h-2.8M15.2 11a5.2 5.2 0 0 1-8.9 3.2L4.5 13" />
        <path d="M4.5 15.8V13h2.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M10 3.6 17 15.8H3L10 3.6Z" />
      <path d="M10 7.8v3.8M10 14.1h.01" />
    </svg>
  );
}

function hasRenderableAssistantText(text: string | null | undefined) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return false;
  return !["正在思考", "正在评估替换", "生成中"].includes(normalized);
}

function resolveUserInputOriginDisplay(message: AgentChatMessageSnapshot) {
  if (message.role !== "user") return null;
  const origin = String(message.userInputOrigin ?? "").trim();
  if (origin === "manual_replacement") {
    return {
      label: "替换评估",
      tooltip: "这条输入来自右侧 Slot/Atom 替换面板，已提交给 Agent 做替换影响评估和重组。",
      icon: "rework" as const,
      tone: "warning" as const,
    };
  }
  if (origin === "auto_dialogue_rework") {
    return {
      label: "台词返工",
      tooltip: "这条输入由台词审查结果自动触发，用于让 Agent 按审查问题继续返工台词。",
      icon: "review" as const,
      tone: "warning" as const,
    };
  }
  if (origin === "auto_advance") {
    return {
      label: "自动推进",
      tooltip: "这条输入由自动推进触发，用于从已完成的槽位方案继续完善具体 Shot 设计。",
      icon: "confirm" as const,
      tone: "success" as const,
    };
  }
  if (origin === "material_context") {
    return {
      label: "附素材包",
      tooltip: "这条输入发送时附带了素材识别产出的 user-material-pack。",
      icon: "slot" as const,
      tone: "success" as const,
    };
  }
  if (origin === "structure_context") {
    return {
      label: "引用结构",
      tooltip: "这条输入发送时固定引用了一个样例结构，重组会基于 brief 做迁移处理。",
      icon: "trace" as const,
      tone: "warning" as const,
    };
  }
  if (origin === "material_and_structure_context") {
    return {
      label: "素材+结构",
      tooltip: "这条输入同时附带素材识别包，并固定引用了一个样例结构。",
      icon: "confirm" as const,
      tone: "success" as const,
    };
  }
  return null;
}

function buildRestructureMessageRenderItems(messages: AgentChatMessageSnapshot[], timelineTurnId: string | null): RestructureMessageRenderItem[] {
  const result: RestructureMessageRenderItem[] = [];
  let pendingProcessMessages: AgentChatMessageSnapshot[] = [];
  const flushProcessMessages = () => {
    if (!pendingProcessMessages.length) return;
    result.push({
      kind: "process_group",
      id: createProcessMessageGroupId(pendingProcessMessages),
      messages: pendingProcessMessages,
    });
    pendingProcessMessages = [];
  };

  messages.forEach((message) => {
    if (isProcessOnlyAssistantMessage(message, timelineTurnId)) {
      pendingProcessMessages.push(message);
      return;
    }
    flushProcessMessages();
    result.push({ kind: "message", message });
  });
  flushProcessMessages();
  return result;
}

function shouldInsertTimelineBeforeRenderItem(renderItem: RestructureMessageRenderItem, timelineInsertMessageId: string | null) {
  if (!timelineInsertMessageId) return false;
  if (renderItem.kind === "message") return renderItem.message.id === timelineInsertMessageId;
  return renderItem.messages.some((message) => message.id === timelineInsertMessageId);
}

function hasTerminalAssistantMessageForProcessGroup(
  renderItem: Extract<RestructureMessageRenderItem, { kind: "process_group" }>,
  messages: AgentChatMessageSnapshot[],
) {
  const turnIds = new Set(renderItem.messages.map((message) => message.turnId).filter(Boolean));
  if (!turnIds.size) return true;
  return messages.some((message) => (
    message.role === "assistant"
    && Boolean(message.turnId && turnIds.has(message.turnId))
    && !isThinkingStatus(message.status)
    && resolveProcessMessageKind(message) === null
  ));
}

function isProcessOnlyAssistantMessage(message: AgentChatMessageSnapshot, timelineTurnId: string | null) {
  if (message.role !== "assistant") return false;
  if (message.slotAtomDisplay || message.dialogueRoboticReview) return false;
  if (timelineTurnId && message.turnId === timelineTurnId && isThinkingStatus(message.status)) return false;
  return resolveProcessMessageKind(message) !== null;
}

function resolveProcessMessageKind(message: AgentChatMessageSnapshot) {
  const text = String(message.text ?? "").trim();
  if (/^reasoning\b/i.test(text)) return "reasoning";
  if (/^(?:tool call|tool_call|command|mcp tool|dynamic tool)\s*[:：]/i.test(text)) return "tool_call";
  if (/^上下文已压缩\b/.test(text) || /^context compacted\b/i.test(text)) return "context_compacted";
  if (/^(?:台词质检状态|台词审查状态|dialogue review status)\s*[:：]/i.test(text)) return "dialogue_review";
  return null;
}

function createProcessMessageGroupId(messages: AgentChatMessageSnapshot[]) {
  const first = messages[0];
  const last = messages[messages.length - 1];
  return `process-${first?.turnId ?? first?.id ?? "unknown"}-${last?.id ?? "last"}`;
}

function formatProcessMessageLabel(message: AgentChatMessageSnapshot) {
  const kind = resolveProcessMessageKind(message);
  if (kind === "tool_call") {
    const text = String(message.text ?? "").trim();
    const match = text.match(/^(?:tool call|tool_call|command|mcp tool|dynamic tool)\s*[:：]\s*(.+)$/i);
    return match?.[1]?.trim() ? `Tool call: ${match[1].trim()}` : "Tool call";
  }
  if (kind === "context_compacted") return "上下文已压缩";
  if (kind === "dialogue_review") return "台词质检";
  return "reasoning";
}

function formatProcessMessageDetail(message: AgentChatMessageSnapshot) {
  const text = String(message.text ?? "").trim();
  const kind = resolveProcessMessageKind(message);
  if (kind === "reasoning") {
    return text.replace(/^reasoning\s*/i, "").trim() || "Reasoning";
  }
  if (kind === "dialogue_review") {
    return text.replace(/^(?:台词质检状态|台词审查状态|dialogue review status)\s*[:：]\s*/i, "").trim() || "等待质检";
  }
  return text.replace(/^(?:tool call|tool_call|command|mcp tool|dynamic tool)\s*[:：]\s*/i, "").trim() || text;
}

function shouldRenderConversationMessage(
  message: AgentChatMessageSnapshot,
  options: { timelineTurnId: string | null; timelineHasAgentMessages: boolean },
) {
  if (
    message.role === "assistant"
    && message.status === "running"
    && message.turnId
    && message.turnId === options.timelineTurnId
    && options.timelineHasAgentMessages
    && !message.slotAtomDisplay
    && !message.dialogueRoboticReview
  ) {
    return false;
  }
  return true;
}

function countSlotAtomDisplayAtoms(display: AgentChatSlotAtomDisplay) {
  const atoms = display.atoms ?? [];
  const count = atoms.reduce((total, atom) => (
    total
    + (atom.scriptAtom ? 1 : 0)
    + (atom.rhythmAtom ? 1 : 0)
    + (atom.packagingAtom ? 1 : 0)
  ), 0);
  return count || display.atomBindingCount || 0;
}

function formatSlotAtomStatus(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "available") return "可用";
  if (normalized === "empty") return "为空";
  return value;
}

function slotAtomStatusTone(value: string): RestructureNotePillTone {
  const normalized = value.trim().toLowerCase();
  if (normalized === "available") return "success";
  if (normalized === "empty") return "warning";
  return "neutral";
}

function formatDialogueReviewDecision(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pass") return "通过";
  if (normalized === "rework") return "返工";
  if (normalized === "blocked") return "阻塞";
  return value;
}

function dialogueReviewDecisionTone(value: string): RestructureNotePillTone {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pass") return "success";
  if (normalized === "rework") return "warning";
  if (normalized === "blocked") return "danger";
  return "neutral";
}

function dialogueReviewDecisionIcon(value: string): RestructureNotePillIcon {
  return value.trim().toLowerCase() === "rework" ? "rework" : "check";
}

function isDialogueReviewPassed(message: AgentChatMessageSnapshot) {
  return message.dialogueRoboticReview?.decision?.trim().toLowerCase() === "pass";
}

function RestructureTimelineItemGroup({
  items,
  scopeKey,
  expanded,
  running,
  getDisplayText,
  isPseudoStreaming,
  onToggle,
}: {
  items: RestructureTimelineDisplayItem[];
  scopeKey: string | null;
  expanded: boolean;
  running: boolean;
  getDisplayText: (item: RestructureTimelineDisplayItem) => string;
  isPseudoStreaming: (item: RestructureTimelineDisplayItem) => boolean;
  onToggle: () => void;
}) {
  if (!items.length) return null;
  const activityItems = items.filter((item): item is RestructureTimelineActivityItem => item.kind !== "agent_message");
  const latestActivity = activityItems[activityItems.length - 1] ?? null;
  const panelId = scopeKey ? `new-ui-restructure-activity-${sanitizeDomId(scopeKey)}` : undefined;

  return (
    <div className="new-ui-restructure-activity-group-stack">
      {activityItems.length ? (
        <section className={`new-ui-restructure-activity-group ${expanded ? "is-expanded" : ""} ${running ? "is-running" : ""}`.trim()} aria-label="过程">
          <button
            className="new-ui-restructure-activity-toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
          >
            <span className="new-ui-restructure-activity-chevron" aria-hidden="true">
              <ChevronGlyph />
            </span>
            <span className="new-ui-restructure-activity-summary">
              <span>{expanded ? "收起过程" : "显示过程"}</span>
            </span>
          </button>
          <div id={panelId} className="new-ui-restructure-activity-group-body" aria-hidden={!expanded}>
            {items.map((item) => (
              <RestructureTimelineItem
                key={item.id}
                item={item}
                displayText={getDisplayText(item)}
                pseudoStreaming={isPseudoStreaming(item)}
                highlight={running && item.kind !== "agent_message" && item.id === latestActivity?.id}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RestructureTimelineItem({ item, displayText, pseudoStreaming = false, highlight = false }: { item: RestructureTimelineDisplayItem; displayText?: string; pseudoStreaming?: boolean; highlight?: boolean }) {
  if (item.kind === "agent_message") {
    const text = displayText ?? item.text;
    const running = isTimelineItemRunning(item.status);
    return (
      <article className={`new-ui-restructure-message is-assistant ${item.status ?? ""} ${pseudoStreaming ? "pseudo-streaming" : ""}`.trim()} aria-busy={running || pseudoStreaming || undefined}>
        <div className="new-ui-restructure-message-body">
          <p className={running && !hasRenderableAssistantText(text) ? "is-thinking-text" : undefined}>
            {running && !hasRenderableAssistantText(text) ? "正在思考" : text}
          </p>
        </div>
      </article>
    );
  }

  const running = isTimelineItemRunning(item.status);
  const detailText = displayText ?? item.detail;
  const thinking = running || pseudoStreaming || highlight;
  return (
    <article className={`new-ui-restructure-activity is-${item.kind} ${item.status ?? ""}`.trim()} aria-busy={thinking || undefined}>
      <span className="new-ui-restructure-activity-icon" aria-hidden="true">
        <RestructureTimelineIcon kind={item.kind} />
      </span>
      <p className={thinking ? "is-thinking-text" : undefined}>
        <span>{item.label}</span>
        {detailText ? <strong>{detailText}</strong> : null}
      </p>
    </article>
  );
}

function useRestructureTurnTimeline(target: NewUiTurnTimelineTarget | null) {
  const [timeline, setTimeline] = useState<AgentTurnTimeline | null>(null);
  const threadId = target?.threadId ?? null;
  const turnId = target?.turnId ?? null;
  const workspaceRoot = target?.workspaceRoot ?? null;
  const targetRunning = Boolean(target?.running);
  const targetKey = threadId && turnId ? `${threadId}:${turnId}:${workspaceRoot ?? ""}` : "";

  useEffect(() => {
    setTimeline(null);
  }, [targetKey]);

  useEffect(() => {
    if (!threadId || !turnId) return undefined;
    let cancelled = false;
    let settlePollsRemaining = RESTRUCTURE_TIMELINE_SETTLED_POLL_COUNT;
    const load = async () => {
      try {
        const next = await getAgentChatTurnTimeline(threadId, turnId, workspaceRoot);
        if (!cancelled) setTimeline(next);
      } catch {
        if (!cancelled) setTimeline(null);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!targetRunning) {
        if (settlePollsRemaining <= 0) {
          window.clearInterval(timer);
          return;
        }
        settlePollsRemaining -= 1;
      }
      void load();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [targetKey, threadId, turnId, workspaceRoot, targetRunning]);

  return timeline;
}

function buildRestructureTimelineDisplayItems(items: AgentTimelineItem[]): RestructureTimelineDisplayItem[] {
  const result: RestructureTimelineDisplayItem[] = [];
  items.forEach((item) => {
    const sourceKey = createTimelineItemSourceKey(item);
    if (item.kind === "reasoning") {
      appendTimelineActivity(result, {
        id: sourceKey,
        sourceKey,
        kind: "reasoning",
        label: "reasoning",
        detail: resolveTimelineItemText(item) || normalizeTimelineTitle(item.title, "Reasoning") || null,
        status: item.status,
      });
      return;
    }
    if (item.kind === "context_compacted") {
      appendTimelineActivity(result, {
        id: sourceKey,
        sourceKey,
        kind: "context_compacted",
        label: "上下文已压缩",
        detail: normalizeTimelineDetail(resolveTimelineItemText(item), "Context compacted"),
        status: item.status,
      });
      return;
    }
    if (item.kind === "agent_message") {
      const text = resolveTimelineItemText(item);
      if (text) {
        appendTimelineActivity(result, {
          id: sourceKey,
          sourceKey,
          kind: "agent_message",
          text,
          status: item.status,
        });
      }
      return;
    }
    if (isTimelineToolCallKind(item.kind)) {
      const toolName = resolveTimelineToolName(item);
      appendTimelineActivity(result, {
        id: sourceKey,
        sourceKey,
        kind: "tool_call",
        label: toolName ? `Tool call: ${toolName}` : "Tool call",
        detail: null,
        status: item.status,
      });
    }
  });
  return result;
}

function appendTimelineActivity(result: RestructureTimelineDisplayItem[], next: RestructureTimelineDisplayItem) {
  const previous = result[result.length - 1];
  if (previous && isSameTimelineActivity(previous, next)) {
    result[result.length - 1] = {
      ...previous,
      status: preferTimelineActivityStatus(previous.status, next.status),
    };
    return;
  }
  const duplicateIndex = result.findIndex((item) => isSameTimelineActivity(item, next));
  if (duplicateIndex >= 0) {
    const duplicate = result[duplicateIndex];
    result[duplicateIndex] = {
      ...duplicate,
      id: next.kind === "agent_message" ? duplicate.id : next.id,
      sourceKey: next.kind === "agent_message" ? duplicate.sourceKey : next.sourceKey,
      status: preferTimelineActivityStatus(duplicate.status, next.status),
    };
    return;
  }
  result.push(next);
}

function isSameTimelineActivity(left: RestructureTimelineDisplayItem, right: RestructureTimelineDisplayItem) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "agent_message" && right.kind === "agent_message") {
    return normalizeTimelineText(left.text) === normalizeTimelineText(right.text);
  }
  if (left.kind === "agent_message" || right.kind === "agent_message") return false;
  return left.label === right.label
    && normalizeTimelineText(left.detail) === normalizeTimelineText(right.detail);
}

function preferTimelineActivityStatus(current: AgentTimelineItem["status"], next: AgentTimelineItem["status"]) {
  if (isTimelineItemRunning(current) && !isTimelineItemRunning(next)) return next;
  return current ?? next;
}

function usePseudoStreamedTimelineAgentMessages(scopeKey: string | null, items: RestructureTimelineDisplayItem[], targetRunning: boolean) {
  const [streamingTextByKey, setStreamingTextByKey] = useState<Record<string, string>>({});
  const seenKeysRef = useRef<Set<string>>(new Set());
  const queuedKeysRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const activeKeyRef = useRef<string | null>(null);
  const streamFrameByKeyRef = useRef<Record<string, number>>({});
  const streamTextByKeyRef = useRef<Record<string, string>>({});
  const previousScopeKeyRef = useRef<string | null | undefined>(undefined);
  const baselineInitializedRef = useRef(false);
  const hasSeenRunningTargetRef = useRef(false);
  const streamableItems = useMemo(() => items.filter(isPseudoStreamableTimelineItem), [items]);

  if (previousScopeKeyRef.current !== scopeKey) {
    previousScopeKeyRef.current = scopeKey;
    baselineInitializedRef.current = false;
    seenKeysRef.current = new Set();
    queuedKeysRef.current = new Set();
    queueRef.current = [];
    activeKeyRef.current = null;
    streamTextByKeyRef.current = {};
    hasSeenRunningTargetRef.current = false;
  }

  if (!baselineInitializedRef.current && scopeKey) {
    seenKeysRef.current = new Set(streamableItems.map((item) => createTimelinePseudoStreamKey(item)));
    baselineInitializedRef.current = true;
  }

  if (targetRunning) hasSeenRunningTargetRef.current = true;

  useEffect(() => {
    Object.values(streamFrameByKeyRef.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
    streamFrameByKeyRef.current = {};
    queuedKeysRef.current = new Set();
    queueRef.current = [];
    activeKeyRef.current = null;
    streamTextByKeyRef.current = {};
    setStreamingTextByKey({});
  }, [scopeKey]);

  useEffect(() => {
    if (!scopeKey) return;
    if (!targetRunning && !hasSeenRunningTargetRef.current) {
      streamableItems.forEach((item) => {
        const key = createTimelinePseudoStreamKey(item);
        if (queuedKeysRef.current.has(key) || activeKeyRef.current === key) return;
        seenKeysRef.current.add(key);
      });
      return;
    }

    streamableItems.forEach((item) => {
      const key = createTimelinePseudoStreamKey(item);
      if (seenKeysRef.current.has(key) || queuedKeysRef.current.has(key) || activeKeyRef.current === key) return;
      streamTextByKeyRef.current[key] = getTimelineStreamText(item);
      queuedKeysRef.current.add(key);
      queueRef.current.push(key);
    });

    startNextQueuedPseudoStream({
      activeKeyRef,
      queueRef,
      queuedKeysRef,
      seenKeysRef,
      streamFrameByKeyRef,
      streamTextByKeyRef,
      setStreamingTextByKey,
    });
  }, [scopeKey, streamableItems, targetRunning]);

  useEffect(() => {
    return () => {
      Object.values(streamFrameByKeyRef.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
      streamFrameByKeyRef.current = {};
      queuedKeysRef.current = new Set();
      queueRef.current = [];
      activeKeyRef.current = null;
      streamTextByKeyRef.current = {};
    };
  }, []);

  return {
    getDisplayText: (item: RestructureTimelineDisplayItem) => {
      if (!isPseudoStreamableTimelineItem(item)) return getTimelineDisplayText(item);
      const key = createTimelinePseudoStreamKey(item);
      if (key in streamingTextByKey) return streamingTextByKey[key];
      if (seenKeysRef.current.has(key)) return getTimelineStreamText(item);
      if (queuedKeysRef.current.has(key) || activeKeyRef.current === key) return "";
      return getTimelineStreamText(item);
    },
    isPseudoStreaming: (item: RestructureTimelineDisplayItem) => {
      if (!isPseudoStreamableTimelineItem(item)) return false;
      const key = createTimelinePseudoStreamKey(item);
      return activeKeyRef.current === key || queuedKeysRef.current.has(key) || key in streamingTextByKey;
    },
  };
}

function startNextQueuedPseudoStream(controls: {
  activeKeyRef: MutableRefObject<string | null>;
  queueRef: MutableRefObject<string[]>;
  queuedKeysRef: MutableRefObject<Set<string>>;
  seenKeysRef: MutableRefObject<Set<string>>;
  streamFrameByKeyRef: MutableRefObject<Record<string, number>>;
  streamTextByKeyRef: MutableRefObject<Record<string, string>>;
  setStreamingTextByKey: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  if (controls.activeKeyRef.current) return;
  const nextKey = controls.queueRef.current.shift() ?? null;
  if (!nextKey) return;
  controls.queuedKeysRef.current.delete(nextKey);
  controls.activeKeyRef.current = nextKey;
  const text = controls.streamTextByKeyRef.current[nextKey] ?? "";

  startPseudoStream(text, nextKey, {
    onText: (nextText) => {
      controls.setStreamingTextByKey((current) => current[nextKey] === nextText ? current : { ...current, [nextKey]: nextText });
    },
    onDone: () => {
      controls.seenKeysRef.current.add(nextKey);
      controls.activeKeyRef.current = null;
      delete controls.streamFrameByKeyRef.current[nextKey];
      delete controls.streamTextByKeyRef.current[nextKey];
      controls.setStreamingTextByKey((current) => {
        if (!(nextKey in current)) return current;
        const next = { ...current };
        delete next[nextKey];
        return next;
      });
      startNextQueuedPseudoStream(controls);
    },
    setFrameId: (frameId) => {
      controls.streamFrameByKeyRef.current[nextKey] = frameId;
    },
  });
}

type PseudoStreamMessageOptions = {
  activeTurnId?: string | null;
  pendingAssistantId?: string | null;
  pendingAssistantTurnId?: string | null;
  pendingSpecialUserId?: string | null;
  pendingSpecialUserTurnId?: string | null;
};

function usePseudoStreamedAssistantMessages(
  conversationId: string | null,
  messages: AgentChatMessageSnapshot[],
  options: PseudoStreamMessageOptions,
) {
  const [streamingTextByKey, setStreamingTextByKey] = useState<Record<string, string>>({});
  const seenMessageKeysRef = useRef<Set<string>>(new Set());
  const queuedMessageKeysRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const activeKeyRef = useRef<string | null>(null);
  const streamFrameByKeyRef = useRef<Record<string, number>>({});
  const streamTextByKeyRef = useRef<Record<string, string>>({});
  const previousConversationIdRef = useRef<string | null | undefined>(undefined);
  const baselineInitializedRef = useRef(false);
  const targetTurnIds = useMemo(
    () => new Set([
      options.activeTurnId,
      options.pendingAssistantTurnId,
      options.pendingSpecialUserTurnId,
    ].filter((value): value is string => Boolean(value))),
    [options.activeTurnId, options.pendingAssistantTurnId, options.pendingSpecialUserTurnId],
  );
  const targetMessageIds = useMemo(
    () => new Set([
      options.pendingAssistantId,
      options.pendingSpecialUserId,
    ].filter((value): value is string => Boolean(value))),
    [options.pendingAssistantId, options.pendingSpecialUserId],
  );
  const streamableMessages = useMemo(() => messages.filter(isPseudoStreamableMessage), [messages]);

  if (previousConversationIdRef.current !== conversationId) {
    previousConversationIdRef.current = conversationId;
    baselineInitializedRef.current = false;
    seenMessageKeysRef.current = new Set();
    queuedMessageKeysRef.current = new Set();
    queueRef.current = [];
    activeKeyRef.current = null;
    streamTextByKeyRef.current = {};
  }

  if (!baselineInitializedRef.current && conversationId && messages.length) {
    seenMessageKeysRef.current = new Set(
      messages
        .filter(isPseudoStreamableMessage)
        .filter((message) => !isExplicitPendingPseudoStreamMessage(message, targetMessageIds))
        .map(createStablePseudoStreamMessageKey),
    );
    baselineInitializedRef.current = true;
  }

  useEffect(() => {
    Object.values(streamFrameByKeyRef.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
    streamFrameByKeyRef.current = {};
    queuedMessageKeysRef.current = new Set();
    queueRef.current = [];
    activeKeyRef.current = null;
    streamTextByKeyRef.current = {};
    setStreamingTextByKey({});
  }, [conversationId]);

  useEffect(() => {
    streamableMessages.forEach((message) => {
      const key = createStablePseudoStreamMessageKey(message);
      if (!isPseudoStreamTargetMessage(message, targetTurnIds, targetMessageIds)) {
        if (queuedMessageKeysRef.current.has(key) || activeKeyRef.current === key) return;
        seenMessageKeysRef.current.add(key);
        return;
      }
      if (seenMessageKeysRef.current.has(key) || queuedMessageKeysRef.current.has(key) || activeKeyRef.current === key) return;
      streamTextByKeyRef.current[key] = message.text;
      queuedMessageKeysRef.current.add(key);
      queueRef.current.push(key);
    });
    startNextQueuedPseudoStream({
      activeKeyRef,
      queueRef,
      queuedKeysRef: queuedMessageKeysRef,
      seenKeysRef: seenMessageKeysRef,
      streamFrameByKeyRef,
      streamTextByKeyRef,
      setStreamingTextByKey,
    });
  }, [streamableMessages, targetMessageIds, targetTurnIds]);

  useEffect(() => {
    return () => {
      Object.values(streamFrameByKeyRef.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
      streamFrameByKeyRef.current = {};
      queuedMessageKeysRef.current = new Set();
      queueRef.current = [];
      activeKeyRef.current = null;
      streamTextByKeyRef.current = {};
    };
  }, []);

  return {
    getDisplayText: (message: AgentChatMessageSnapshot) => {
      const key = isPseudoStreamableMessage(message) ? createStablePseudoStreamMessageKey(message) : null;
      if (!key) return message.text;
      if (key in streamingTextByKey) return streamingTextByKey[key];
      if (seenMessageKeysRef.current.has(key)) return message.text;
      if (queuedMessageKeysRef.current.has(key) || activeKeyRef.current === key) return "";
      return message.text;
    },
    isPseudoStreaming: (message: AgentChatMessageSnapshot) => {
      const key = isPseudoStreamableMessage(message) ? createStablePseudoStreamMessageKey(message) : null;
      return Boolean(key && (activeKeyRef.current === key || queuedMessageKeysRef.current.has(key) || key in streamingTextByKey));
    },
  };
}

function usePseudoStreamedProcessMessages(conversationId: string | null, messages: AgentChatMessageSnapshot[], targetRunning: boolean) {
  const [streamingTextByKey, setStreamingTextByKey] = useState<Record<string, string>>({});
  const seenMessageKeysRef = useRef<Set<string>>(new Set());
  const queuedMessageKeysRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const activeKeyRef = useRef<string | null>(null);
  const streamFrameByKeyRef = useRef<Record<string, number>>({});
  const streamTextByKeyRef = useRef<Record<string, string>>({});
  const previousConversationIdRef = useRef<string | null | undefined>(undefined);
  const baselineInitializedRef = useRef(false);
  const streamableMessages = useMemo(() => createProcessPseudoStreamMessageItems(messages), [messages]);
  const processMessageKeyByObject = useMemo(() => {
    const keyByObject = new WeakMap<AgentChatMessageSnapshot, string>();
    streamableMessages.forEach((item) => keyByObject.set(item.message, item.key));
    return keyByObject;
  }, [streamableMessages]);

  if (previousConversationIdRef.current !== conversationId) {
    previousConversationIdRef.current = conversationId;
    baselineInitializedRef.current = false;
    seenMessageKeysRef.current = new Set();
    queuedMessageKeysRef.current = new Set();
    queueRef.current = [];
    activeKeyRef.current = null;
    streamTextByKeyRef.current = {};
  }

  if (!baselineInitializedRef.current && conversationId) {
    seenMessageKeysRef.current = new Set(streamableMessages.map((item) => item.key));
    baselineInitializedRef.current = true;
  }

  useEffect(() => {
    Object.values(streamFrameByKeyRef.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
    streamFrameByKeyRef.current = {};
    queuedMessageKeysRef.current = new Set();
    queueRef.current = [];
    activeKeyRef.current = null;
    streamTextByKeyRef.current = {};
    setStreamingTextByKey({});
  }, [conversationId]);

  useEffect(() => {
    if (!targetRunning) {
      streamableMessages.forEach((item) => {
        const key = item.key;
        if (queuedMessageKeysRef.current.has(key) || activeKeyRef.current === key) return;
        seenMessageKeysRef.current.add(key);
      });
      return;
    }
    streamableMessages.forEach((item) => {
      const key = item.key;
      if (seenMessageKeysRef.current.has(key) || queuedMessageKeysRef.current.has(key) || activeKeyRef.current === key) return;
      streamTextByKeyRef.current[key] = item.detail;
      queuedMessageKeysRef.current.add(key);
      queueRef.current.push(key);
    });
    startNextQueuedPseudoStream({
      activeKeyRef,
      queueRef,
      queuedKeysRef: queuedMessageKeysRef,
      seenKeysRef: seenMessageKeysRef,
      streamFrameByKeyRef,
      streamTextByKeyRef,
      setStreamingTextByKey,
    });
  }, [streamableMessages, targetRunning]);

  useEffect(() => {
    return () => {
      Object.values(streamFrameByKeyRef.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
      streamFrameByKeyRef.current = {};
      queuedMessageKeysRef.current = new Set();
      queueRef.current = [];
      activeKeyRef.current = null;
      streamTextByKeyRef.current = {};
    };
  }, []);

  return {
    getDisplayText: (message: AgentChatMessageSnapshot) => {
      const key = isPseudoStreamableProcessMessage(message) ? processMessageKeyByObject.get(message) ?? createProcessPseudoStreamMessageKey(message, 0) : null;
      if (!key) return formatProcessMessageDetail(message);
      if (key in streamingTextByKey) return streamingTextByKey[key];
      if (seenMessageKeysRef.current.has(key)) return formatProcessMessageDetail(message);
      if (queuedMessageKeysRef.current.has(key) || activeKeyRef.current === key) return "";
      return formatProcessMessageDetail(message);
    },
    isPseudoStreaming: (message: AgentChatMessageSnapshot) => {
      const key = isPseudoStreamableProcessMessage(message) ? processMessageKeyByObject.get(message) ?? createProcessPseudoStreamMessageKey(message, 0) : null;
      return Boolean(key && (activeKeyRef.current === key || queuedMessageKeysRef.current.has(key) || key in streamingTextByKey));
    },
  };
}

function startPseudoStream(text: string, key: string, controls: { onText: (text: string) => void; onDone: () => void; setFrameId: (frameId: number) => void }) {
  const chars = Array.from(text);
  if (!chars.length) {
    controls.onDone();
    return;
  }
  const durationMs = Math.min(PSEUDO_STREAM_MAX_DURATION_MS, chars.length * PSEUDO_STREAM_CHAR_INTERVAL_MS);
  const startedAt = window.performance.now();

  const tick = () => {
    const elapsedMs = window.performance.now() - startedAt;
    const visibleCount = elapsedMs >= durationMs
      ? chars.length
      : Math.max(1, Math.floor((elapsedMs / durationMs) * chars.length));
    controls.onText(chars.slice(0, visibleCount).join(""));
    if (visibleCount >= chars.length) {
      controls.onDone();
      return;
    }
    controls.setFrameId(window.requestAnimationFrame(tick));
  };

  controls.setFrameId(window.requestAnimationFrame(tick));
}

function isPseudoStreamableMessage(message: AgentChatMessageSnapshot) {
  if (message.role === "assistant") return isPseudoStreamableAssistantMessage(message) && !isPseudoStreamableProcessMessage(message);
  return false;
}

function isPseudoStreamTargetMessage(
  message: AgentChatMessageSnapshot,
  targetTurnIds: Set<string>,
  targetMessageIds: Set<string>,
) {
  if (message.id && targetMessageIds.has(message.id)) return true;
  if (message.turnId && targetTurnIds.has(message.turnId)) return true;
  return false;
}

function isExplicitPendingPseudoStreamMessage(message: AgentChatMessageSnapshot, targetMessageIds: Set<string>) {
  return Boolean(message.id && targetMessageIds.has(message.id));
}

function isPseudoStreamableProcessMessage(message: AgentChatMessageSnapshot) {
  return Boolean(resolveProcessMessageKind(message) && formatProcessMessageDetail(message));
}

function createProcessPseudoStreamMessageItems(messages: AgentChatMessageSnapshot[]) {
  const occurrenceByBaseKey = new Map<string, number>();
  return messages
    .filter(isPseudoStreamableProcessMessage)
    .map((message) => {
      const baseKey = createProcessPseudoStreamMessageBaseKey(message);
      const occurrence = occurrenceByBaseKey.get(baseKey) ?? 0;
      occurrenceByBaseKey.set(baseKey, occurrence + 1);
      return {
        message,
        key: `${baseKey}:${occurrence}`,
        detail: formatProcessMessageDetail(message),
      };
    });
}

function createProcessPseudoStreamMessageKey(message: AgentChatMessageSnapshot, occurrence: number) {
  return `${createProcessPseudoStreamMessageBaseKey(message)}:${occurrence}`;
}

function createProcessPseudoStreamMessageBaseKey(message: AgentChatMessageSnapshot) {
  const turnId = String(message.turnId ?? "").trim() || "no-turn";
  const kind = resolveProcessMessageKind(message) ?? "process";
  const detail = normalizeTimelineText(formatProcessMessageDetail(message)) ?? "";
  return `process:${turnId}:${kind}:${detail}`;
}

function isPseudoStreamableAssistantMessage(message: AgentChatMessageSnapshot) {
  return message.role === "assistant"
    && !isThinkingStatus(message.status)
    && Boolean(message.text);
}

function isThinkingStatus(status: AgentChatMessageSnapshot["status"] | undefined) {
  return String(status ?? "").toLowerCase() === "running";
}

function createPseudoStreamMessageKey(message: AgentChatMessageSnapshot) {
  return `${message.id}:${message.turnId ?? ""}:${message.text}`;
}

function createStablePseudoStreamMessageKey(message: AgentChatMessageSnapshot) {
  const text = String(message.text ?? "");
  const turnId = String(message.turnId ?? "").trim();
  if (turnId) {
    return `${message.role}:${turnId}:${text}`;
  }
  return createPseudoStreamMessageKey(message);
}

function isTimelineItemRunning(status: AgentTimelineItem["status"] | undefined) {
  return String(status ?? "").toLowerCase() === "running";
}

function isTimelineToolCallKind(kind: AgentTimelineItem["kind"]) {
  return kind === "tool_call"
    || kind === "command_execution"
    || kind === "mcp_tool_call"
    || kind === "dynamic_tool_call";
}

function isPseudoStreamableTimelineItem(item: RestructureTimelineDisplayItem): item is RestructureTimelineStreamableItem {
  if (item.kind === "agent_message") {
    return !isTimelineItemRunning(item.status) && Boolean(item.text);
  }
  return item.kind !== "tool_call"
    && !isTimelineItemRunning(item.status)
    && Boolean(item.detail);
}

function getTimelineDisplayText(item: RestructureTimelineDisplayItem) {
  return item.kind === "agent_message" ? item.text : item.detail ?? "";
}

function getTimelineStreamText(item: RestructureTimelineStreamableItem) {
  return item.kind === "agent_message" ? item.text : item.detail;
}

function createTimelinePseudoStreamKey(item: RestructureTimelineStreamableItem) {
  const text = getTimelineStreamText(item);
  return item.kind === "agent_message" ? `agent_message:${normalizeTimelineText(text) ?? ""}` : `${item.sourceKey}:${text}`;
}

function createTimelineItemSourceKey(item: AgentTimelineItem) {
  return `timeline-${item.id}-${item.index}-${item.kind}`;
}

function resolveTimelineItemText(item: AgentTimelineItem) {
  const fullText = (item as AgentTimelineItem & { text?: string | null }).text;
  return normalizeTimelineText(fullText) ?? normalizeTimelineText(item.textPreview);
}

function normalizeTimelineText(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function sanitizeDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-") || "unknown";
}

function normalizeTimelineTitle(title: string | null | undefined, fallback: string) {
  const trimmed = normalizeTimelineText(title);
  if (!trimmed || trimmed.toLowerCase() === fallback.toLowerCase()) return null;
  return trimmed;
}

function normalizeTimelineDetail(value: string | null | undefined, fallback: string) {
  const trimmed = normalizeTimelineText(value);
  if (!trimmed || trimmed.toLowerCase() === fallback.toLowerCase()) return null;
  return trimmed;
}

function resolveTimelineToolName(item: AgentTimelineItem) {
  return normalizeTimelineText(item.metadata?.toolName) ?? normalizeToolNameFromTitle(item.title);
}

function normalizeToolNameFromTitle(title: string | null | undefined) {
  const trimmed = normalizeTimelineText(title);
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:Tool call|Command|MCP tool|Dynamic tool):\s*(.+)$/i);
  return normalizeTimelineText(match?.[1]);
}

function RestructureTimelineIcon({ kind }: { kind: RestructureTimelineActivityItem["kind"] }) {
  if (kind === "reasoning") {
    return (
      <svg viewBox="0 0 20 20" focusable="false">
        <path d="M10 3.2a5 5 0 0 0-2.8 9.1v2.2h5.6v-2.2A5 5 0 0 0 10 3.2Z" />
        <path d="M7.6 17h4.8" />
        <path d="M8.1 9.3h3.8" />
      </svg>
    );
  }
  if (kind === "context_compacted") {
    return (
      <svg viewBox="0 0 20 20" focusable="false">
        <path d="M4.2 5.2h11.6" />
        <path d="M6.2 9.1h7.6" />
        <path d="M8.1 13h3.8" />
        <path d="m7 3-2.8 2.2L7 7.4" />
        <path d="m13 16.9 2.8-2.2-2.8-2.2" />
      </svg>
    );
  }
  if (kind === "context_compacting") {
    return (
      <svg viewBox="0 0 20 20" focusable="false">
        <path d="M5.1 5.2h9.8" />
        <path d="M6.8 9.6h6.4" />
        <path d="M8.3 14h3.4" />
        <path d="M4.2 3.6v3.2h3.2" />
        <path d="M15.8 16.4v-3.2h-3.2" />
        <path d="M4.6 6.8a6.3 6.3 0 0 1 10.2-2" />
        <path d="M15.4 13.2a6.3 6.3 0 0 1-10.2 2" />
      </svg>
    );
  }
  if (kind === "dialogue_review") {
    return (
      <svg viewBox="0 0 20 20" focusable="false">
        <path d="M5.3 3.8h9.4a1 1 0 0 1 1 1v10.4a1 1 0 0 1-1 1H5.3a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1Z" />
        <path d="M7.2 7.2h5.8" />
        <path d="M7.2 10h3.8" />
        <path d="m7.2 13.4 1.4 1.3 3.2-3.2" />
        <path d="M13.8 11.7h.01" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" focusable="false">
      <path d="M7.2 6.4 3.8 10l3.4 3.6" />
      <path d="m12.8 6.4 3.4 3.6-3.4 3.6" />
      <path d="m11.2 4.8-2.4 10.4" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 18 18" focusable="false" aria-hidden="true">
      <path d="m6.2 3.8 5 5.2-5 5.2" />
    </svg>
  );
}

function NewConversationGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function StopTurnGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <rect x="6.2" y="6.2" width="7.6" height="7.6" rx="1.4" />
    </svg>
  );
}

function ErrorAlertGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M10 3.5 17 15.5H3L10 3.5Z" />
      <path d="M10 7.5v4" />
      <path d="M10 14.1h.01" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="m6 6 8 8M14 6l-8 8" />
    </svg>
  );
}

function SendGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M4 10.2 16 4.5l-3.6 11-2.2-4.1L6 9.2l10-4.7" />
    </svg>
  );
}

function UploadMaterialGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M7.2 10.4 11 6.6a2.9 2.9 0 0 1 4.1 4.1l-5.5 5.5a4.1 4.1 0 0 1-5.8-5.8l5.7-5.7" />
      <path d="M8.7 12 13 7.7" />
    </svg>
  );
}

function ReferenceStructureGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M4.5 4.5h4.2v4.2H4.5zM11.3 4.5h4.2v4.2h-4.2zM4.5 11.3h4.2v4.2H4.5zM11.3 11.3h4.2v4.2h-4.2z" />
    </svg>
  );
}
