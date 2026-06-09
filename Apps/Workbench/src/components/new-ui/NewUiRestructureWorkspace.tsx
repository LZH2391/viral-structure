import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type FormEvent, type KeyboardEvent, type MutableRefObject, type ReactNode, type SetStateAction } from "react";
import { getAgentChatTurnTimeline } from "../../api/client";
import type { AgentChatConversation, AgentChatMessageSnapshot, AgentChatSlotAtomDisplay, AgentTimelineItem, AgentTurnTimeline } from "../../types";

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
  onNewConversation: () => void;
  onSendMessage: (message: string) => Promise<void>;
  activeTurnTarget?: NewUiTurnTimelineTarget | null;
  pendingAssistantMessage?: AgentChatMessageSnapshot | null;
  pendingUserMessage?: AgentChatMessageSnapshot | null;
  sendErrorMessage?: string | null;
  sendingMessage: boolean;
};

type RestructureTimelineActivityItem = {
  id: string;
  sourceKey: string;
  kind: "reasoning" | "context_compacted" | "tool_call";
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
type RestructureNotePillIcon = "slot" | "atom" | "check" | "review" | "rework" | "issue";

export function NewUiRestructureWorkspace({
  conversation,
  creatingConversation,
  draftingConversation,
  loadingConversations = false,
  onNewConversation,
  onSendMessage,
  activeTurnTarget = null,
  pendingAssistantMessage = null,
  pendingUserMessage = null,
  sendErrorMessage = null,
  sendingMessage,
}: NewUiRestructureWorkspaceProps) {
  const messages = conversation?.messages ?? [];
  const displayTitle = resolveRestructureTitle(conversation?.title);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [timelineActivityExpandedByScope, setTimelineActivityExpandedByScope] = useState<Record<string, boolean>>({});
  const [processMessageExpandedByScope, setProcessMessageExpandedByScope] = useState<Record<string, boolean>>({});
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const timeline = useRestructureTurnTimeline(activeTurnTarget);
  const contextUsageFallbackTarget = resolveContextUsageFallbackTarget(conversation, activeTurnTarget);
  const contextUsageFallbackTimeline = useRestructureTurnTimeline(contextUsageFallbackTarget);
  const rawContextUsage = conversation ? timeline?.activity?.tokenUsage ?? contextUsageFallbackTimeline?.activity?.tokenUsage ?? null : null;
  const contextUsageScopeKey = conversation?.conversationId ?? conversation?.threadId ?? null;
  const contextUsage = useLastKnownContextUsage(rawContextUsage, contextUsageScopeKey);
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
  const timelineInsertMessageId = timelineConversationAssistantMessage?.id ?? null;
  const timelineItemsAfterMessages = timelineInsertMessageId ? [] : timelineDisplayItems;
  const timelineHasAgentMessages = rawTimelineDisplayItems.some((item) => item.kind === "agent_message");
  const timelineScopeKey = timelineTurnId ? `${timeline?.threadId ?? activeTurnTarget?.threadId ?? ""}:${timelineTurnId}` : null;
  const timelineTurnHasFinalMessage = Boolean(timelineConversationAssistantMessage && !isThinkingStatus(timelineConversationAssistantMessage.status));
  const timelineActivityDefaultExpanded = Boolean(timelineTurnId && !timelineTurnHasFinalMessage);
  const timelineActivityExpanded = timelineScopeKey ? timelineActivityExpandedByScope[timelineScopeKey] ?? timelineActivityDefaultExpanded : false;
  const messageRenderItems = buildRestructureMessageRenderItems(
    messages,
    timelineTurnId && timelineDisplayItems.length ? timelineTurnId : null,
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
  const { isPseudoStreaming, getDisplayText } = usePseudoStreamedAssistantMessages(
    conversation?.conversationId ?? null,
    messages,
    pendingAssistantMessage?.turnId ?? null,
  );
  const {
    isPseudoStreaming: isTimelinePseudoStreaming,
    getDisplayText: getTimelineDisplayText,
  } = usePseudoStreamedTimelineAgentMessages(
    timelineTurnId ? `${timeline?.threadId ?? ""}:${timelineTurnId}` : null,
    timelineDisplayItems,
    Boolean(activeTurnTarget?.running),
  );

  useEffect(() => {
    setSendError(null);
    shouldStickToBottomRef.current = true;
  }, [conversation?.conversationId, draftingConversation]);

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
    setSendError(null);
    setDraft("");
    shouldStickToBottomRef.current = true;
    try {
      await onSendMessage(message);
    } catch (error) {
      setDraft(message);
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
          <button className="new-ui-restructure-tool-button" type="button" aria-disabled="true" data-tooltip="暂未接入上传素材">
            <UploadMaterialGlyph />
            <span>上传素材</span>
          </button>
          <button className="new-ui-restructure-tool-button" type="button" aria-disabled="true" data-tooltip="暂未接入引用结构">
            <ReferenceStructureGlyph />
            <span>引用结构</span>
          </button>
        </div>
        <ContextUsageIndicator usage={contextUsage} />
        <button className="new-ui-restructure-send-button" type="submit" aria-label="发送" data-tooltip="发送" disabled={!canSend}>
          <SendGlyph />
        </button>
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
              {visiblePendingUserMessage ? <RestructureMessage message={visiblePendingUserMessage} /> : null}
              {visiblePendingAssistantMessage ? <RestructureMessage message={visiblePendingAssistantMessage} /> : null}
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
        <div className="new-ui-restructure-actions" aria-label="重组会话操作">
          <button type="button" data-tooltip="新会话" disabled={creatingConversation} onClick={onNewConversation}>
            <NewConversationGlyph />
          </button>
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
                      onToggle={() => {
                        const defaultExpanded = !hasTerminalAssistantMessageForProcessGroup(renderItem, messages);
                        setProcessMessageExpandedByScope((current) => ({ ...current, [renderItem.id]: !(current[renderItem.id] ?? defaultExpanded) }));
                      }}
                    />
                  ) : shouldRenderConversationMessage(renderItem.message, { timelineTurnId, timelineHasAgentMessages }) ? (
                    <RestructureMessage
                      message={renderItem.message}
                      displayText={getDisplayText(renderItem.message)}
                      pseudoStreaming={isPseudoStreaming(renderItem.message)}
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
              {visiblePendingUserMessage ? <RestructureMessage message={visiblePendingUserMessage} /> : null}
              {visiblePendingAssistantMessage ? <RestructureMessage message={visiblePendingAssistantMessage} /> : null}
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

function RestructureSendErrorAlert({ message }: { message: string }) {
  return (
    <div id="new-ui-restructure-send-error" className="new-ui-restructure-send-error-alert" role="alert">
      <ErrorAlertGlyph />
      <p>{message}</p>
    </div>
  );
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

function RestructureMessage({ message, displayText, pseudoStreaming = false }: { message: AgentChatMessageSnapshot; displayText?: string; pseudoStreaming?: boolean }) {
  const renderedText = displayText ?? message.text;
  const isThinking = message.role === "assistant" && message.status === "running" && !hasRenderableAssistantText(renderedText);
  const showDetails = !isThinking && !pseudoStreaming;
  const userInputOrigin = resolveUserInputOriginDisplay(message);

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
          </div>
        ) : null}
      </div>
    </article>
  );
}

function RestructureProcessMessageGroup({
  group,
  expanded,
  onToggle,
}: {
  group: Extract<RestructureMessageRenderItem, { kind: "process_group" }>;
  expanded: boolean;
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
        {group.messages.map((message) => (
          <article key={message.id} className="new-ui-restructure-activity is-process-message">
            <span className="new-ui-restructure-activity-icon" aria-hidden="true">
              <ProcessMessageIcon message={message} />
            </span>
            <p>
              <span>{formatProcessMessageLabel(message)}</span>
              <strong>{formatProcessMessageDetail(message)}</strong>
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProcessMessageIcon({ message }: { message: AgentChatMessageSnapshot }) {
  const kind = resolveProcessMessageKind(message);
  if (kind === "tool_call") {
    return <RestructureTimelineIcon kind="tool_call" />;
  }
  return <RestructureTimelineIcon kind="reasoning" />;
}

function RestructureNotePill({
  children,
  icon,
  tone = "neutral",
  tooltip,
}: {
  children: ReactNode;
  icon: RestructureNotePillIcon;
  tone?: RestructureNotePillTone;
  tooltip?: string | null;
}) {
  return (
    <span className={`new-ui-restructure-note-pill is-${tone}`} data-tooltip={tooltip || undefined} tabIndex={tooltip ? 0 : undefined}>
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
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M6 6.2 14 13.8M14 6.2 6 13.8" />
        <circle cx="6" cy="6" r="2.1" />
        <circle cx="14" cy="6" r="2.1" />
        <circle cx="10" cy="14" r="2.1" />
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
      messages: dedupeProcessMessages(pendingProcessMessages),
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
  if (!turnIds.size) return false;
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
  return null;
}

function createProcessMessageGroupId(messages: AgentChatMessageSnapshot[]) {
  const first = messages[0];
  const last = messages[messages.length - 1];
  return `process-${first?.turnId ?? first?.id ?? "unknown"}-${last?.id ?? "last"}`;
}

function dedupeProcessMessages(messages: AgentChatMessageSnapshot[]) {
  const seen = new Set<string>();
  const result: AgentChatMessageSnapshot[] = [];
  messages.forEach((message) => {
    const key = `${resolveProcessMessageKind(message) ?? "unknown"}:${normalizeTimelineText(message.text) ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(message);
  });
  return result;
}

function formatProcessMessageLabel(message: AgentChatMessageSnapshot) {
  const kind = resolveProcessMessageKind(message);
  if (kind === "tool_call") {
    const text = String(message.text ?? "").trim();
    const match = text.match(/^(?:tool call|tool_call|command|mcp tool|dynamic tool)\s*[:：]\s*(.+)$/i);
    return match?.[1]?.trim() ? `Tool call: ${match[1].trim()}` : "Tool call";
  }
  if (kind === "context_compacted") return "上下文已压缩";
  return "reasoning";
}

function formatProcessMessageDetail(message: AgentChatMessageSnapshot) {
  const text = String(message.text ?? "").trim();
  if (resolveProcessMessageKind(message) === "reasoning") {
    return text.replace(/^reasoning\s*/i, "").trim() || "Reasoning";
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
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RestructureTimelineItem({ item, displayText, pseudoStreaming = false }: { item: RestructureTimelineDisplayItem; displayText?: string; pseudoStreaming?: boolean }) {
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
  return (
    <article className={`new-ui-restructure-activity is-${item.kind} ${item.status ?? ""}`.trim()} aria-busy={running || pseudoStreaming || undefined}>
      <span className="new-ui-restructure-activity-icon" aria-hidden="true">
        <RestructureTimelineIcon kind={item.kind} />
      </span>
      <p className={running || pseudoStreaming ? "is-thinking-text" : undefined}>
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
  const streamableItems = items.filter(isPseudoStreamableTimelineItem);
  const latestItem = items[items.length - 1] ?? null;
  const latestStreamableItem = latestItem && isPseudoStreamableTimelineItem(latestItem) ? latestItem : null;
  const latestStreamableKey = latestStreamableItem ? createTimelinePseudoStreamKey(latestStreamableItem) : null;

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
    seenKeysRef.current = targetRunning ? new Set() : new Set(streamableItems.map((item) => createTimelinePseudoStreamKey(item)));
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
      streamableItems.forEach((item) => seenKeysRef.current.add(createTimelinePseudoStreamKey(item)));
      return;
    }

    streamableItems.forEach((item) => {
      const key = createTimelinePseudoStreamKey(item);
      if (key !== latestStreamableKey) seenKeysRef.current.add(key);
    });

    if (!latestStreamableItem || !latestStreamableKey) return;
    if (seenKeysRef.current.has(latestStreamableKey) || queuedKeysRef.current.has(latestStreamableKey) || activeKeyRef.current === latestStreamableKey) return;

    streamTextByKeyRef.current[latestStreamableKey] = getTimelineStreamText(latestStreamableItem);
    queuedKeysRef.current.add(latestStreamableKey);
    queueRef.current.push(latestStreamableKey);
    startNextTimelinePseudoStream({
      activeKeyRef,
      queueRef,
      queuedKeysRef,
      seenKeysRef,
      streamFrameByKeyRef,
      streamTextByKeyRef,
      setStreamingTextByKey,
    });
  }, [latestStreamableItem, latestStreamableKey, scopeKey, streamableItems, targetRunning]);

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
      if ((targetRunning || hasSeenRunningTargetRef.current) && key === latestStreamableKey) return "";
      return getTimelineStreamText(item);
    },
    isPseudoStreaming: (item: RestructureTimelineDisplayItem) => {
      if (!isPseudoStreamableTimelineItem(item)) return false;
      const key = createTimelinePseudoStreamKey(item);
      return activeKeyRef.current === key || queuedKeysRef.current.has(key) || key in streamingTextByKey || ((targetRunning || hasSeenRunningTargetRef.current) && key === latestStreamableKey && !seenKeysRef.current.has(key));
    },
  };
}

function startNextTimelinePseudoStream(controls: {
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
      startNextTimelinePseudoStream(controls);
    },
    setFrameId: (frameId) => {
      controls.streamFrameByKeyRef.current[nextKey] = frameId;
    },
  });
}

function usePseudoStreamedAssistantMessages(conversationId: string | null, messages: AgentChatMessageSnapshot[], pendingAssistantTurnId: string | null) {
  const [streamingTextByKey, setStreamingTextByKey] = useState<Record<string, string>>({});
  const seenMessageKeysRef = useRef<Set<string>>(new Set());
  const activeStreamKeysRef = useRef<Set<string>>(new Set());
  const streamFrameByKeyRef = useRef<Record<string, number>>({});
  const previousConversationIdRef = useRef<string | null | undefined>(undefined);
  const baselineInitializedRef = useRef(false);
  const latestAssistantMessage = [...messages].reverse().find(isPseudoStreamableAssistantMessage) ?? null;
  const latestAssistantKey = latestAssistantMessage ? createPseudoStreamMessageKey(latestAssistantMessage) : null;

  if (previousConversationIdRef.current !== conversationId) {
    previousConversationIdRef.current = conversationId;
    baselineInitializedRef.current = false;
    seenMessageKeysRef.current = new Set();
    activeStreamKeysRef.current = new Set();
  }

  if (!baselineInitializedRef.current && conversationId && messages.length) {
    seenMessageKeysRef.current = new Set(
      messages
        .filter(isPseudoStreamableAssistantMessage)
        .map(createPseudoStreamMessageKey),
    );
    baselineInitializedRef.current = true;
  }

  useEffect(() => {
    Object.values(streamFrameByKeyRef.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
    streamFrameByKeyRef.current = {};
    activeStreamKeysRef.current = new Set();
    setStreamingTextByKey({});
  }, [conversationId]);

  useEffect(() => {
    const streamableMessages = messages.filter(isPseudoStreamableAssistantMessage);
    streamableMessages.forEach((message) => {
      const key = createPseudoStreamMessageKey(message);
      if (key !== latestAssistantKey) seenMessageKeysRef.current.add(key);
    });
    if (!latestAssistantMessage || !latestAssistantKey) return;
    if (!pendingAssistantTurnId || latestAssistantMessage.turnId !== pendingAssistantTurnId) {
      seenMessageKeysRef.current.add(latestAssistantKey);
      return;
    }
    if (seenMessageKeysRef.current.has(latestAssistantKey) || activeStreamKeysRef.current.has(latestAssistantKey)) return;
    activeStreamKeysRef.current.add(latestAssistantKey);
    startPseudoStream(latestAssistantMessage.text, latestAssistantKey, {
        onText: (text) => {
          setStreamingTextByKey((current) => current[latestAssistantKey] === text ? current : { ...current, [latestAssistantKey]: text });
        },
        onDone: () => {
          seenMessageKeysRef.current.add(latestAssistantKey);
          activeStreamKeysRef.current.delete(latestAssistantKey);
          delete streamFrameByKeyRef.current[latestAssistantKey];
          setStreamingTextByKey((current) => {
            if (!(latestAssistantKey in current)) return current;
            const next = { ...current };
            delete next[latestAssistantKey];
            return next;
          });
        },
        setFrameId: (frameId) => {
          streamFrameByKeyRef.current[latestAssistantKey] = frameId;
        },
      });
  }, [latestAssistantKey, latestAssistantMessage, messages, pendingAssistantTurnId]);

  useEffect(() => {
    return () => {
      Object.values(streamFrameByKeyRef.current).forEach((frameId) => window.cancelAnimationFrame(frameId));
      streamFrameByKeyRef.current = {};
      activeStreamKeysRef.current = new Set();
    };
  }, []);

  return {
    getDisplayText: (message: AgentChatMessageSnapshot) => {
      const key = isPseudoStreamableAssistantMessage(message) ? createPseudoStreamMessageKey(message) : null;
      if (!key) return message.text;
      if (key in streamingTextByKey) return streamingTextByKey[key];
      if (!seenMessageKeysRef.current.has(key) && key === latestAssistantKey && pendingAssistantTurnId && message.turnId === pendingAssistantTurnId) return "";
      return message.text;
    },
    isPseudoStreaming: (message: AgentChatMessageSnapshot) => {
      const key = isPseudoStreamableAssistantMessage(message) ? createPseudoStreamMessageKey(message) : null;
      return Boolean(key && (activeStreamKeysRef.current.has(key) || key in streamingTextByKey));
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

function ErrorAlertGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M10 3.5 17 15.5H3L10 3.5Z" />
      <path d="M10 7.5v4" />
      <path d="M10 14.1h.01" />
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
