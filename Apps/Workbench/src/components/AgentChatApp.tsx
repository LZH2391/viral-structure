import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { archiveAgentChatConversation, autoRunShotStoryboardPrep, collectAgentChatTurn, compactAgentChatThread, confirmAgentChatConversation, getAgentChatTurnTimeline, getThreadPoolRoles, listAgentChatConversations, registerFunctionSlotConfirmedPlanTrace, releaseAgentChatLease, resumeAgentChatConversation, reviewAgentChatDialogue, sendAgentChatMessage, startAgentChatThread, stopAgentChatTurn, submitAgentChatDialogueRework, submitAgentChatManualReplacement, type AgentChatActionProjection, type AgentChatSessionResponse, type AgentChatTurnResponse } from "../api/client";
import type { AgentChatConversation, AgentChatDialogueRoboticReview, AgentChatSlotAtomDisplay, AgentTurnTimeline, ReplacementDraft, ThreadConversation, ThreadPoolRoleSummary } from "../types";
import { useResizableThreePaneLayout } from "../hooks/useResizableThreePaneLayout";
import { shortId } from "../utils/format";
import { extractRestructureFinalPath, normalizeRestructureFinalPath } from "../utils/restructurePath";
import { buildReplacementDraftSummary, SlotAtomView } from "./agent-chat/SlotAtomReplacementPanel";
import { SplitResizeHandle } from "./SplitResizeHandle";

type ChatMode = "direct" | "threadpool-role";
type RightPanelTab = "timeline" | "slotAtom";
type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  status?: "running" | "completed" | "failed" | "canceled";
  slotAtomDisplay?: AgentChatSlotAtomDisplay | null;
  dialogueRoboticReview?: AgentChatDialogueRoboticReview | null;
};
type PendingAgentChatSend = {
  text: string;
  role: string;
  userMessageId: string;
  generation: number;
};

const POLL_INTERVAL_MS = 1800;
const WARMING_RESEND_INTERVAL_MS = 2500;

