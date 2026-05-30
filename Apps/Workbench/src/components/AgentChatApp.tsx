import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { archiveAgentChatConversation, autoRunRestructureDisplayTransform, autoRunShotStoryboardPrep, collectAgentChatTurn, confirmAgentChatConversation, getAgentChatTurnTimeline, getThreadPoolRoles, listAgentChatConversations, releaseAgentChatLease, resumeAgentChatConversation, sendAgentChatMessage, startAgentChatThread, type AgentChatSessionResponse } from "../api/client";
import type { AgentChatConversation, AgentTurnTimeline, ThreadConversation, ThreadPoolRoleSummary } from "../types";
import { useResizableThreePaneLayout } from "../hooks/useResizableThreePaneLayout";
import { shortId } from "../utils/format";
import { SplitResizeHandle } from "./SplitResizeHandle";

type ChatMode = "direct" | "threadpool-role";
type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  status?: "running" | "completed" | "failed";
};

const POLL_INTERVAL_MS = 1800;

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
  const [timeline, setTimeline] = useState<AgentTurnTimeline | null>(null);
  const [statusText, setStatusText] = useState("等待连接");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const creatingDraftConversationRef = useRef(false);
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
    if (activeConversationId) {
      const active = items.find((conversation) => conversation.conversationId === activeConversationId);
      if (active) {
        setActiveConversationRevision(normalizeConversationRevision(active.revision));
        setActiveConversationInvalidated(Boolean(active.invalidated));
        setActiveConversationConfirmedPlan(active.confirmedPlan ?? null);
      }
    }
    return items;
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
    && activeConversationConfirmedPlan?.turnId !== currentTurnId
    && !busy
    && !confirming;

  const applyConversation = useCallback((conversation: AgentChatConversation, refreshed?: ThreadConversation | null) => {
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

  const ensureSession = useCallback(async (forceNew = false) => {
    if (!forceNew && session?.threadId) return session;
    setStatusText(mode === "threadpool-role" ? "Fork ThreadPool role" : "创建 app-server thread");
    const nextSession = await startAgentChatThread({
      source: mode,
      role: mode === "threadpool-role" ? selectedRole : null,
    });
    if (!nextSession.ok || !nextSession.threadId) throw new Error(nextSession.message || "Agent 会话创建失败");
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
    const poll = async () => {
      try {
        const [turn, nextTimeline] = await Promise.all([
          collectAgentChatTurn(activeSession.threadId as string, turnId, activeSession.workspaceRoot, activeSession.conversationId ?? activeConversationId),
          getAgentChatTurnTimeline(activeSession.threadId as string, turnId, activeSession.workspaceRoot).catch(() => null),
        ]);
        if (nextTimeline) setTimeline(nextTimeline);
        const activeText = normalizeActiveMessage(turn.activeThreadMessage);
        const finalText = turn.finalMessage || activeText || (isTerminalStatus(turn.status) ? "" : "生成中");
        setMessages((current) => current.map((message) => message.id === `assistant-${turnId}`
          ? { ...message, text: finalText || message.text, status: isTerminalStatus(turn.status) ? "completed" : "running" }
          : message));
        setStatusText(`turn ${turn.status}`);
        if (isTerminalStatus(turn.status)) {
          setBusy(false);
          void refreshConversations().catch(() => undefined);
          return;
        }
        pollTimerRef.current = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取回复失败";
        setErrorText(message);
        setMessages((current) => current.map((item) => item.id === `assistant-${turnId}` ? { ...item, text: message, status: "failed" } : item));
        setBusy(false);
        setStatusText("读取失败");
      }
    };
    pollTimerRef.current = window.setTimeout(poll, POLL_INTERVAL_MS);
  }, [activeConversationId, refreshConversations]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (activeConversationInvalidated) {
      const message = "thread 已不可读，此会话已失效，请归档后新建会话";
      setErrorText(message);
      setStatusText("会话已失效");
      return;
    }
    setBusy(true);
    setErrorText(null);
    setDraft("");
    setMessages((current) => [...current, { id: uniqueId("user"), role: "user", text, status: "completed" }]);
    try {
      const activeSession = await ensureSession(false);
      const submitted = await sendAgentChatMessage(activeSession.threadId as string, {
        message: text,
        ...sessionMeta,
        source: activeSession.source,
        role: activeSession.role ?? sessionMeta.role,
        leaseId: activeSession.leaseId ?? sessionMeta.leaseId,
        parentThreadId: activeSession.parentThreadId ?? sessionMeta.parentThreadId,
        conversationId: activeSession.conversationId ?? sessionMeta.conversationId,
        expectedRevision: activeConversationRevision,
        workspaceRoot: activeSession.workspaceRoot ?? sessionMeta.workspaceRoot,
        skillPath: activeSession.skillPath ?? sessionMeta.skillPath,
      });
      if (submitted.conversationRevision) setActiveConversationRevision(submitted.conversationRevision);
      setCurrentTurnId(submitted.turnId);
      setMessages((current) => [...current, { id: `assistant-${submitted.turnId}`, role: "assistant", text: "生成中", status: "running" }]);
      setStatusText("Agent 回复中");
      schedulePoll(activeSession, submitted.turnId);
    } catch (error) {
      const message = isConversationConflictError(error) ? "会话已在其他窗口更新，请重新选择或恢复后再发送" : error instanceof Error ? error.message : "发送失败";
      setErrorText(message);
      setMessages((current) => [...current, { id: uniqueId("system"), role: "system", text: message, status: "failed" }]);
      if (isConversationConflictError(error)) void refreshConversations().catch(() => undefined);
      setBusy(false);
      setStatusText("发送失败");
    }
  }, [activeConversationInvalidated, activeConversationRevision, busy, draft, ensureSession, refreshConversations, schedulePoll, sessionMeta]);

  const startNewConversation = useCallback(() => {
    creatingDraftConversationRef.current = true;
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setSession(null);
    setMessages([]);
    setDraft("");
    setCurrentTurnId(null);
    setTimeline(null);
    setActiveConversationId(null);
    setActiveConversationRevision(null);
    setActiveConversationInvalidated(false);
    setActiveConversationConfirmedPlan(null);
    setErrorText(null);
    setMode("threadpool-role");
    setSelectedRole((current) => current || "function-slot-restructure");
    setStatusText("新重组会话");
  }, []);

  const handleResumeConversation = useCallback(async (conversationId: string) => {
    creatingDraftConversationRef.current = false;
    setStatusText("恢复重组会话");
    setErrorText(null);
    try {
      const payload = await resumeAgentChatConversation(conversationId);
      if (payload.deleted) {
        const items = await refreshConversations();
        const next = items.find((item) => item.conversationId !== conversationId) ?? null;
        if (next) {
          const nextPayload = await resumeAgentChatConversation(next.conversationId);
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
      if (payload.refreshError?.message) setStatusText(`thread 已不可读，此会话已失效：${payload.refreshError.message}`);
      else setStatusText("已恢复重组会话");
    } catch (error) {
      const message = error instanceof Error ? error.message : "恢复会话失败";
      setErrorText(message);
      setStatusText("恢复失败");
    }
  }, [applyConversation, refreshConversations, startNewConversation]);

  const handleArchiveConversation = useCallback(async () => {
    if (!activeConversationId) return;
    setStatusText("归档重组会话");
    try {
      await archiveAgentChatConversation(activeConversationId, activeConversationRevision);
      const items = await refreshConversations();
      const next = items[0] ?? null;
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
  }, [activeConversationId, activeConversationRevision, refreshConversations]);

  const handleRelease = useCallback(async () => {
    if (!session?.leaseId) return;
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
  }, [activeConversationId, applyConversation, refreshConversations, session, startNewConversation]);

  const handleConfirmRestructure = useCallback(async () => {
    if (!session?.threadId || !currentTurnId || !canConfirmRestructure) return;
    setConfirming(true);
    setErrorText(null);
    setStatusText("确认方案并触发展示转换/故事板准备");
    try {
      let confirmationRevision = activeConversationRevision;
      if (session.conversationId) {
        const gate = await confirmAgentChatConversation(
          session.conversationId,
          {
            turnId: currentTurnId,
            note: "用户已确认当前重组方案，准备触发结构展示转换和 Shot Storyboard Prep。",
            expectedRevision: activeConversationRevision,
          },
        );
        confirmationRevision = normalizeConversationRevision(gate.conversation.revision);
        setActiveConversationRevision(confirmationRevision);
        setActiveConversationConfirmedPlan(gate.conversation.confirmedPlan ?? null);
      }
      const payload = {
        sampleVideoId: "function-slot-workflow",
        restructureArtifactId: currentTurnId,
        parentArtifactId: currentTurnId,
      };
      const [displayResult, storyboardResult] = await Promise.all([
        autoRunRestructureDisplayTransform(payload),
        autoRunShotStoryboardPrep(payload),
      ]);
      setMessages((current) => [...current, {
        id: uniqueId("system"),
        role: "system",
        text: `已确认当前方案，已触发结构展示转换和 Shot Storyboard Prep：展示 trace ${shortId(displayResult.traceId)} / artifact ${shortId(displayResult.artifactId)}；故事板 trace ${shortId(storyboardResult.traceId)} / artifact ${shortId(storyboardResult.artifactId)}`,
        status: "completed",
      }]);
      if (session.conversationId) {
        const logged = await confirmAgentChatConversation(
          session.conversationId,
          {
            turnId: currentTurnId,
            note: "已确认当前方案，已触发结构展示转换和 Shot Storyboard Prep。",
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
            expectedRevision: confirmationRevision,
          },
        );
        setActiveConversationRevision(normalizeConversationRevision(logged.conversation.revision));
        setActiveConversationConfirmedPlan(logged.conversation.confirmedPlan ?? null);
        void refreshConversations().catch(() => undefined);
      }
      setStatusText("已触发展示转换/故事板准备");
    } catch (error) {
      const message = isConversationConflictError(error) ? "会话已在其他窗口更新，请重新恢复后再确认" : error instanceof Error ? error.message : "确认方案失败";
      setErrorText(message);
      if (isConversationConflictError(error)) void refreshConversations().catch(() => undefined);
      setStatusText("确认失败");
    } finally {
      setConfirming(false);
    }
  }, [activeConversationRevision, canConfirmRestructure, currentTurnId, refreshConversations, session]);

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
                <button className="primary-button agent-chat-action" type="button" disabled={!canConfirmRestructure} onClick={() => void handleConfirmRestructure()}>
                  {activeConversationConfirmedPlan?.turnId === currentTurnId ? "已确认" : confirming ? "确认中" : "确认此方案"}
                </button>
              ) : null}
              {session?.leaseId ? <button className="ghost-button agent-chat-action" type="button" disabled={busy} onClick={handleRelease}>释放</button> : null}
            </div>
          </header>
          <div className="agent-chat-conversation-bar">
            <span>{activeConversationId ? `当前会话 ${shortId(activeConversationId)}` : "新会话"}</span>
            {session?.role ? <span>role {session.role}</span> : null}
            {activeConversationInvalidated ? <span className="agent-chat-state-badge danger">thread 失效</span> : null}
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
          <form className="agent-chat-composer" onSubmit={(event) => { event.preventDefault(); void handleSend(); }}>
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
            <button className="primary-button" type="submit" disabled={busy || activeConversationInvalidated || !draft.trim() || (mode === "threadpool-role" && !selectedRole)}>
              发送
            </button>
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
          <div className="section-heading">Timeline</div>
          <TimelineView timeline={timeline} />
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

function normalizeActiveMessage(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) return String((value as { text?: unknown }).text ?? "");
  return "";
}

function isTerminalStatus(status: string | null | undefined) {
  return ["completed", "complete", "failed", "cancelled", "canceled"].includes(String(status ?? "").toLowerCase());
}

function messagesFromConversation(conversation: AgentChatConversation): ChatMessage[] {
  return (conversation.messages ?? []).map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    status: message.status ?? "completed",
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

function normalizeConversationRevision(value: unknown) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : null;
}

function isConversationConflictError(error: unknown) {
  const apiError = error as { statusCode?: unknown; code?: unknown } | null;
  if (!apiError || typeof apiError !== "object") return false;
  return apiError.statusCode === 409 || String(apiError.code ?? "").includes("conversation_revision_conflict") || String(apiError.code ?? "").includes("conversation_archived");
}

