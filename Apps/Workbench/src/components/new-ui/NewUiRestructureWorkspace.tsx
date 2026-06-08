import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { getAgentChatTurnTimeline } from "../../api/client";
import type { AgentChatConversation, AgentChatMessageSnapshot, AgentChatSlotAtomDisplay, AgentTurnTimeline } from "../../types";
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
  const contextUsageFallbackTarget = resolveContextUsageFallbackTarget(conversation, activeTurnTarget);
  const contextUsageFallbackTimeline = useRestructureTurnTimeline(contextUsageFallbackTarget);
  const rawContextUsage = timeline?.activity?.tokenUsage ?? contextUsageFallbackTimeline?.activity?.tokenUsage ?? null;
  const contextUsageScopeKey = conversation?.conversationId ?? conversation?.threadId ?? null;
  const contextUsage = useLastKnownContextUsage(rawContextUsage, contextUsageScopeKey);
  const visiblePendingUserMessage = pendingUserMessage && !messages.some((message) => message.role === "user" && message.text === pendingUserMessage.text)
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
          {messages.length || visiblePendingUserMessage || visiblePendingAssistantMessage ? (
            <div className="new-ui-restructure-message-list">
              {messages.map((message) => (
                <RestructureMessage key={message.id} message={message} displayText={getDisplayText(message)} pseudoStreaming={isPseudoStreaming(message)} />
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
  const isThinking = message.role === "assistant" && message.status === "running";
  const showDetails = !isThinking && !pseudoStreaming;

  return (
    <article className={`new-ui-restructure-message is-${message.role} ${message.status ?? ""} ${pseudoStreaming ? "pseudo-streaming" : ""}`.trim()} aria-busy={isThinking || pseudoStreaming || undefined}>
      <div className="new-ui-restructure-message-body">
        <p className={isThinking ? "is-thinking-text" : undefined}>{isThinking ? "正在思考" : displayText ?? message.text}</p>
        {showDetails && message.slotAtomDisplay ? (
          <div className="new-ui-restructure-message-note">
            <span>槽位 {message.slotAtomDisplay.slotCount ?? 0}</span>
            <span>原子 {countSlotAtomDisplayAtoms(message.slotAtomDisplay)}</span>
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