export function AgentChatApp({ embedded = false, active = true }: { embedded?: boolean; active?: boolean }) {
  const [mode, setMode] = useState<ChatMode>("direct");
  const [roles, setRoles] = useState<ThreadPoolRoleSummary[]>([]);
  const [selectedRole, setSelectedRole] = useState("");
  const [session, setSession] = useState<AgentChatSessionResponse | null>(null);
  const [conversations, setConversations] = useState<AgentChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationRevision, setActiveConversationRevision] = useState<number | null>(null);
  const [activeConversationInvalidated, setActiveConversationInvalidated] = useState(false);
  const [activeConversationConfirmedPlan, setActiveConversationConfirmedPlan] = useState<AgentChatConversation["confirmedPlan"]>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(null);
  const [turnActionProjection, setTurnActionProjection] = useState<AgentChatActionProjection | null>(null);
  const [turnActionBusy, setTurnActionBusy] = useState<"stop_turn" | null>(null);
  const [threadStopped, setThreadStopped] = useState(false);
  const [timeline, setTimeline] = useState<AgentTurnTimeline | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("timeline");
  const [statusText, setStatusText] = useState("等待连接");
  const [busy, setBusy] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [registeringTrace, setRegisteringTrace] = useState(false);
  const [reviewingDialogue, setReviewingDialogue] = useState(false);
  const [dialogueReworking, setDialogueReworking] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const warmingResendTimerRef = useRef<number | null>(null);
  const pollGenerationRef = useRef(0);
  const pendingSendGenerationRef = useRef(0);
  const pendingSendRef = useRef<PendingAgentChatSend | null>(null);
  const resendPendingRef = useRef<(pending: PendingAgentChatSend) => void>(() => undefined);
  const activeConversationIdRef = useRef<string | null>(null);
  const activeConversationRevisionRef = useRef<number | null>(null);
  const sessionRef = useRef<AgentChatSessionResponse | null>(null);
  const modeRef = useRef<ChatMode>("direct");
  const selectedRoleRef = useRef("");
  const resumeGenerationRef = useRef(0);
  const conversationActionGenerationRef = useRef(0);
  const creatingDraftConversationRef = useRef(false);
  const compactedUsageKeysRef = useRef<Set<string>>(new Set());
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

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    activeConversationRevisionRef.current = activeConversationRevision;
  }, [activeConversationRevision]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    selectedRoleRef.current = selectedRole;
  }, [selectedRole]);

  useEffect(() => {
    if (!active) return;
    void getThreadPoolRoles()
      .then((payload) => {
        const nextRoles = payload.roles ?? [];
        setRoles(nextRoles);
        setSelectedRole((current) => current || nextRoles.find((role) => role.role === "function-slot-restructure")?.role || nextRoles[0]?.role || "");
      })
      .catch(() => undefined);
  }, []);

  const refreshConversations = useCallback(async () => {
    const payload = await listAgentChatConversations({ role: "function-slot-restructure", status: "active" });
    const items = payload.conversations ?? [];
    setConversations(items);
    const activeId = activeConversationIdRef.current;
    if (activeId) {
      const active = items.find((conversation) => conversation.conversationId === activeId);
      if (active) {
        setActiveConversationRevision(normalizeConversationRevision(active.revision));
        setActiveConversationInvalidated(Boolean(active.invalidated));
        setActiveConversationConfirmedPlan(active.confirmedPlan ?? null);
        setThreadStopped(Boolean(active.threadStopped));
      }
    }
    return items;
  }, []);

  const syncActiveConversationForRetry = useCallback(async (conversationId = activeConversationId) => {
    if (!conversationId) return null;
    setStatusText("会话已更新，自动同步中");
    const payload = await resumeAgentChatConversation(conversationId);
    if (payload.deleted) {
      setActiveConversationInvalidated(true);
      throw new Error(payload.refreshError?.message ?? "thread 已不可读，此会话已失效");
    }
    const revision = normalizeConversationRevision(payload.conversation.revision);
    activeConversationRevisionRef.current = revision;
    setActiveConversationRevision(revision);
    setActiveConversationInvalidated(Boolean(payload.conversation.invalidated));
    setActiveConversationConfirmedPlan(payload.conversation.confirmedPlan ?? null);
    setThreadStopped(Boolean(payload.conversation.threadStopped));
    setSession((current) => current?.conversationId === conversationId ? {
      ...current,
      conversationRevision: revision,
      conversationStatus: payload.conversation.status,
    } : current);
    setConversations((current) => current.map((item) => item.conversationId === conversationId ? payload.conversation : item));
    return payload.conversation;
  }, [activeConversationId]);

  const applyConversationTitleFromTurn = useCallback((response: AgentChatTurnResponse, fallbackConversationId?: string | null) => {
    const conversationId = response.conversationId ?? fallbackConversationId ?? activeConversationIdRef.current;
    const title = response.conversationTitle?.trim();
    const titleState = response.conversationTitleState ?? null;
    if (!conversationId || (!title && !titleState)) return;
    const revision = normalizeConversationRevision(response.conversationRevision);
    setConversations((current) => current.map((conversation) => (
      conversation.conversationId === conversationId
        ? {
            ...conversation,
            title: title || conversation.title,
            titleState: titleState ?? conversation.titleState,
            revision: revision ?? conversation.revision,
          }
        : conversation
    )));
  }, [active]);

  useEffect(() => () => {
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    if (warmingResendTimerRef.current) window.clearTimeout(warmingResendTimerRef.current);
  }, []);

  const sessionMeta = useMemo(() => ({
    source: session?.source ?? mode,
    role: session?.role ?? (mode === "threadpool-role" ? selectedRole : null),
    leaseId: session?.leaseId ?? null,
    parentThreadId: session?.parentThreadId ?? null,
    conversationId: session?.conversationId ?? activeConversationId ?? null,
    expectedRevision: activeConversationRevision,
    workspaceRoot: session?.workspaceRoot ?? null,
    skillPath: session?.skillPath ?? null,
  }), [activeConversationId, activeConversationRevision, mode, selectedRole, session]);
  const canConfirmRestructure = session?.source === "threadpool-role"
    && session.role === "function-slot-restructure"
    && Boolean(session.threadId)
    && Boolean(currentTurnId)
    && !activeConversationInvalidated
    && !busy
    && !confirming;
  const contextUsage = timeline?.activity?.tokenUsage ?? null;
  const activeSlotAtomDisplay = useMemo(
    () => resolveActiveSlotAtomDisplay(messages, currentTurnId),
    [currentTurnId, messages],
  );
  const currentRestructureFinalPath = useMemo(
    () => resolveCurrentRestructureFinalPath({ messages, currentTurnId, confirmedPlan: activeConversationConfirmedPlan }),
    [activeConversationConfirmedPlan, currentTurnId, messages],
  );
  const currentShotDesignFinalPath = useMemo(
    () => resolveCurrentShotDesignFinalPath(messages, currentTurnId),
    [currentTurnId, messages],
  );
  const activeDialogueReview = useMemo(
    () => resolveActiveDialogueReview(messages, currentTurnId),
    [currentTurnId, messages],
  );
  const dialogueActionLocked = reviewingDialogue || dialogueReworking;
  const composerLocked = busy || dialogueActionLocked || activeConversationInvalidated;
  const canReviewDialogue = Boolean(activeConversationId)
    && Boolean(currentShotDesignFinalPath)
    && !activeConversationInvalidated
    && !busy
    && !dialogueActionLocked;
  const canReworkDialogue = Boolean(activeConversationId)
    && Boolean(session?.threadId)
    && Boolean(activeDialogueReview?.reviewOutputPath)
    && activeDialogueReview?.decision === "rework"
    && !activeConversationInvalidated
    && !busy
    && !dialogueActionLocked;
  const canRegisterPlanTrace = session?.role === "function-slot-restructure"
    && Boolean(currentRestructureFinalPath)
    && Boolean(activeSlotAtomDisplay?.displayJsonPath)
    && activeSlotAtomDisplay?.status !== "empty"
    && !activeConversationInvalidated
    && !busy
    && !registeringTrace;
  const availableTurnActions = turnActionProjection?.availableActions ?? [];
  const showStopTurn = availableTurnActions.includes("stop_turn");
  const canStopCurrentTurn = busy && showStopTurn && Boolean(session?.threadId) && Boolean(currentTurnId) && !activeConversationInvalidated;

  const applyConversation = useCallback((conversation: AgentChatConversation, refreshed?: ThreadConversation | null) => {
    activeConversationIdRef.current = conversation.conversationId;
    activeConversationRevisionRef.current = normalizeConversationRevision(conversation.revision);
    setActiveConversationId(conversation.conversationId);
    setActiveConversationRevision(normalizeConversationRevision(conversation.revision));
    setActiveConversationInvalidated(Boolean(conversation.invalidated));
    setActiveConversationConfirmedPlan(conversation.confirmedPlan ?? null);
    const nextMode = conversation.source === "threadpool-role" ? "threadpool-role" : "direct";
    modeRef.current = nextMode;
    setMode(nextMode);
    if (conversation.role) {
      selectedRoleRef.current = conversation.role;
      setSelectedRole(conversation.role);
    }
    const nextSession: AgentChatSessionResponse = {
      ok: true,
      source: conversation.source === "threadpool-role" ? "threadpool-role" : "direct",
      status: "resumed",
      threadId: conversation.threadId ?? null,
      traceId: conversation.traceId ?? "",
      runId: conversation.runId ?? "",
      stageId: conversation.stageId ?? "",
      role: conversation.role ?? null,
      ownerId: conversation.ownerId ?? null,
      leaseId: conversation.leaseId ?? null,
      parentThreadId: conversation.parentThreadId ?? null,
      workspaceRoot: conversation.workspaceRoot ?? null,
      skillPath: conversation.skillPath ?? null,
      conversationId: conversation.conversationId,
      conversationStatus: conversation.status,
      conversationRevision: normalizeConversationRevision(conversation.revision),
    };
    sessionRef.current = nextSession;
    setSession(nextSession);
    const refreshedTurns = refreshed?.turns ?? [];
    setCurrentTurnId(conversation.latestTurnId ?? latestVisibleTurnId(refreshedTurns));
    setThreadStopped(Boolean(conversation.threadStopped));
    setTurnActionProjection(null);
    setTimeline(null);
    const persistedMessages = messagesFromConversation(conversation);
    const refreshedMessages = refreshed ? messagesFromThreadConversation(refreshed) : [];
    setMessages(persistedMessages.length ? persistedMessages : refreshedMessages);
  }, []);

  useEffect(() => {
    if (!active) {
      pollGenerationRef.current += 1;
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (warmingResendTimerRef.current) {
        window.clearTimeout(warmingResendTimerRef.current);
        warmingResendTimerRef.current = null;
      }
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    void refreshConversations()
      .then((items) => {
        if (!items.length || creatingDraftConversationRef.current) return;
        const first = items[0];
        setActiveConversationId((current) => current || first.conversationId);
        if (!session && !messages.length) void handleResumeConversation(first.conversationId);
      })
      .catch(() => undefined);
  // handleResumeConversation intentionally runs from the latest closure after it is declared.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, refreshConversations]);

  useEffect(() => {
    if (!active) return;
    if (!session?.threadId || !currentTurnId) return;
    let cancelled = false;
    getAgentChatTurnTimeline(session.threadId, currentTurnId, session.workspaceRoot)
      .then((nextTimeline) => {
        if (!cancelled) setTimeline(nextTimeline);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, currentTurnId, session?.threadId, session?.workspaceRoot]);

  const ensureSession = useCallback(async (forceNew = false, isCurrentAction: () => boolean = () => true) => {
    const currentSession = sessionRef.current;
    if (!forceNew && currentSession?.threadId) return currentSession;
    const currentMode = modeRef.current;
    const currentRole = selectedRoleRef.current;
    setStatusText(currentMode === "threadpool-role" ? "Fork ThreadPool role" : "创建 app-server thread");
    const nextSession = await startAgentChatThread({
      source: currentMode,
      role: currentMode === "threadpool-role" ? currentRole : null,
    });
    if (!nextSession.ok || !nextSession.threadId) throw agentChatSessionError(nextSession);
    if (!isCurrentAction()) return nextSession;
    sessionRef.current = nextSession;
    setSession(nextSession);
    if (nextSession.conversationId) {
      creatingDraftConversationRef.current = false;
      activeConversationIdRef.current = nextSession.conversationId;
      setActiveConversationId(nextSession.conversationId);
      activeConversationRevisionRef.current = nextSession.conversationRevision ?? activeConversationRevisionRef.current;
      setActiveConversationRevision(activeConversationRevisionRef.current);
      setActiveConversationInvalidated(false);
      void refreshConversations().catch(() => undefined);
    }
    setStatusText(nextSession.source === "threadpool-role" ? "forkThread 已连接" : "thread 已连接");
    return nextSession;
  }, [refreshConversations]);

  const schedulePoll = useCallback((activeSession: AgentChatSessionResponse, turnId: string) => {
    if (!active) return;
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    const pollGeneration = pollGenerationRef.current + 1;
    pollGenerationRef.current = pollGeneration;
    const isCurrentPoll = () => pollGeneration === pollGenerationRef.current;
    const poll = async () => {
      try {
        const [turn, nextTimeline] = await Promise.all([
          collectAgentChatTurn(activeSession.threadId as string, turnId, activeSession.workspaceRoot, activeSession.conversationId ?? activeConversationId),
          getAgentChatTurnTimeline(activeSession.threadId as string, turnId, activeSession.workspaceRoot).catch(() => null),
        ]);
        if (!isCurrentPoll()) return;
        if (nextTimeline) setTimeline(nextTimeline);
        setTurnActionProjection(turn.actionProjection ?? null);
        setThreadStopped(Boolean(turn.threadStopped));
        if (turn.conversationRevision) setActiveConversationRevision(turn.conversationRevision);
        applyConversationTitleFromTurn(turn, activeSession.conversationId ?? activeConversationId);
        const activeText = normalizeActiveMessage(turn.activeThreadMessage);
        const finalText = turn.finalMessage || activeText || (isTerminalStatus(turn.status) ? "" : "生成中");
        setMessages((current) => current.map((message) => message.id === `assistant-${turnId}`
          ? {
              ...message,
              text: finalText || message.text,
              status: toChatMessageStatus(turn.status),
              slotAtomDisplay: turn.autoDisplayTransform?.slotAtomDisplay ?? message.slotAtomDisplay ?? null,
              dialogueRoboticReview: turn.autoDialogueRoboticReview ?? message.dialogueRoboticReview ?? null,
            }
          : message));
        if (turn.autoDisplayTransform?.slotAtomDisplay) setRightPanelTab("slotAtom");
        setStatusText(`turn ${turn.status}`);
        if (isTerminalStatus(turn.status)) {
          const autoDialogueRework = turn.autoDialogueRework ?? null;
          if (autoDialogueRework?.ok && autoDialogueRework.turnId) {
            const reworkTurnId = autoDialogueRework.turnId;
            if (autoDialogueRework.conversationRevision) setActiveConversationRevision(autoDialogueRework.conversationRevision);
            setTurnActionProjection(autoDialogueRework.actionProjection ?? turn.actionProjection ?? null);
            setThreadStopped(Boolean(autoDialogueRework.threadStopped));
            setCurrentTurnId(reworkTurnId);
            setMessages((current) => appendAutoDialogueReworkMessages(current, autoDialogueRework, reworkTurnId));
            setStatusText("台词审查建议返工，Agent 正在返工");
            void refreshConversations().catch(() => undefined);
            schedulePoll({
              ...activeSession,
              threadId: autoDialogueRework.threadId ?? activeSession.threadId,
              conversationId: autoDialogueRework.conversationId ?? activeSession.conversationId,
              workspaceRoot: autoDialogueRework.workspaceRoot ?? activeSession.workspaceRoot,
            }, reworkTurnId);
            return;
          }
          if (autoDialogueRework && autoDialogueRework.ok === false) {
            setMessages((current) => current.some((message) => message.id === `system-auto-dialogue-rework-${turnId}`)
              ? current
              : [...current, {
                  id: `system-auto-dialogue-rework-${turnId}`,
                  role: "system",
                  text: autoDialogueRework.message ?? "台词审查建议返工，但自动提交返工失败",
                  status: "failed",
                }]);
          }
          setBusy(false);
          void refreshConversations().catch(() => undefined);
          return;
        }
        if (isCurrentPoll()) pollTimerRef.current = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        if (!isCurrentPoll()) return;
        const message = error instanceof Error ? error.message : "读取回复失败";
        setErrorText(message);
        setMessages((current) => current.map((item) => item.id === `assistant-${turnId}` ? { ...item, text: message, status: "failed" } : item));
        setBusy(false);
        setStatusText("读取失败");
      }
    };
    pollTimerRef.current = window.setTimeout(poll, POLL_INTERVAL_MS);
  }, [active, activeConversationId, applyConversationTitleFromTurn, refreshConversations]);

  useEffect(() => {
    if (!active || !session?.threadId || !currentTurnId || !busy) return;
    schedulePoll(session, currentTurnId);
  }, [active, busy, currentTurnId, schedulePoll, session]);

  useEffect(() => {
    if (!session?.threadId || !currentTurnId || busy || activeConversationInvalidated) return;
    if (!isAssistantTurnRunning(messages, currentTurnId)) return;
    setBusy(true);
    setStatusText("恢复 turn 状态中");
    schedulePoll(session, currentTurnId);
  }, [activeConversationInvalidated, busy, currentTurnId, messages, schedulePoll, session]);

  const beginConversationAction = useCallback(() => {
    const actionGeneration = conversationActionGenerationRef.current + 1;
    conversationActionGenerationRef.current = actionGeneration;
    return () => actionGeneration === conversationActionGenerationRef.current;
  }, []);

  const invalidateConversationActions = useCallback(() => {
    conversationActionGenerationRef.current += 1;
  }, []);

  const resetConversationBusyState = useCallback(() => {
    setBusy(false);
    setCompacting(false);
    setTurnActionBusy(null);
    setConfirming(false);
    setRegisteringTrace(false);
    setReviewingDialogue(false);
    setDialogueReworking(false);
  }, []);

  const maybeCompactBeforeSend = useCallback(async (activeSession: AgentChatSessionResponse, isCurrentAction: () => boolean = () => true) => {
    const usage = contextUsage;
    if (!activeSession.threadId || usage?.contextUsageState !== "danger") return null;
    const usageKey = buildContextUsageKey(activeSession.threadId, usage);
    if (compactedUsageKeysRef.current.has(usageKey)) return null;
    setCompacting(true);
    setStatusText("正在压缩上下文...");
    try {
      const result = await compactAgentChatThread(activeSession.threadId, {
        conversationId: activeSession.conversationId ?? sessionMeta.conversationId,
        expectedRevision: activeConversationRevisionRef.current,
        workspaceRoot: activeSession.workspaceRoot ?? sessionMeta.workspaceRoot,
        contextUsage: usage,
      });
      if (!isCurrentAction()) return result;
      if (!result.compactCompleted) {
        throw new Error(`上下文压缩未确认完成，状态：${result.compactStatus ?? result.status ?? "unknown"}`);
      }
      compactedUsageKeysRef.current.add(usageKey);
      setStatusText("上下文已自动压缩");
      return result;
    } finally {
      if (isCurrentAction()) setCompacting(false);
    }
  }, [activeConversationRevision, contextUsage, sessionMeta.conversationId, sessionMeta.workspaceRoot]);

  const scheduleWarmingResend = useCallback((pending: PendingAgentChatSend) => {
    if (warmingResendTimerRef.current) window.clearTimeout(warmingResendTimerRef.current);
    const pollReady = async () => {
      const currentPending = pendingSendRef.current;
      if (!currentPending || currentPending.generation !== pending.generation) return;
      try {
        const payload = await getThreadPoolRoles();
        const nextRoles = payload.roles ?? [];
        setRoles(nextRoles);
        const roleStatus = nextRoles.find((role) => role.role === currentPending.role);
        if (isThreadPoolRoleReady(roleStatus)) {
          warmingResendTimerRef.current = null;
          setErrorText(null);
          setStatusText("ThreadPool 已就绪，自动重发");
          setMessages((current) => current.map((message) => message.id === `system-warming-${currentPending.userMessageId}`
            ? { ...message, text: "ThreadPool 已就绪，正在自动重发", status: "completed" }
            : message));
          resendPendingRef.current(currentPending);
          return;
        }
        setStatusText("ThreadPool warming 中，等待自动重发");
      } catch {
        setStatusText("ThreadPool warming 中，等待自动重发");
      }
      warmingResendTimerRef.current = window.setTimeout(pollReady, WARMING_RESEND_INTERVAL_MS);
    };
    warmingResendTimerRef.current = window.setTimeout(pollReady, WARMING_RESEND_INTERVAL_MS);
  }, []);

  const handleSend = useCallback(async (pending?: PendingAgentChatSend | null) => {
    const text = (pending?.text ?? draft).trim();
    if (!text || (busy && !pending)) return;
    if (dialogueActionLocked && !pending) return;
    if (activeConversationInvalidated) {
      const message = "thread 已不可读，此会话已失效，请归档后新建会话";
      setErrorText(message);
      setStatusText("会话已失效");
      return;
    }
    const isCurrentAction = beginConversationAction();
    setBusy(true);
    setErrorText(null);
    if (!pending) setDraft("");
    const userMessageId = pending?.userMessageId ?? uniqueId("user");
    setMessages((current) => {
      const existing = current.find((message) => message.id === userMessageId);
      if (existing) {
        return current.map((message) => message.id === userMessageId ? { ...message, status: "completed" } : message);
      }
      return [...current, { id: userMessageId, role: "user", text, status: "completed" }];
    });
    try {
      const activeSession = await ensureSession(false, isCurrentAction);
      if (!isCurrentAction()) return;
      const compacted = await maybeCompactBeforeSend(activeSession, isCurrentAction);
      if (!isCurrentAction()) return;
      const compactRevision = normalizeConversationRevision(compacted?.conversationRevision);
      if (compactRevision) {
        activeConversationRevisionRef.current = compactRevision;
        setActiveConversationRevision(compactRevision);
      }
      if (compacted) {
        setMessages((current) => [...current, { id: uniqueId("system"), role: "system", text: "上下文已自动压缩", status: "completed" }]);
      }
      const sendSession = sessionRef.current?.threadId ? sessionRef.current : activeSession;
      const sendThreadId = sendSession.threadId;
      if (!sendThreadId) throw new Error("当前会话缺少可发送的 thread");
      const revisionForSend = compactRevision ?? activeConversationRevisionRef.current;
      const sendWithRevision = (expectedRevision: number | null) => sendAgentChatMessage(sendThreadId, {
          message: text,
          ...sessionMeta,
          source: sendSession.source,
          role: sendSession.role ?? sessionMeta.role,
          leaseId: sendSession.leaseId ?? sessionMeta.leaseId,
          parentThreadId: sendSession.parentThreadId ?? sessionMeta.parentThreadId,
          conversationId: sendSession.conversationId ?? activeConversationIdRef.current,
          expectedRevision,
          workspaceRoot: sendSession.workspaceRoot ?? sessionMeta.workspaceRoot,
          skillPath: sendSession.skillPath ?? sessionMeta.skillPath,
        });
      let submitted: Awaited<ReturnType<typeof sendAgentChatMessage>>;
      try {
        submitted = await sendWithRevision(revisionForSend);
      } catch (error) {
        if (!isConversationConflictError(error)) throw error;
        const synced = await syncActiveConversationForRetry(sendSession.conversationId ?? activeConversationIdRef.current);
        if (!isCurrentAction()) return;
        setStatusText("会话已同步，重试发送");
        submitted = await sendWithRevision(normalizeConversationRevision(synced?.revision));
      }
      if (!isCurrentAction()) return;
      if (submitted.conversationRevision) {
        activeConversationRevisionRef.current = submitted.conversationRevision;
        setActiveConversationRevision(submitted.conversationRevision);
      }
      applyConversationTitleFromTurn(submitted, sendSession.conversationId ?? activeConversationIdRef.current);
      setTurnActionProjection(submitted.actionProjection ?? null);
      setThreadStopped(Boolean(submitted.threadStopped));
      setCurrentTurnId(submitted.turnId);
      setMessages((current) => [...current, { id: `assistant-${submitted.turnId}`, role: "assistant", text: "生成中", status: "running" }]);
      setStatusText("Agent 回复中");
      if (pendingSendRef.current?.userMessageId === userMessageId) pendingSendRef.current = null;
      if (warmingResendTimerRef.current) {
        window.clearTimeout(warmingResendTimerRef.current);
        warmingResendTimerRef.current = null;
      }
      const pollSession = {
        ...sendSession,
        threadId: submitted.threadId ?? sendSession.threadId,
        conversationId: submitted.conversationId ?? sendSession.conversationId,
        workspaceRoot: submitted.workspaceRoot ?? sendSession.workspaceRoot,
      };
      sessionRef.current = pollSession;
      setSession(pollSession);
      schedulePoll(pollSession, submitted.turnId);
    } catch (error) {
      if (!isCurrentAction()) return;
      const message = isConversationConflictError(error) ? "会话已在其他窗口更新，请重新选择或恢复后再发送" : error instanceof Error ? error.message : "发送失败";
      if (isThreadPoolWarmingError(error) && mode === "threadpool-role") {
        const role = session?.role ?? selectedRole;
        const generation = pending?.generation ?? pendingSendGenerationRef.current + 1;
        pendingSendGenerationRef.current = generation;
        pendingSendRef.current = { text, role, userMessageId, generation };
        setErrorText(`${message}，就绪后将自动重发`);
        setMessages((current) => current.some((item) => item.id === `system-warming-${userMessageId}`)
          ? current.map((item) => item.id === `system-warming-${userMessageId}` ? { ...item, text: `${message}，就绪后将自动重发`, status: "running" } : item)
          : [...current, { id: `system-warming-${userMessageId}`, role: "system", text: `${message}，就绪后将自动重发`, status: "running" }]);
        scheduleWarmingResend({ text, role, userMessageId, generation });
        setStatusText("等待 ThreadPool 就绪后自动重发");
        return;
      }
      setErrorText(message);
      setMessages((current) => [...current, { id: uniqueId("system"), role: "system", text: message, status: "failed" }]);
      if (isConversationConflictError(error)) void refreshConversations().catch(() => undefined);
      setBusy(false);
      setStatusText("发送失败");
    }
  }, [activeConversationId, activeConversationInvalidated, activeConversationRevision, applyConversationTitleFromTurn, beginConversationAction, busy, dialogueActionLocked, draft, ensureSession, maybeCompactBeforeSend, mode, refreshConversations, schedulePoll, scheduleWarmingResend, selectedRole, session?.role, sessionMeta, syncActiveConversationForRetry]);

  useEffect(() => {
    resendPendingRef.current = (pending) => {
      void handleSend(pending);
    };
  }, [handleSend]);

  const submitDialogueReworkFromReview = useCallback(async ({
    review,
    expectedRevision,
    isCurrentAction = beginConversationAction(),
    status = "按审查返工中",
  }: {
    review: AgentChatDialogueRoboticReview;
    expectedRevision?: number | null;
    isCurrentAction?: () => boolean;
    status?: string;
  }) => {
    if (!activeConversationId || !review.reviewOutputPath) return false;
    setDialogueReworking(true);
    setBusy(true);
    setErrorText(null);
    setStatusText(status);
    let submittedTurn = false;
    try {
      const activeSession = await ensureSession(false, isCurrentAction);
      if (!isCurrentAction()) return false;
      if (!activeSession.threadId) throw new Error("当前会话缺少可返工的 thread");
      const compacted = await maybeCompactBeforeSend(activeSession, isCurrentAction);
      if (!isCurrentAction()) return false;
      const compactRevision = normalizeConversationRevision(compacted?.conversationRevision);
      if (compactRevision) setActiveConversationRevision(compactRevision);
      const reworkWithRevision = async (revision: number | null) => submitAgentChatDialogueRework(activeConversationId, {
        ...sessionMeta,
        source: activeSession.source,
        role: activeSession.role ?? sessionMeta.role,
        leaseId: activeSession.leaseId ?? sessionMeta.leaseId,
        threadId: activeSession.threadId,
        turnId: currentTurnId,
        expectedRevision: revision,
        workspaceRoot: activeSession.workspaceRoot ?? sessionMeta.workspaceRoot,
        skillPath: activeSession.skillPath ?? sessionMeta.skillPath,
        shotDesignFinalPath: review.shotDesignFinalPath ?? currentShotDesignFinalPath,
        reviewOutputPath: review.reviewOutputPath,
        decision: review.decision,
        issueCount: review.issueCount,
        parentArtifactId: review.artifactId ?? review.reviewOutputPath,
      });
      let submitted: Awaited<ReturnType<typeof submitAgentChatDialogueRework>>;
      try {
        submitted = await reworkWithRevision(compactRevision ?? expectedRevision ?? activeConversationRevision);
      } catch (error) {
        if (!isConversationConflictError(error)) throw error;
        const synced = await syncActiveConversationForRetry(activeConversationId);
        if (!isCurrentAction()) return false;
        setStatusText("会话已同步，重试返工");
        submitted = await reworkWithRevision(normalizeConversationRevision(synced?.revision));
      }
      if (!isCurrentAction()) return false;
      const userText = submitted.userTurnText ?? buildDialogueReworkPreview(review);
      setMessages((current) => [...current, { id: uniqueId("user"), role: "user", text: userText, status: "completed" }]);
      if (submitted.conversationRevision) setActiveConversationRevision(submitted.conversationRevision);
      setTurnActionProjection(submitted.actionProjection ?? null);
      setThreadStopped(Boolean(submitted.threadStopped));
      setCurrentTurnId(submitted.turnId);
      setMessages((current) => [...current, { id: `assistant-${submitted.turnId}`, role: "assistant", text: "生成中", status: "running" }]);
      setStatusText("Agent 正在按审查返工");
      submittedTurn = true;
      schedulePoll(activeSession, submitted.turnId);
      return true;
    } catch (error) {
      if (!isCurrentAction()) return false;
      const message = isConversationConflictError(error) ? "会话已在其他窗口更新，请恢复后再返工" : error instanceof Error ? error.message : "按审查返工失败";
      setErrorText(message);
      setMessages((current) => [...current, { id: uniqueId("system"), role: "system", text: message, status: "failed" }]);
      setStatusText("按审查返工失败");
      return false;
    } finally {
      if (isCurrentAction()) {
        setDialogueReworking(false);
        if (!submittedTurn) setBusy(false);
      }
    }
  }, [activeConversationId, activeConversationRevision, beginConversationAction, currentShotDesignFinalPath, currentTurnId, ensureSession, maybeCompactBeforeSend, schedulePoll, sessionMeta, syncActiveConversationForRetry]);

  const handleDialogueReview = useCallback(async () => {
    if (!activeConversationId || !currentShotDesignFinalPath || !canReviewDialogue) return;
    const isCurrentAction = beginConversationAction();
    setReviewingDialogue(true);
    setErrorText(null);
    setStatusText("台词审查中");
    try {
      const reviewWithRevision = async (expectedRevision: number | null) => reviewAgentChatDialogue(activeConversationId, {
        turnId: currentTurnId,
        shotDesignFinalPath: currentShotDesignFinalPath,
        parentArtifactId: currentTurnId,
        expectedRevision,
        force: true,
      });
      let result: Awaited<ReturnType<typeof reviewAgentChatDialogue>>;
      try {
        result = await reviewWithRevision(activeConversationRevision);
      } catch (error) {
        if (!isConversationConflictError(error)) throw error;
        const synced = await syncActiveConversationForRetry(activeConversationId);
        if (!isCurrentAction()) return;
        setStatusText("会话已同步，重试台词审查");
        result = await reviewWithRevision(normalizeConversationRevision(synced?.revision));
      }
      if (!isCurrentAction()) return;
      setActiveConversationRevision(normalizeConversationRevision(result.conversationRevision ?? result.conversation?.revision));
      setConversations((current) => current.map((item) => item.conversationId === activeConversationId ? result.conversation : item));
      const review = result.review ?? null;
      setMessages((current) => attachDialogueReviewToMessages(current, currentTurnId, review));
      const reviewRevision = normalizeConversationRevision(result.conversationRevision ?? result.conversation?.revision);
      if (review?.decision === "rework" && review.reviewOutputPath) {
        await submitDialogueReworkFromReview({
          review,
          expectedRevision: reviewRevision,
          isCurrentAction,
          status: "台词审查建议返工，正在提交返工",
        });
      } else {
        setStatusText("台词审查完成");
      }
      void refreshConversations().catch(() => undefined);
    } catch (error) {
      if (!isCurrentAction()) return;
      const message = isConversationConflictError(error) ? "会话已在其他窗口更新，请恢复后再审查" : error instanceof Error ? error.message : "台词审查失败";
      setErrorText(message);
      setMessages((current) => [...current, { id: uniqueId("system"), role: "system", text: message, status: "failed" }]);
      setStatusText("台词审查失败");
    } finally {
      if (isCurrentAction()) setReviewingDialogue(false);
    }
  }, [activeConversationId, activeConversationRevision, beginConversationAction, canReviewDialogue, currentShotDesignFinalPath, currentTurnId, refreshConversations, submitDialogueReworkFromReview, syncActiveConversationForRetry]);

  const handleDialogueRework = useCallback(async () => {
    if (!activeConversationId || !session?.threadId || !activeDialogueReview?.reviewOutputPath || !canReworkDialogue) return;
    void submitDialogueReworkFromReview({
      review: activeDialogueReview,
      expectedRevision: activeConversationRevision,
    });
  }, [activeConversationId, activeConversationRevision, activeDialogueReview, canReworkDialogue, session?.threadId, submitDialogueReworkFromReview]);

  const handleManualReplacementSubmit = useCallback(async (replacementDraft: ReplacementDraft, summary: string) => {
    if (busy) return;
    if (activeConversationInvalidated) {
      const message = "thread 已不可读，此会话已失效，请归档后新建会话";
      setErrorText(message);
      setStatusText("会话已失效");
      return;
    }
    if (!replacementDraft.sourceRestructureFinalPath || !replacementDraft.sourceDisplayJsonPath || !replacementDraft.replacements.length) {
      setErrorText("替换请求缺少源文件或替换项");
      return;
    }
    const isCurrentAction = beginConversationAction();
    setBusy(true);
    setErrorText(null);
    const userMessageId = uniqueId("user");
    setMessages((current) => [...current, { id: userMessageId, role: "user", text: summary || buildReplacementDraftSummary(replacementDraft.replacements), status: "completed" }]);
    try {
      const activeSession = await ensureSession(false, isCurrentAction);
      if (!isCurrentAction()) return;
      const compacted = await maybeCompactBeforeSend(activeSession, isCurrentAction);
      if (!isCurrentAction()) return;
      const compactRevision = normalizeConversationRevision(compacted?.conversationRevision);
      if (compactRevision) setActiveConversationRevision(compactRevision);
      const submitted = await submitAgentChatManualReplacement(activeSession.threadId as string, {
        ...sessionMeta,
        source: activeSession.source,
        conversationId: activeSession.conversationId ?? sessionMeta.conversationId,
        expectedRevision: compactRevision ?? activeConversationRevision,
        workspaceRoot: activeSession.workspaceRoot ?? sessionMeta.workspaceRoot,
        skillPath: activeSession.skillPath ?? sessionMeta.skillPath,
        sourceRestructureFinalPath: replacementDraft.sourceRestructureFinalPath,
        sourceDisplayJsonPath: replacementDraft.sourceDisplayJsonPath,
        displayFingerprint: replacementDraft.displayFingerprint,
        replacements: replacementDraft.replacements,
      });
      if (!isCurrentAction()) return;
      if (submitted.userTurnText) {
        setMessages((current) => current.map((message) => (
          message.id === userMessageId ? { ...message, text: submitted.userTurnText ?? message.text } : message
        )));
      }
      if (submitted.conversationRevision) setActiveConversationRevision(submitted.conversationRevision);
      setTurnActionProjection(submitted.actionProjection ?? null);
      setThreadStopped(Boolean(submitted.threadStopped));
      setCurrentTurnId(submitted.turnId);
      setMessages((current) => [...current, { id: `assistant-${submitted.turnId}`, role: "assistant", text: "生成中", status: "running" }]);
      setStatusText("Agent 正在评估替换");
      schedulePoll(activeSession, submitted.turnId);
    } catch (error) {
      if (!isCurrentAction()) return;
      const message = error instanceof Error ? error.message : "提交替换失败";
      setErrorText(message);
      setMessages((current) => [...current, { id: uniqueId("system"), role: "system", text: message, status: "failed" }]);
      setBusy(false);
      setStatusText("提交替换失败");
    }
  }, [activeConversationInvalidated, activeConversationRevision, beginConversationAction, busy, ensureSession, maybeCompactBeforeSend, schedulePoll, sessionMeta]);

  const startNewConversation = useCallback(() => {
    creatingDraftConversationRef.current = true;
    invalidateConversationActions();
    resetConversationBusyState();
    resumeGenerationRef.current += 1;
    pollGenerationRef.current += 1;
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    sessionRef.current = null;
    setSession(null);
    setMessages([]);
    setDraft("");
    setCurrentTurnId(null);
    setTurnActionProjection(null);
    setThreadStopped(false);
    setTimeline(null);
    compactedUsageKeysRef.current.clear();
    activeConversationIdRef.current = null;
    activeConversationRevisionRef.current = null;
    setActiveConversationId(null);
    setActiveConversationRevision(null);
    setActiveConversationInvalidated(false);
    setActiveConversationConfirmedPlan(null);
    setErrorText(null);
    modeRef.current = "threadpool-role";
    setMode("threadpool-role");
    selectedRoleRef.current = selectedRoleRef.current || "function-slot-restructure";
    setSelectedRole((current) => current || "function-slot-restructure");
    setStatusText("新重组会话");
  }, [invalidateConversationActions, resetConversationBusyState]);

  const handleResumeConversation = useCallback(async (conversationId: string) => {
    creatingDraftConversationRef.current = false;
    invalidateConversationActions();
    resetConversationBusyState();
    const resumeGeneration = resumeGenerationRef.current + 1;
    resumeGenerationRef.current = resumeGeneration;
    pollGenerationRef.current += 1;
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setStatusText("恢复重组会话");
    setErrorText(null);
    try {
      const payload = await resumeAgentChatConversation(conversationId);
      if (resumeGeneration !== resumeGenerationRef.current) return;
      if (payload.deleted) {
        const items = await refreshConversations();
        if (resumeGeneration !== resumeGenerationRef.current) return;
        const next = items.find((item) => item.conversationId !== conversationId) ?? null;
        if (next) {
          const nextPayload = await resumeAgentChatConversation(next.conversationId);
          if (resumeGeneration !== resumeGenerationRef.current) return;
          if (nextPayload.deleted) startNewConversation();
          else applyConversation(nextPayload.conversation, nextPayload.refreshed);
        } else {
          startNewConversation();
        }
        setStatusText("thread 已不存在，会话已删除");
        setErrorText(payload.refreshError?.message ?? "thread 已不存在，会话已删除");
        return;
      }
      applyConversation(payload.conversation, payload.refreshed);
      compactedUsageKeysRef.current.clear();
      if (payload.refreshError?.message) setStatusText(`thread 已不可读，此会话已失效：${payload.refreshError.message}`);
      else setStatusText("已恢复重组会话");
    } catch (error) {
      const message = error instanceof Error ? error.message : "恢复会话失败";
      setErrorText(message);
      setStatusText("恢复失败");
    }
  }, [applyConversation, invalidateConversationActions, refreshConversations, resetConversationBusyState, startNewConversation]);

  const handleArchiveConversation = useCallback(async () => {
    if (!activeConversationId) return;
    invalidateConversationActions();
    resetConversationBusyState();
    pollGenerationRef.current += 1;
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setStatusText("归档重组会话");
    try {
      try {
        await archiveAgentChatConversation(activeConversationId, activeConversationRevision);
      } catch (error) {
        if (!isConversationConflictError(error)) throw error;
        const synced = await syncActiveConversationForRetry(activeConversationId);
        setStatusText("会话已同步，重试归档");
        await archiveAgentChatConversation(activeConversationId, normalizeConversationRevision(synced?.revision));
      }
      const items = await refreshConversations();
      const next = items[0] ?? null;
      activeConversationIdRef.current = next?.conversationId ?? null;
      setActiveConversationId(next?.conversationId ?? null);
      if (next) {
        const payload = await resumeAgentChatConversation(next.conversationId);
        applyConversation(payload.conversation, payload.refreshed);
      } else {
        startNewConversation();
      }
      setStatusText("已归档");
    } catch (error) {
      const message = isConversationConflictError(error) ? "会话已在其他窗口更新，请刷新后再归档" : error instanceof Error ? error.message : "归档失败";
      setErrorText(message);
      if (isConversationConflictError(error)) void refreshConversations().catch(() => undefined);
      setStatusText("归档失败");
    }
  }, [activeConversationId, activeConversationRevision, applyConversation, invalidateConversationActions, refreshConversations, resetConversationBusyState, startNewConversation, syncActiveConversationForRetry]);

  const handleRelease = useCallback(async () => {
    if (!session?.leaseId) return;
    invalidateConversationActions();
    resetConversationBusyState();
    pollGenerationRef.current += 1;
    setStatusText("释放 lease");
    try {
      await releaseAgentChatLease(session.leaseId, session.ownerId, session.conversationId);
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      const releasedConversationId = session.conversationId ?? activeConversationId;
      const items = await refreshConversations();
      const next = items.find((item) => item.conversationId !== releasedConversationId) ?? null;
      if (next) {
        const payload = await resumeAgentChatConversation(next.conversationId);
        if (payload.deleted) startNewConversation();
        else applyConversation(payload.conversation, payload.refreshed);
      } else {
        startNewConversation();
      }
      setErrorText(null);
      setStatusText("lease 已释放，会话已删除");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "释放 lease 失败");
      setStatusText("释放失败");
    }
  }, [activeConversationId, applyConversation, invalidateConversationActions, refreshConversations, resetConversationBusyState, session, startNewConversation]);

  const stopPolling = useCallback(() => {
    pollGenerationRef.current += 1;
    if (!pollTimerRef.current) return;
    window.clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const handleStopTurn = useCallback(async () => {
    if (!session?.threadId || !currentTurnId || turnActionBusy) return;
    setTurnActionBusy("stop_turn");
    setErrorText(null);
    setStatusText("停止当前 turn");
    stopPolling();
    const isCurrentAction = beginConversationAction();
    try {
      const response = await stopAgentChatTurn(session.threadId, currentTurnId, {
        conversationId: session.conversationId ?? activeConversationId,
        expectedRevision: activeConversationRevision,
        workspaceRoot: session.workspaceRoot,
        reason: "manual stop",
      });
      if (!isCurrentAction()) return;
      setTurnActionProjection(response.actionProjection ?? null);
      setThreadStopped(Boolean(response.threadStopped));
      if (response.conversationRevision) setActiveConversationRevision(response.conversationRevision);
      setMessages((current) => current.map((message) => message.id === `assistant-${currentTurnId}`
        ? { ...message, text: "已停止当前 turn", status: "canceled" }
        : message));
      setBusy(false);
      setStatusText("turn 已停止");
      void refreshConversations().catch(() => undefined);
    } catch (error) {
      if (!isCurrentAction()) return;
      setErrorText(error instanceof Error ? error.message : "停止 turn 失败");
      setStatusText("停止失败");
    } finally {
      if (isCurrentAction()) setTurnActionBusy(null);
    }
  }, [activeConversationId, activeConversationRevision, beginConversationAction, currentTurnId, refreshConversations, session, stopPolling, turnActionBusy]);

  const handleConfirmRestructure = useCallback(async () => {
    if (!session?.threadId || !currentTurnId || !canConfirmRestructure) return;
    setConfirming(true);
    setErrorText(null);
    setStatusText("确认方案并触发故事板流水线");
    try {
      const confirmWithRevision = async (
        payload: NonNullable<Parameters<typeof confirmAgentChatConversation>[1]>,
        expectedRevision: number | null,
      ) => {
        if (!session.conversationId) return null;
        try {
          return await confirmAgentChatConversation(session.conversationId, { ...payload, expectedRevision });
        } catch (error) {
          if (!isConversationConflictError(error)) throw error;
          const synced = await syncActiveConversationForRetry(session.conversationId);
          setStatusText("会话已同步，重试确认");
          return await confirmAgentChatConversation(session.conversationId, {
            ...payload,
            expectedRevision: normalizeConversationRevision(synced?.revision),
          });
        }
      };
      const sourceRestructurePath = resolveCurrentRestructureFinalPath({
        messages,
        currentTurnId,
        confirmedPlan: activeConversationConfirmedPlan,
      });
      if (!sourceRestructurePath) throw new Error("未找到当前方案的 restructure.final.md 路径，请先让 Agent 生成并落盘重组方案。");
      const confirmationId = buildConfirmationId(currentTurnId);
      let confirmationRevision = activeConversationRevision;
      if (session.conversationId) {
        const gate = await confirmWithRevision(
          {
            turnId: currentTurnId,
            confirmationId,
            sourceRestructurePath,
            sourceShotDesignPath: currentShotDesignFinalPath,
            note: "用户已确认当前重组方案，准备触发 Shot Storyboard Prep 流水线。",
          },
          activeConversationRevision,
        );
        confirmationRevision = normalizeConversationRevision(gate?.conversation.revision);
        setActiveConversationRevision(confirmationRevision);
        setActiveConversationConfirmedPlan(gate?.conversation.confirmedPlan ?? null);
      }
      const payload = {
        sampleVideoId: "function-slot-workflow",
        restructureFinalPath: sourceRestructurePath,
        shotDesignFinalPath: currentShotDesignFinalPath,
        restructureArtifactId: currentTurnId,
        parentArtifactId: currentTurnId,
        confirmationId,
        conversationId: session.conversationId,
        runImageGeneration: true,
      };
      const storyboardResult = await autoRunShotStoryboardPrep(payload);
      const storyboardJobLabel = storyboardResult.processingJobId ? `job ${shortId(storyboardResult.processingJobId)}` : `artifact ${shortId(storyboardResult.artifactId)}`;
      setMessages((current) => [...current, {
        id: uniqueId("system"),
        role: "system",
        text: `已确认当前方案，确认版本 ${shortId(confirmationId)}，已启动故事板准备流水线：${storyboardJobLabel} / trace ${shortId(storyboardResult.traceId)}`,
        status: "completed",
      }]);
      if (session.conversationId) {
        const logged = await confirmWithRevision(
          {
            turnId: currentTurnId,
            confirmationId,
            sourceRestructurePath,
            sourceShotDesignPath: currentShotDesignFinalPath,
            note: "已确认当前方案，已触发 Shot Storyboard Prep 流水线。",
            storyboardArtifact: {
              artifactId: storyboardResult.artifactId,
              processingJobId: storyboardResult.processingJobId,
              traceId: storyboardResult.traceId,
              runId: storyboardResult.runId,
              stageId: storyboardResult.stageId,
              status: storyboardResult.status,
            },
            status: storyboardResult.status === "processed" ? "completed" : storyboardResult.status === "failed" ? "storyboard_failed" : "storyboard_processing",
          },
          confirmationRevision,
        );
        setActiveConversationRevision(normalizeConversationRevision(logged?.conversation.revision));
        setActiveConversationConfirmedPlan(logged?.conversation.confirmedPlan ?? null);
        void refreshConversations().catch(() => undefined);
      }
      setStatusText("已触发故事板准备流水线");
    } catch (error) {
      const message = isConversationConflictError(error) ? "会话已在其他窗口更新，请重新恢复后再确认" : error instanceof Error ? error.message : "确认方案失败";
      setErrorText(message);
      if (isConversationConflictError(error)) void refreshConversations().catch(() => undefined);
      setStatusText("确认失败");
    } finally {
      setConfirming(false);
    }
  }, [activeConversationConfirmedPlan, activeConversationId, activeConversationRevision, canConfirmRestructure, currentTurnId, messages, refreshConversations, session, syncActiveConversationForRetry]);

  const handleRegisterPlanTrace = useCallback(async () => {
    if (!canRegisterPlanTrace || !currentRestructureFinalPath || !activeSlotAtomDisplay?.displayJsonPath) return;
    setRegisteringTrace(true);
    setErrorText(null);
    setStatusText("登记当前方案到溯源图");
    try {
      const result = await registerFunctionSlotConfirmedPlanTrace({
        restructureFinalPath: currentRestructureFinalPath,
        displayJsonPath: activeSlotAtomDisplay.displayJsonPath,
        sourceTurnId: currentTurnId,
        parentArtifactId: currentTurnId,
        confirmationId: activeConversationConfirmedPlan?.confirmationId ?? undefined,
      });
      if (!result.ok) throw new Error(result.message ?? "登记溯源图失败");
      setStatusText(`已进入溯源图：${result.planId ?? "当前方案"}`);
      window.dispatchEvent(new CustomEvent("function-slot-plan-trace-updated"));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "登记溯源图失败");
      setStatusText("登记溯源图失败");
    } finally {
      setRegisteringTrace(false);
    }
  }, [activeConversationConfirmedPlan?.confirmationId, activeSlotAtomDisplay?.displayJsonPath, activeSlotAtomDisplay?.status, canRegisterPlanTrace, currentRestructureFinalPath, currentTurnId]);

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
        <SplitResizeHandle
          className="workspace-resize-handle agent-chat-resizer agent-chat-left-resizer"
          label="调整重组会话列表宽度"
          orientation="vertical"
          onResizeStart={(event) => layout.startResize("left", event)}
          onReset={() => layout.resetSize("left")}
          onNudge={(direction) => layout.nudgeSize("left", direction)}
        />
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
                <>
                  <button className="ghost-button agent-chat-action" type="button" disabled={!canReviewDialogue} onClick={() => void handleDialogueReview()} title={currentShotDesignFinalPath ? "审查当前 shot-design.final.md 台词自然度" : "需要当前对话里有 shot-design.final.md 路径"}>
                    {reviewingDialogue ? "审查中" : "审查台词"}
                  </button>
                </>
              ) : null}
              {session?.role === "function-slot-restructure" ? (
                <>
                  <button className="ghost-button agent-chat-action" type="button" disabled={!canRegisterPlanTrace} onClick={() => void handleRegisterPlanTrace()} title={canRegisterPlanTrace ? "登记当前方案到确定方案溯源图" : "需要当前方案已自动生成 restructure.display.json"}>
                    {registeringTrace ? "登记中" : "进入溯源图"}
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
                {message.dialogueRoboticReview ? (
                  <DialogueReviewSummary
                    review={message.dialogueRoboticReview}
                    canRework={message.dialogueRoboticReview === activeDialogueReview && canReworkDialogue}
                    reworking={dialogueReworking}
                    onRework={handleDialogueRework}
                  />
                ) : null}
              </article>
            )) : <div className="empty-state"><strong>还没有对话</strong><span>输入一条消息后会通过 app-server 发送</span></div>}
          </div>
          {errorText ? <div className="agent-chat-error">{errorText}</div> : null}
          <form className="agent-chat-composer" onSubmit={(event) => { event.preventDefault(); if (!canStopCurrentTurn) void handleSend(); }}>
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
        <SplitResizeHandle
          className="workspace-resize-handle agent-chat-resizer agent-chat-right-resizer"
          label="调整 Timeline 宽度"
          orientation="vertical"
          onResizeStart={(event) => layout.startResize("right", event)}
          onReset={() => layout.resetSize("right")}
          onNudge={(direction) => layout.nudgeSize("right", direction)}
        />
        <aside className="agent-chat-timeline" aria-label="Agent timeline">
          <div className="agent-chat-side-tabs" role="tablist" aria-label="右侧信息面板">
            <button
              className={rightPanelTab === "timeline" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={rightPanelTab === "timeline"}
              onClick={() => setRightPanelTab("timeline")}
            >
              Timeline
            </button>
            <button
              className={rightPanelTab === "slotAtom" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={rightPanelTab === "slotAtom"}
              onClick={() => setRightPanelTab("slotAtom")}
            >
              Slot/Atom
            </button>
          </div>
          {rightPanelTab === "timeline" ? <TimelineView timeline={timeline} /> : (
            <SlotAtomView
              display={activeSlotAtomDisplay}
              busy={busy}
              sourceRestructureFinalPath={currentRestructureFinalPath}
              onSubmitReplacement={handleManualReplacementSubmit}
            />
          )}
        </aside>
      </main>
    </div>
  );
}

function TimelineView({ timeline }: { timeline: AgentTurnTimeline | null }) {
  if (!timeline) return <div className="empty-state"><strong>等待 turn</strong><span>发送后会显示模型、工具和消息追踪</span></div>;
  return (
    <div className="agent-chat-timeline-list">
      <div className="agent-chat-timeline-summary">
        <b>{timeline.status}</b>
        <span>{timeline.items.length} items</span>
      </div>
      {timeline.items.map((item) => (
        <article key={item.id} className={`agent-timeline-item ${item.status ?? "unknown"}`}>
          <div>
            <b>{item.title}</b>
            <span>{item.kind}</span>
          </div>
          {item.textPreview ? <p>{item.textPreview}</p> : null}
        </article>
      ))}
    </div>
  );
}

function DialogueReviewSummary({
  review,
  canRework,
  reworking,
  onRework,
}: {
  review: AgentChatDialogueRoboticReview;
  canRework: boolean;
  reworking: boolean;
  onRework: () => void;
}) {
  const decision = review.decision ?? "unknown";
  const issueCount = Number.isFinite(Number(review.issueCount)) ? Number(review.issueCount) : 0;
  return (
    <div className={`agent-chat-dialogue-review ${decision}`}>
      <div>
        <b>台词审查</b>
        <span>{formatDialogueReviewDecision(decision)} · {issueCount} issue{issueCount === 1 ? "" : "s"}</span>
      </div>
      <small>{review.reviewOutputPath ? `review ${review.reviewOutputPath}` : review.status ?? "processed"}</small>
      {decision === "rework" ? (
        <button className="ghost-button agent-chat-action" type="button" disabled={!canRework || reworking} onClick={onRework}>
          {reworking ? "返工中" : "按审查返工"}
        </button>
      ) : null}
    </div>
  );
}

function formatDialogueReviewDecision(value?: string | null) {
  if (value === "pass") return "通过";
  if (value === "rework") return "建议返工";
  if (value === "blocked") return "阻塞";
  return value ?? "未知";
}

function ContextUsageIndicator({ usage }: { usage: AgentTurnTimeline["activity"]["tokenUsage"] | null }) {
  const ratio = typeof usage?.contextUsageRatio === "number" && Number.isFinite(usage.contextUsageRatio)
    ? Math.max(0, Math.min(1, usage.contextUsageRatio))
    : null;
  const percent = ratio == null ? "--" : String(Math.round(ratio * 100));
  const progress = ratio == null ? 0 : Math.round(ratio * 100);
  const state = usage?.contextUsageState ?? "unknown";
  return (
    <span
      className={`agent-chat-context-usage ${state}`}
      title={formatContextUsageTitle(usage)}
      style={{ "--context-progress": `${progress}%` } as CSSProperties}
    >
      <b>{percent}% used</b>
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

function normalizeActiveMessage(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) return String((value as { text?: unknown }).text ?? "");
  return "";
}

function isTerminalStatus(status: string | null | undefined) {
  return ["completed", "complete", "failed", "cancelled", "canceled"].includes(String(status ?? "").toLowerCase());
}

function toChatMessageStatus(status: string | null | undefined): ChatMessage["status"] {
  const value = String(status ?? "").trim().toLowerCase();
  if (value === "canceled" || value === "cancelled") return "canceled";
  if (value === "failed" || value === "error" || value === "errored") return "failed";
  return isTerminalStatus(value) ? "completed" : "running";
}

function messagesFromConversation(conversation: AgentChatConversation): ChatMessage[] {
  return (conversation.messages ?? []).map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    status: message.status ?? "completed",
    slotAtomDisplay: message.slotAtomDisplay ?? null,
    dialogueRoboticReview: message.dialogueRoboticReview ?? null,
  }));
}

