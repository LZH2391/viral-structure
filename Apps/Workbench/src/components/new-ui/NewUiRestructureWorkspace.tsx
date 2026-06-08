import { Fragment, useEffect, useRef, useState, type CSSProperties, type Dispatch, type FormEvent, type KeyboardEvent, type MutableRefObject, type SetStateAction } from "react";
import { getAgentChatTurnTimeline } from "../../api/client";
import type { AgentChatConversation, AgentChatMessageSnapshot, AgentTimelineItem, AgentTurnTimeline } from "../../types";
import type { NewUiTurnTimelineTarget } from "./NewUiTurnTimelinePanel";

const PSEUDO_STREAM_CHAR_INTERVAL_MS = 15;
const PSEUDO_STREAM_MAX_DURATION_MS = 4000;
const RESTRUCTURE_SEND_RETRY_HINT = "请开启新对话";
const RESTRUCTURE_TIMELINE_SETTLED_POLL_COUNT = 3;

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

type RestructureTimelineMessageItem = {
  id: string;
  sourceKey: string;
  type: "message";
  role: "user" | "assistant";
  text: string;
  status: AgentTimelineItem["status"];
};

type RestructureTimelineAssistantMessageItem = RestructureTimelineMessageItem & {
  role: "assistant";
};

type RestructureTimelineActivityItem = {
  id: string;
  sourceKey: string;
  type: "activity";
  kind: "reasoning" | "context_compacted" | "tool_call";
  label: string;
  detail: string | null;
  status: AgentTimelineItem["status"];
};

type RestructureTimelineDisplayItem = RestructureTimelineMessageItem | RestructureTimelineActivityItem;
type RestructureTimelineStreamableItem = RestructureTimelineAssistantMessageItem | (RestructureTimelineActivityItem & { detail: string });

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
  const timeline = useRestructureTurnTimeline(activeTurnTarget);
  const rawTimelineDisplayItems = buildRestructureTimelineDisplayItems(timeline?.items ?? []);
  const timelineTurnId = activeTurnTarget?.turnId && rawTimelineDisplayItems.length ? activeTurnTarget.turnId : null;
  const timelineConversationAssistantMessage = timelineTurnId
    ? messages.find((message) => message.role === "assistant" && message.turnId === timelineTurnId) ?? null
    : null;
  const timelineDisplayItems = timelineConversationAssistantMessage
    ? rawTimelineDisplayItems.filter((item) => item.type === "activity")
    : rawTimelineDisplayItems;
  const timelineInsertMessageId = timelineConversationAssistantMessage?.id ?? null;
  const timelineItemsAfterMessages = timelineInsertMessageId ? [] : timelineDisplayItems;
  const timelineHasUserInput = rawTimelineDisplayItems.some((item) => item.type === "message" && item.role === "user");
  const timelineHasAssistantMessage = rawTimelineDisplayItems.some((item) => item.type === "message" && item.role === "assistant");
  const visiblePendingUserMessage = pendingUserMessage && !messages.some((message) => message.role === "user" && message.text === pendingUserMessage.text)
    && !(timelineHasUserInput && rawTimelineDisplayItems.some((item) => item.type === "message" && item.role === "user" && item.text === pendingUserMessage.text))
    ? pendingUserMessage
    : null;
  const visiblePendingAssistantMessage = pendingAssistantMessage && !messages.some((message) => (
    message.role === "assistant"
    && (
      (pendingAssistantMessage.turnId && message.turnId === pendingAssistantMessage.turnId)
      || message.id === pendingAssistantMessage.id
    )
  ))
    && !(timelineHasAssistantMessage && pendingAssistantMessage.turnId === timelineTurnId)
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
  }, [conversation?.conversationId, draftingConversation]);

  const submitDraft = async () => {
    if (!canSend) return;
    const message = draft.trim();
    setSendError(null);
    setDraft("");
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
        <ContextUsageIndicator usage={timeline?.activity?.tokenUsage ?? null} />
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
            <div className="new-ui-restructure-message-list">
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
            <div className="new-ui-restructure-message-list">
              {messages.map((message) => (
                <Fragment key={message.id}>
                  {message.id === timelineInsertMessageId ? timelineDisplayItems.map((item) => (
                    <RestructureTimelineItem
                      key={item.id}
                      item={item}
                      displayText={getTimelineDisplayText(item)}
                      pseudoStreaming={isTimelinePseudoStreaming(item)}
                    />
                  )) : null}
                  <RestructureMessage message={message} displayText={getDisplayText(message)} pseudoStreaming={isPseudoStreaming(message)} />
                </Fragment>
              ))}
              {timelineItemsAfterMessages.map((item) => (
                <RestructureTimelineItem
                  key={item.id}
                  item={item}
                  displayText={getTimelineDisplayText(item)}
                  pseudoStreaming={isTimelinePseudoStreaming(item)}
                />
              ))}
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
  if (error instanceof Error && error.message.trim()) return appendSendRetryHint(error.message.trim());
  return appendSendRetryHint("发送失败，请稍后重试");
}

