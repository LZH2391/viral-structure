import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { AgentChatConversation, AgentChatMessageSnapshot } from "../../types";

const PSEUDO_STREAM_CHAR_INTERVAL_MS = 30;
const PSEUDO_STREAM_MAX_DURATION_MS = 4000;

type NewUiRestructureWorkspaceProps = {
  conversation: AgentChatConversation | null;
  creatingConversation: boolean;
  draftingConversation: boolean;
  loadingConversations?: boolean;
  onNewConversation: () => void;
  onSendMessage: (message: string) => Promise<void>;
  pendingAssistantMessage?: AgentChatMessageSnapshot | null;
  pendingUserMessage?: AgentChatMessageSnapshot | null;
  sendingMessage: boolean;
};

export function NewUiRestructureWorkspace({
  conversation,
  creatingConversation,
  draftingConversation,
  loadingConversations = false,
  onNewConversation,
  onSendMessage,
  pendingAssistantMessage = null,
  pendingUserMessage = null,
  sendingMessage,
}: NewUiRestructureWorkspaceProps) {
  const messages = conversation?.messages ?? [];
  const displayTitle = resolveRestructureTitle(conversation?.title);
  const [draft, setDraft] = useState("");
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
  const { isPseudoStreaming, getDisplayText } = usePseudoStreamedAssistantMessages(
    conversation?.conversationId ?? null,
    messages,
    pendingAssistantMessage?.turnId ?? null,
  );

  const submitDraft = async () => {
    if (!canSend) return;
    const message = draft.trim();
    setDraft("");
    try {
      await onSendMessage(message);
    } catch {
      setDraft(message);
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
          onChange={(event) => setDraft(event.target.value)}
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
        <button className="new-ui-restructure-send-button" type="submit" aria-label="发送" data-tooltip="发送" disabled={!canSend}>
          <SendGlyph />
        </button>
      </div>
    </form>
  );

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

function resolveRestructureTitle(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  if (!trimmed) return "重组";
  if (/^function-slot-restructure(?:\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?)?$/i.test(trimmed)) return "重组";
  return trimmed.replace(/\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/, "");
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

function usePseudoStreamedAssistantMessages(conversationId: string | null, messages: AgentChatMessageSnapshot[], pendingAssistantTurnId: string | null) {
  const [streamingTextByKey, setStreamingTextByKey] = useState<Record<string, string>>({});
  const seenMessageKeysRef = useRef<Set<string>>(new Set());
  const activeStreamKeysRef = useRef<Set<string>>(new Set());
  const streamFrameByKeyRef = useRef<Record<string, number>>({});
  const previousConversationIdRef = useRef<string | null | undefined>(undefined);
  const baselineInitializedRef = useRef(false);

  if (previousConversationIdRef.current !== conversationId) {
    previousConversationIdRef.current = conversationId;
    baselineInitializedRef.current = false;
    seenMessageKeysRef.current = new Set();
    activeStreamKeysRef.current = new Set();
  }

  if (!baselineInitializedRef.current && conversationId) {
    seenMessageKeysRef.current = new Set(
      messages
        .filter((message) => {
          if (!isPseudoStreamableAssistantMessage(message)) return false;
          return !(pendingAssistantTurnId && message.turnId === pendingAssistantTurnId);
        })
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
      if (seenMessageKeysRef.current.has(key) || activeStreamKeysRef.current.has(key)) return;
      activeStreamKeysRef.current.add(key);
      startPseudoStream(message.text, key, {
        onText: (text) => {
          setStreamingTextByKey((current) => current[key] === text ? current : { ...current, [key]: text });
        },
        onDone: () => {
          seenMessageKeysRef.current.add(key);
          activeStreamKeysRef.current.delete(key);
          delete streamFrameByKeyRef.current[key];
          setStreamingTextByKey((current) => {
            if (!(key in current)) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
        },
        setFrameId: (frameId) => {
          streamFrameByKeyRef.current[key] = frameId;
        },
      });
    });

    const liveKeys = new Set(streamableMessages.map(createPseudoStreamMessageKey));
    Object.keys(streamFrameByKeyRef.current).forEach((key) => {
      if (liveKeys.has(key)) return;
      window.cancelAnimationFrame(streamFrameByKeyRef.current[key]);
      delete streamFrameByKeyRef.current[key];
      activeStreamKeysRef.current.delete(key);
    });
  }, [messages]);

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
      if (!seenMessageKeysRef.current.has(key)) return "";
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