function isAssistantTurnRunning(messages: ChatMessage[], turnId: string | null) {
  if (!turnId) return false;
  return messages.some((message) => (
    message.id === `assistant-${turnId}`
    && message.role === "assistant"
    && message.status === "running"
  ));
}

function messagesFromThreadConversation(conversation: ThreadConversation): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of conversation.turns ?? []) {
    if (isAgentChatBootstrapTurn(turn)) continue;
    if (turn.inputSummary) {
      messages.push({
        id: `user-${turn.turnId}`,
        role: "user",
        text: turn.inputSummary,
        status: "completed",
      });
    }
    const threadMessages = turn.threadMessages ?? [];
    const assistantText = turn.finalMessage || threadMessages[threadMessages.length - 1]?.text || null;
    if (assistantText) {
      messages.push({
        id: `assistant-${turn.turnId}`,
        role: "assistant",
        text: assistantText,
        status: isTerminalStatus(turn.status) ? "completed" : "running",
      });
    }
  }
  return messages;
}

function latestVisibleTurnId(turns: ThreadConversation["turns"] = []) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!isAgentChatBootstrapTurn(turn)) return turn.turnId ?? null;
  }
  return null;
}

function isAgentChatBootstrapTurn(turn: NonNullable<ThreadConversation["turns"]>[number]) {
  const inputText = String(turn.inputSummary ?? "").trim();
  const finalText = String(turn.finalMessage ?? "").trim();
  return Boolean(
    inputText.includes("初始化阶段阅读")
    || inputText.includes("你是功能槽位结构重组对话 Agent")
    || (finalText === "已就绪" && inputText.includes("Agent"))
  );
}

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveActiveSlotAtomDisplay(messages: ChatMessage[], currentTurnId: string | null) {
  const current = currentTurnId
    ? messages.find((message) => message.id === `assistant-${currentTurnId}` && message.slotAtomDisplay)?.slotAtomDisplay ?? null
    : null;
  if (current) return current;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const display = messages[index].slotAtomDisplay;
    if (display) return display;
  }
  return null;
}

