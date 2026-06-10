import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AgentChatMessageSnapshot } from "../../types";
import { createTimelineObservedPseudoStreamKey, createTimelinePseudoStreamKey, getTimelineDisplayText, getTimelineStreamText, isPseudoStreamableTimelineItem, isTimelineObservedBeforeCompletion } from "./RestructureWorkspaceTimeline";
import { formatProcessMessageDetail, resolveProcessMessageKind } from "./restructureWorkspaceMessageModel";
import type { RestructureTimelineDisplayItem } from "./restructureWorkspaceTypes";
import { isThinkingStatus, normalizeTimelineText } from "./restructureWorkspaceUtils";

const PSEUDO_STREAM_CHAR_INTERVAL_MS = 15;
const PSEUDO_STREAM_MAX_DURATION_MS = 4000;

export function usePseudoStreamedTimelineAgentMessages(scopeKey: string | null, items: RestructureTimelineDisplayItem[], targetRunning: boolean) {
  const [streamingTextByKey, setStreamingTextByKey] = useState<Record<string, string>>({});
  const seenKeysRef = useRef<Set<string>>(new Set());
  const queuedKeysRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const activeKeyRef = useRef<string | null>(null);
  const observedTimelineKeysRef = useRef<Set<string>>(new Set());
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
    observedTimelineKeysRef.current = new Set();
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
    observedTimelineKeysRef.current = new Set();
    streamTextByKeyRef.current = {};
    setStreamingTextByKey({});
  }, [scopeKey]);

  useEffect(() => {
    if (!scopeKey) return;
    if (targetRunning) {
      items.forEach((item) => {
        if (isTimelineObservedBeforeCompletion(item)) {
          observedTimelineKeysRef.current.add(createTimelineObservedPseudoStreamKey(item));
        }
      });
    }
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
      if (observedTimelineKeysRef.current.has(key)) {
        seenKeysRef.current.add(key);
        return;
      }
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
      observedTimelineKeysRef.current = new Set();
      streamTextByKeyRef.current = {};
    };
  }, []);

  return {
    getDisplayText: (item: RestructureTimelineDisplayItem) => {
      if (!isPseudoStreamableTimelineItem(item)) return getTimelineDisplayText(item);
      const key = createTimelinePseudoStreamKey(item);
      if (!targetRunning) return getTimelineStreamText(item);
      if (key in streamingTextByKey) return streamingTextByKey[key];
      if (seenKeysRef.current.has(key)) return getTimelineStreamText(item);
      if (queuedKeysRef.current.has(key) || activeKeyRef.current === key) return "";
      return getTimelineStreamText(item);
    },
    isPseudoStreaming: (item: RestructureTimelineDisplayItem) => {
      if (!isPseudoStreamableTimelineItem(item)) return false;
      const key = createTimelinePseudoStreamKey(item);
      return targetRunning && (activeKeyRef.current === key || queuedKeysRef.current.has(key) || key in streamingTextByKey);
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

export type PseudoStreamMessageOptions = {
  activeTurnId?: string | null;
  pendingAssistantId?: string | null;
  pendingAssistantTurnId?: string | null;
  pendingSpecialUserId?: string | null;
  pendingSpecialUserTurnId?: string | null;
};

export function usePseudoStreamedAssistantMessages(
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
      if (!isPseudoStreamTargetMessage(message, targetTurnIds, targetMessageIds)) return message.text;
      if (key in streamingTextByKey) return streamingTextByKey[key];
      if (seenMessageKeysRef.current.has(key)) return message.text;
      if (queuedMessageKeysRef.current.has(key) || activeKeyRef.current === key) return "";
      return message.text;
    },
    isPseudoStreaming: (message: AgentChatMessageSnapshot) => {
      const key = isPseudoStreamableMessage(message) ? createStablePseudoStreamMessageKey(message) : null;
      return Boolean(key && isPseudoStreamTargetMessage(message, targetTurnIds, targetMessageIds) && (activeKeyRef.current === key || queuedMessageKeysRef.current.has(key) || key in streamingTextByKey));
    },
  };
}

export function usePseudoStreamedProcessMessages(
  conversationId: string | null,
  messages: AgentChatMessageSnapshot[],
  targetRunning: boolean,
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
    streamableMessages.forEach((item) => {
      const key = item.key;
      if (!targetRunning || !isPseudoStreamTargetMessage(item.message, targetTurnIds, targetMessageIds)) {
        if (queuedMessageKeysRef.current.has(key) || activeKeyRef.current === key) return;
        seenMessageKeysRef.current.add(key);
        return;
      }
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
  }, [streamableMessages, targetMessageIds, targetRunning, targetTurnIds]);

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
      if (!targetRunning || !isPseudoStreamTargetMessage(message, targetTurnIds, targetMessageIds)) return formatProcessMessageDetail(message);
      if (key in streamingTextByKey) return streamingTextByKey[key];
      if (seenMessageKeysRef.current.has(key)) return formatProcessMessageDetail(message);
      if (queuedMessageKeysRef.current.has(key) || activeKeyRef.current === key) return "";
      return formatProcessMessageDetail(message);
    },
    isPseudoStreaming: (message: AgentChatMessageSnapshot) => {
      const key = isPseudoStreamableProcessMessage(message) ? processMessageKeyByObject.get(message) ?? createProcessPseudoStreamMessageKey(message, 0) : null;
      return Boolean(key && targetRunning && isPseudoStreamTargetMessage(message, targetTurnIds, targetMessageIds) && (activeKeyRef.current === key || queuedMessageKeysRef.current.has(key) || key in streamingTextByKey));
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
  if (message.dialogueRoboticReview || message.materialGapMatrix) return false;
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
  const messageId = String(message.id ?? "").trim();
  if (messageId) return `process-message:${messageId}`;
  const turnId = String(message.turnId ?? "").trim() || "no-turn";
  const kind = resolveProcessMessageKind(message) ?? "process";
  const createdAt = String(message.createdAt ?? "").trim();
  const updatedAt = String(message.updatedAt ?? "").trim();
  const stableTimestamp = createdAt || updatedAt;
  if (stableTimestamp) return `process:${turnId}:${kind}:${stableTimestamp}`;
  const detail = normalizeTimelineText(formatProcessMessageDetail(message)) ?? "";
  return `process:${turnId}:${kind}:${detail}`;
}

function isPseudoStreamableAssistantMessage(message: AgentChatMessageSnapshot) {
  return message.role === "assistant"
    && !isThinkingStatus(message.status)
    && Boolean(message.text);
}

function createPseudoStreamMessageKey(message: AgentChatMessageSnapshot) {
  return `${message.id}:${message.turnId ?? ""}`;
}

function createStablePseudoStreamMessageKey(message: AgentChatMessageSnapshot) {
  const turnId = String(message.turnId ?? "").trim();
  if (turnId) {
    return `${message.role}:${turnId}`;
  }
  return createPseudoStreamMessageKey(message);
}
