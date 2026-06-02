import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { archiveAgentChatConversation, autoRunRestructureDisplayTransform, autoRunShotStoryboardPrep, collectAgentChatTurn, compactAgentChatThread, confirmAgentChatConversation, getAgentChatTurnTimeline, getThreadPoolRoles, listAgentChatConversations, registerFunctionSlotConfirmedPlanTrace, releaseAgentChatLease, resumeAgentChatConversation, sendAgentChatMessage, startAgentChatThread, stopAgentChatTurn, submitAgentChatManualReplacement, type AgentChatActionProjection, type AgentChatSessionResponse } from "../api/client";
import type { AgentChatConversation, AgentChatSlotAtomDisplay, AgentTurnTimeline, ReplacementDraft, ThreadConversation, ThreadPoolRoleSummary } from "../types";
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
};

const POLL_INTERVAL_MS = 1800;
const AUTO_TURN_MAX_POLLS = 80;

export function AgentChatApp({ embedded = false }: { embedded?: boolean }) {
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
  const [errorText, setErrorText] = useState<string | null>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollGenerationRef = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);
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

  useEffect(() => () => {
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
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
    setActiveConversationId(conversation.conversationId);
    setActiveConversationRevision(normalizeConversationRevision(conversation.revision));
    setActiveConversationInvalidated(Boolean(conversation.invalidated));
    setActiveConversationConfirmedPlan(conversation.confirmedPlan ?? null);
    setMode(conversation.source === "threadpool-role" ? "threadpool-role" : "direct");
    if (conversation.role) setSelectedRole(conversation.role);
    setSession({
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
    });
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
  }, [refreshConversations]);

  useEffect(() => {
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
  }, [currentTurnId, session?.threadId, session?.workspaceRoot]);

  const ensureSession = useCallback(async (forceNew = false, isCurrentAction: () => boolean = () => true) => {
    if (!forceNew && session?.threadId) return session;
    setStatusText(mode === "threadpool-role" ? "Fork ThreadPool role" : "创建 app-server thread");
    const nextSession = await startAgentChatThread({
      source: mode,
      role: mode === "threadpool-role" ? selectedRole : null,
    });
    if (!nextSession.ok || !nextSession.threadId) throw new Error(nextSession.message || "Agent 会话创建失败");
    if (!isCurrentAction()) return nextSession;
    setSession(nextSession);
    if (nextSession.conversationId) {
      creatingDraftConversationRef.current = false;
      setActiveConversationId(nextSession.conversationId);
      setActiveConversationRevision(nextSession.conversationRevision ?? activeConversationRevision);
      setActiveConversationInvalidated(false);
      void refreshConversations().catch(() => undefined);
    }
    setStatusText(nextSession.source === "threadpool-role" ? "forkThread 已连接" : "thread 已连接");
    return nextSession;
  }, [activeConversationRevision, mode, refreshConversations, selectedRole, session]);

  const schedulePoll = useCallback((activeSession: AgentChatSessionResponse, turnId: string) => {
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
        const activeText = normalizeActiveMessage(turn.activeThreadMessage);
        const finalText = turn.finalMessage || activeText || (isTerminalStatus(turn.status) ? "" : "生成中");
        setMessages((current) => current.map((message) => message.id === `assistant-${turnId}`
          ? {
              ...message,
              text: finalText || message.text,
              status: toChatMessageStatus(turn.status),
              slotAtomDisplay: turn.autoDisplayTransform?.slotAtomDisplay ?? message.slotAtomDisplay ?? null,
            }
          : message));
        if (turn.autoDisplayTransform?.slotAtomDisplay) setRightPanelTab("slotAtom");
        setStatusText(`turn ${turn.status}`);
        if (isTerminalStatus(turn.status)) {
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
  }, [activeConversationId, refreshConversations]);

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
        expectedRevision: activeConversationRevision,
        workspaceRoot: activeSession.workspaceRoot ?? sessionMeta.workspaceRoot,
        contextUsage: usage,
      });
      if (!isCurrentAction()) return result;
      compactedUsageKeysRef.current.add(usageKey);
      setStatusText("上下文已自动压缩");
      return result;
    } finally {
      if (isCurrentAction()) setCompacting(false);
    }
  }, [activeConversationRevision, contextUsage, sessionMeta.conversationId, sessionMeta.workspaceRoot]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (activeConversationInvalidated) {
      const message = "thread 已不可读，此会话已失效，请归档后新建会话";
      setErrorText(message);
      setStatusText("会话已失效");
      return;
    }
    const isCurrentAction = beginConversationAction();
    setBusy(true);
    setErrorText(null);
    setDraft("");
    setMessages((current) => [...current, { id: uniqueId("user"), role: "user", text, status: "completed" }]);
    try {
      const activeSession = await ensureSession(false, isCurrentAction);
      if (!isCurrentAction()) return;
      const compacted = await maybeCompactBeforeSend(activeSession, isCurrentAction);
      if (!isCurrentAction()) return;
      const compactRevision = normalizeConversationRevision(compacted?.conversationRevision);
      if (compactRevision) setActiveConversationRevision(compactRevision);
      if (compacted) {
        setMessages((current) => [...current, { id: uniqueId("system"), role: "system", text: "上下文已自动压缩", status: "completed" }]);
      }
      const revisionForSend = compactRevision ?? activeConversationRevision;
      const sendWithRevision = (expectedRevision: number | null) => sendAgentChatMessage(activeSession.threadId as string, {
          message: text,
          ...sessionMeta,
          source: activeSession.source,
          role: activeSession.role ?? sessionMeta.role,
          leaseId: activeSession.leaseId ?? sessionMeta.leaseId,
          parentThreadId: activeSession.parentThreadId ?? sessionMeta.parentThreadId,
          conversationId: activeSession.conversationId ?? sessionMeta.conversationId,
          expectedRevision,
          workspaceRoot: activeSession.workspaceRoot ?? sessionMeta.workspaceRoot,
          skillPath: activeSession.skillPath ?? sessionMeta.skillPath,
        });
      let submitted: Awaited<ReturnType<typeof sendAgentChatMessage>>;
      try {
        submitted = await sendWithRevision(revisionForSend);
      } catch (error) {
        if (!isConversationConflictError(error)) throw error;
        const synced = await syncActiveConversationForRetry(activeSession.conversationId ?? activeConversationId);
        if (!isCurrentAction()) return;
        setStatusText("会话已同步，重试发送");
        submitted = await sendWithRevision(normalizeConversationRevision(synced?.revision));
      }
      if (!isCurrentAction()) return;
      if (submitted.conversationRevision) setActiveConversationRevision(submitted.conversationRevision);
      setTurnActionProjection(submitted.actionProjection ?? null);
      setThreadStopped(Boolean(submitted.threadStopped));
      setCurrentTurnId(submitted.turnId);
      setMessages((current) => [...current, { id: `assistant-${submitted.turnId}`, role: "assistant", text: "生成中", status: "running" }]);
      setStatusText("Agent 回复中");
      schedulePoll(activeSession, submitted.turnId);
    } catch (error) {
      if (!isCurrentAction()) return;
      const message = isConversationConflictError(error) ? "会话已在其他窗口更新，请重新选择或恢复后再发送" : error instanceof Error ? error.message : "发送失败";
      setErrorText(message);
      setMessages((current) => [...current, { id: uniqueId("system"), role: "system", text: message, status: "failed" }]);
      if (isConversationConflictError(error)) void refreshConversations().catch(() => undefined);
      setBusy(false);
      setStatusText("发送失败");
    }
  }, [activeConversationId, activeConversationInvalidated, activeConversationRevision, beginConversationAction, busy, draft, ensureSession, maybeCompactBeforeSend, refreshConversations, schedulePoll, sessionMeta, syncActiveConversationForRetry]);

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
    setSession(null);
    setMessages([]);
    setDraft("");
    setCurrentTurnId(null);
    setTurnActionProjection(null);
    setThreadStopped(false);
    setTimeline(null);
    compactedUsageKeysRef.current.clear();
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setActiveConversationRevision(null);
    setActiveConversationInvalidated(false);
    setActiveConversationConfirmedPlan(null);
    setErrorText(null);
    setMode("threadpool-role");
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
    setStatusText("确认方案并触发展示转换/故事板准备与生图");
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
            note: "用户已确认当前重组方案，准备触发结构展示转换和 Shot Storyboard Prep 生图。",
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
        restructureArtifactId: currentTurnId,
        parentArtifactId: currentTurnId,
        confirmationId,
        runImageGeneration: true,
      };
      const [displayResult, storyboardResult] = await Promise.all([
        autoRunRestructureDisplayTransform(payload),
        autoRunShotStoryboardPrep(payload),
      ]);
      if (displayResult.threadId && displayResult.turnId) {
        void collectAutoDisplayTransformTurn(displayResult, payload)
          .then((materialized) => {
            if (materialized?.ok) window.dispatchEvent(new CustomEvent("function-slot-plan-trace-updated"));
          })
          .catch(() => undefined);
      }
      setMessages((current) => [...current, {
        id: uniqueId("system"),
        role: "system",
        text: `已确认当前方案，确认版本 ${shortId(confirmationId)}，已提交两个真实 turn：展示 ${shortId(displayResult.threadId)} / ${shortId(displayResult.turnId)} / trace ${shortId(displayResult.traceId)}；故事板准备与生图 ${shortId(storyboardResult.threadId)} / ${shortId(storyboardResult.turnId)} / trace ${shortId(storyboardResult.traceId)}`,
        status: "completed",
      }]);
      if (session.conversationId) {
        const logged = await confirmWithRevision(
          {
            turnId: currentTurnId,
            confirmationId,
            sourceRestructurePath,
            note: "已确认当前方案，已触发结构展示转换和 Shot Storyboard Prep 生图。",
            displayArtifact: {
              artifactId: displayResult.artifactId,
              traceId: displayResult.traceId,
              runId: displayResult.runId,
              stageId: displayResult.stageId,
              status: displayResult.status,
            },
            storyboardArtifact: {
              artifactId: storyboardResult.artifactId,
              traceId: storyboardResult.traceId,
              runId: storyboardResult.runId,
              stageId: storyboardResult.stageId,
              status: storyboardResult.status,
            },
          },
          confirmationRevision,
        );
        setActiveConversationRevision(normalizeConversationRevision(logged?.conversation.revision));
        setActiveConversationConfirmedPlan(logged?.conversation.confirmedPlan ?? null);
        void refreshConversations().catch(() => undefined);
      }
      setStatusText("已触发展示转换/故事板准备与生图");
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
              </article>
            )) : <div className="empty-state"><strong>还没有对话</strong><span>输入一条消息后会通过 app-server 发送</span></div>}
          </div>
          {errorText ? <div className="agent-chat-error">{errorText}</div> : null}
          <form className="agent-chat-composer" onSubmit={(event) => { event.preventDefault(); if (!canStopCurrentTurn) void handleSend(); }}>
            <textarea
              value={draft}
              rows={3}
              placeholder="输入要发给 Agent 的消息"
              disabled={busy || activeConversationInvalidated}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.ctrlKey) return;
                event.preventDefault();
                void handleSend();
              }}
            />
            {canStopCurrentTurn ? (
              <button className="ghost-button agent-chat-stop-button" type="button" disabled={Boolean(turnActionBusy)} onClick={() => void handleStopTurn()}>
                {turnActionBusy === "stop_turn" ? "停止中" : "停止 Turn"}
              </button>
            ) : (
              <button className="primary-button" type="submit" disabled={busy || activeConversationInvalidated || !draft.trim() || (mode === "threadpool-role" && !selectedRole)}>
                {compacting ? "正在压缩上下文..." : "发送"}
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
  }));
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

function normalizeConversationRevision(value: unknown) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : null;
}

async function collectAutoDisplayTransformTurn(
  result: { threadId?: string | null; turnId?: string | null; workspaceRoot?: string | null; parentArtifactId?: string | null },
  payload: { restructureFinalPath?: string | null; parentArtifactId?: string | null; confirmationId?: string | null },
) {
  if (!result.threadId || !result.turnId) return null;
  for (let attempt = 0; attempt < AUTO_TURN_MAX_POLLS; attempt += 1) {
    const latest = await collectAgentChatTurn(result.threadId, result.turnId, result.workspaceRoot, null, {
      role: "function-slot-restructure-display-transformer",
      restructureFinalPath: payload.restructureFinalPath,
      parentArtifactId: payload.parentArtifactId ?? result.parentArtifactId,
      confirmationId: payload.confirmationId,
    });
    if (isTerminalStatus(latest.status)) return latest.materializedDisplay ?? null;
    await delay(POLL_INTERVAL_MS);
  }
  return null;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