function resolveActiveDialogueReview(messages: ChatMessage[], currentTurnId: string | null) {
  const current = currentTurnId
    ? messages.find((message) => message.id === `assistant-${currentTurnId}` && message.dialogueRoboticReview)?.dialogueRoboticReview ?? null
    : null;
  if (current) return current;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const review = messages[index].dialogueRoboticReview;
    if (review) return review;
  }
  return null;
}

function attachDialogueReviewToMessages(messages: ChatMessage[], currentTurnId: string | null, review: AgentChatDialogueRoboticReview | null): ChatMessage[] {
  if (!review) return messages;
  const targetId = currentTurnId ? `assistant-${currentTurnId}` : null;
  const targetIndex = targetId ? messages.findIndex((message) => message.id === targetId) : -1;
  if (targetIndex >= 0) {
    return messages.map((message, index) => index === targetIndex ? { ...message, dialogueRoboticReview: review } : message);
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      return messages.map((message, cursor) => cursor === index ? { ...message, dialogueRoboticReview: review } : message);
    }
  }
  return [...messages, {
    id: uniqueId("assistant-dialogue-review"),
    role: "assistant",
    text: "台词机器人感审查已完成",
    status: "completed",
    dialogueRoboticReview: review,
  }];
}

function appendAutoDialogueReworkMessages(
  messages: ChatMessage[],
  rework: NonNullable<AgentChatTurnResponse["autoDialogueRework"]>,
  turnId: string,
): ChatMessage[] {
  const next = [...messages];
  if (!next.some((message) => message.id === `user-${turnId}`)) {
    next.push({
      id: `user-${turnId}`,
      role: "user",
      text: rework.userTurnText ?? "根据台词机器人感审查结果返工当前 Shot 设计台词。",
      status: "completed",
    });
  }
  if (!next.some((message) => message.id === `assistant-${turnId}`)) {
    next.push({
      id: `assistant-${turnId}`,
      role: "assistant",
      text: "生成中",
      status: "running",
    });
  }
  return next;
}