function appendSendRetryHint(message: string) {
  const trimmed = message.trim() || "发送失败，请稍后重试";
  return trimmed.includes(RESTRUCTURE_SEND_RETRY_HINT) ? trimmed : `${trimmed}。${RESTRUCTURE_SEND_RETRY_HINT}`;
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
  const isThinking = message.role === "assistant" && message.status === "running";
  const showDetails = !isThinking && !pseudoStreaming;

  return (
    <article className={`new-ui-restructure-message is-${message.role} ${message.status ?? ""} ${pseudoStreaming ? "pseudo-streaming" : ""}`.trim()} aria-busy={isThinking || pseudoStreaming || undefined}>
      <div className="new-ui-restructure-message-body">
        <p className={isThinking ? "is-thinking-text" : undefined}>{isThinking ? "正在思考" : displayText ?? message.text}</p>
        {showDetails && message.slotAtomDisplay ? (
          <div className="new-ui-restructure-message-note">
            <span>槽位 {message.slotAtomDisplay.slotCount ?? 0}</span>
            <span>原子 {message.slotAtomDisplay.atomBindingCount ?? 0}</span>
            {message.slotAtomDisplay.status ? <span>{message.slotAtomDisplay.status}</span> : null}
          </div>
        ) : null}
        {showDetails && message.dialogueRoboticReview ? (
          <div className="new-ui-restructure-message-note">
            <span>台词审查</span>
            {message.dialogueRoboticReview.decision ? <span>{message.dialogueRoboticReview.decision}</span> : null}
            <span>{message.dialogueRoboticReview.issueCount ?? 0} 项</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function RestructureTimelineItem({ item, displayText, pseudoStreaming = false }: { item: RestructureTimelineDisplayItem; displayText?: string; pseudoStreaming?: boolean }) {
  if (item.type === "message") {
    return (
      <article className={`new-ui-restructure-message is-${item.role} ${item.status ?? ""} ${pseudoStreaming ? "pseudo-streaming" : ""}`.trim()} aria-busy={pseudoStreaming || undefined}>
        <div className="new-ui-restructure-message-body">
          <p>{displayText ?? item.text}</p>
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
    if (item.kind === "user_input") {
      const text = resolveTimelineItemText(item);
      if (text) result.push({ id: sourceKey, sourceKey, type: "message", role: "user", text, status: item.status });
      return;
    }
    if (item.kind === "agent_message") {
      const text = resolveTimelineItemText(item);
      if (text) result.push({ id: sourceKey, sourceKey, type: "message", role: "assistant", text, status: item.status });
      return;
    }
    if (item.kind === "reasoning") {
      result.push({
        id: sourceKey,
        sourceKey,
        type: "activity",
        kind: "reasoning",
        label: "reasoning",
        detail: resolveTimelineItemText(item) || normalizeTimelineTitle(item.title, "Reasoning") || null,
        status: item.status,
      });
      return;
    }
    if (item.kind === "context_compacted") {
      result.push({
        id: sourceKey,
        sourceKey,
        type: "activity",
        kind: "context_compacted",
        label: "上下文已压缩",
        detail: normalizeTimelineDetail(resolveTimelineItemText(item), "Context compacted"),
        status: item.status,
      });
      return;
    }
    if (isTimelineToolCallKind(item.kind)) {
      const toolName = resolveTimelineToolName(item);
      result.push({
        id: sourceKey,
        sourceKey,
        type: "activity",
        kind: "tool_call",
        label: toolName ? `Tool call: ${toolName}` : "Tool call",
        detail: null,
        status: item.status,
      });
    }
  });
  return result;
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
      if (!isPseudoStreamableTimelineItem(item)) return item.type === "message" ? item.text : item.detail ?? "";
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

function isPseudoStreamableTimelineAgentItem(item: RestructureTimelineDisplayItem): item is RestructureTimelineAssistantMessageItem {
  return item.type === "message"
    && item.role === "assistant"
    && !isTimelineItemRunning(item.status)
    && Boolean(item.text);
}

function isPseudoStreamableTimelineItem(item: RestructureTimelineDisplayItem): item is RestructureTimelineStreamableItem {
  if (item.type === "message") return isPseudoStreamableTimelineAgentItem(item);
  return item.kind !== "tool_call"
    && !isTimelineItemRunning(item.status)
    && Boolean(item.detail);
}

function getTimelineStreamText(item: RestructureTimelineStreamableItem) {
  return item.type === "message" ? item.text : item.detail;
}

function createTimelinePseudoStreamKey(item: RestructureTimelineStreamableItem) {
  return `${item.sourceKey}:${getTimelineStreamText(item)}`;
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