function buildConfirmationId(turnId: string | null) {
  const suffix = String(turnId ?? "turn").replace(/[^A-Za-z0-9_.-]+/g, "").slice(-8) || "turn";
  return `confirm_${suffix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveCurrentRestructureFinalPath({
  messages,
  currentTurnId,
  confirmedPlan,
}: {
  messages: ChatMessage[];
  currentTurnId: string | null;
  confirmedPlan: AgentChatConversation["confirmedPlan"];
}) {
  const reversed = [...messages].reverse();
  const currentAssistantPath = normalizeRestructureFinalPath(extractRestructureFinalPath(
    reversed.find((message) => message.id === `assistant-${currentTurnId}`)?.text,
  ));
  if (currentAssistantPath) return currentAssistantPath;
  for (const message of reversed) {
    if (message.role !== "assistant") continue;
    const path = normalizeRestructureFinalPath(extractRestructureFinalPath(message.text));
    if (path) return path;
  }
  return normalizeRestructureFinalPath(confirmedPlan?.sourceRestructurePath);
}

function resolveCurrentShotDesignFinalPath(messages: ChatMessage[], currentTurnId: string | null) {
  const reversed = [...messages].reverse();
  const currentAssistantPath = normalizeShotDesignFinalPath(extractShotDesignFinalPath(
    reversed.find((message) => message.id === `assistant-${currentTurnId}`)?.text,
  ));
  if (currentAssistantPath) return currentAssistantPath;
  for (const message of reversed) {
    if (message.dialogueRoboticReview?.shotDesignFinalPath) return normalizeShotDesignFinalPath(message.dialogueRoboticReview.shotDesignFinalPath);
    if (message.role !== "assistant") continue;
    const path = normalizeShotDesignFinalPath(extractShotDesignFinalPath(message.text));
    if (path) return path;
  }
  return null;
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

function normalizeShotDesignFinalPath(pathText?: string | null) {
  const text = String(pathText ?? "").trim();
  if (!text) return null;
  const normalized = text.replace(/\\/g, "/").replace(/^\/*[A-Za-z]:\//, "");
  const marker = "Artifacts/FunctionSlotRestructure/";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index) : normalized;
}

function buildDialogueReworkPreview(review: AgentChatDialogueRoboticReview) {
  return [
    "根据台词机器人感审查结果返工当前 Shot 设计台词。",
    review.shotDesignFinalPath ? `shot-design: ${review.shotDesignFinalPath}` : null,
    review.reviewOutputPath ? `review: ${review.reviewOutputPath}` : null,
    review.decision ? `decision: ${review.decision}` : null,
  ].filter(Boolean).join("\n");
}

function normalizeConversationRevision(value: unknown) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : null;
}

function buildContextUsageKey(threadId: string, usage: NonNullable<AgentTurnTimeline["activity"]["tokenUsage"]>) {
  return [
    threadId,
    usage.inputTokens ?? "input_unknown",
    usage.modelContextWindow ?? "window_unknown",
    usage.contextThresholdTokens ?? "threshold_unknown",
  ].join(":");
}

function isConversationConflictError(error: unknown) {
  const apiError = error as { statusCode?: unknown; code?: unknown } | null;
  if (!apiError || typeof apiError !== "object") return false;
  return apiError.statusCode === 409 || String(apiError.code ?? "").includes("conversation_revision_conflict") || String(apiError.code ?? "").includes("conversation_archived");
}

function isThreadPoolWarmingError(error: unknown) {
  const apiError = error as { code?: unknown; retryable?: unknown; message?: unknown } | null;
  if (!apiError || typeof apiError !== "object") return false;
  const code = String(apiError.code ?? "");
  const message = String(apiError.message ?? "");
  return code === "threadpool_warming" || (Boolean(apiError.retryable) && message.includes("warming"));
}

function isThreadPoolRoleReady(role?: ThreadPoolRoleSummary | null) {
  if (!role) return false;
  return Boolean(role.canAcquire) && role.readyForLeases !== false && !role.warming && !role.recovering && !role.seedMissing;
}

function agentChatSessionError(session: AgentChatSessionResponse) {
  const error = new Error(session.message || "Agent 会话创建失败") as Error & { code?: string; retryable?: boolean | null };
  error.code = session.error || "agent_chat_session_failed";
  error.retryable = session.retryable ?? null;
  return error;
}

