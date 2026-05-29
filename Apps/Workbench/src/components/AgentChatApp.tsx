import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { autoRunRestructureDisplayTransform, autoRunShotStoryboardPrep, collectAgentChatTurn, getAgentChatTurnTimeline, getThreadPoolRoles, releaseAgentChatLease, sendAgentChatMessage, startAgentChatThread, type AgentChatSessionResponse } from "../api/client";
import type { AgentTurnTimeline, ThreadPoolRoleSummary } from "../types";
import { useResizableTwoPaneLayout } from "../hooks/useResizableTwoPaneLayout";
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
  const layout = useResizableTwoPaneLayout({
    containerRef: layoutRef,
    storageKey: "agent-chat:layout",
    cssVar: "--agent-chat-main-width",
    defaultLeft: 720,
    minLeft: 420,
    maxLeft: 1120,
    minRight: 320,
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

  useEffect(() => () => {
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
  }, []);

  const sessionMeta = useMemo(() => ({
    source: session?.source ?? mode,
    role: session?.role ?? (mode === "threadpool-role" ? selectedRole : null),
    leaseId: session?.leaseId ?? null,
    parentThreadId: session?.parentThreadId ?? null,
    workspaceRoot: session?.workspaceRoot ?? null,
    skillPath: session?.skillPath ?? null,
  }), [mode, selectedRole, session]);
  const canConfirmRestructure = session?.source === "threadpool-role"
    && session.role === "function-slot-restructure"
    && Boolean(session.threadId)
    && Boolean(currentTurnId)
    && !busy
    && !confirming;

  const ensureSession = useCallback(async () => {
    if (session?.threadId) return session;
    setStatusText(mode === "threadpool-role" ? "Fork ThreadPool role" : "创建 app-server thread");
    const nextSession = await startAgentChatThread({
      source: mode,
      role: mode === "threadpool-role" ? selectedRole : null,
    });
    if (!nextSession.ok || !nextSession.threadId) throw new Error(nextSession.message || "Agent 会话创建失败");
    setSession(nextSession);
    setStatusText(nextSession.source === "threadpool-role" ? "forkThread 已连接" : "thread 已连接");
    return nextSession;
  }, [mode, selectedRole, session]);

  const schedulePoll = useCallback((activeSession: AgentChatSessionResponse, turnId: string) => {
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    const poll = async () => {
      try {
        const [turn, nextTimeline] = await Promise.all([
          collectAgentChatTurn(activeSession.threadId as string, turnId, activeSession.workspaceRoot),
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
  }, []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setErrorText(null);
    setDraft("");
    setMessages((current) => [...current, { id: uniqueId("user"), role: "user", text, status: "completed" }]);
    try {
      const activeSession = await ensureSession();
      const submitted = await sendAgentChatMessage(activeSession.threadId as string, {
        message: text,
        ...sessionMeta,
        source: activeSession.source,
        role: activeSession.role ?? sessionMeta.role,
        leaseId: activeSession.leaseId ?? sessionMeta.leaseId,
        parentThreadId: activeSession.parentThreadId ?? sessionMeta.parentThreadId,
        workspaceRoot: activeSession.workspaceRoot ?? sessionMeta.workspaceRoot,
        skillPath: activeSession.skillPath ?? sessionMeta.skillPath,
      });
      setCurrentTurnId(submitted.turnId);
      setMessages((current) => [...current, { id: `assistant-${submitted.turnId}`, role: "assistant", text: "生成中", status: "running" }]);
      setStatusText("Agent 回复中");
      schedulePoll(activeSession, submitted.turnId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送失败";
      setErrorText(message);
      setMessages((current) => [...current, { id: uniqueId("system"), role: "system", text: message, status: "failed" }]);
      setBusy(false);
      setStatusText("发送失败");
    }
  }, [busy, draft, ensureSession, schedulePoll, sessionMeta]);

  const handleRelease = useCallback(async () => {
    if (!session?.leaseId) return;
    setStatusText("释放 lease");
    await releaseAgentChatLease(session.leaseId, session.ownerId).catch((error) => {
      setErrorText(error instanceof Error ? error.message : "释放 lease 失败");
    });
    setStatusText("lease 已释放");
  }, [session]);

  const handleConfirmRestructure = useCallback(async () => {
    if (!session?.threadId || !currentTurnId || !canConfirmRestructure) return;
    setConfirming(true);
    setErrorText(null);
    setStatusText("确认方案并触发展示转换/故事板准备");
    try {
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
      setStatusText("已触发展示转换/故事板准备");
    } catch (error) {
      const message = error instanceof Error ? error.message : "确认方案失败";
      setErrorText(message);
      setStatusText("确认失败");
    } finally {
      setConfirming(false);
    }
  }, [canConfirmRestructure, currentTurnId, session?.threadId]);

  return (
    <div className={embedded ? "agent-chat-shell embedded-view" : "agent-chat-shell"}>
      <main ref={layoutRef} className="agent-chat-layout">
        <section className="agent-chat-main" aria-label="Agent 对话">
          <header className="agent-chat-toolbar">
            <div>
              <div className="section-heading">Agent 对话</div>
              <small>{statusText}</small>
            </div>
            <div className="agent-chat-controls">
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
                  {confirming ? "确认中" : "确认此方案"}
                </button>
              ) : null}
              {session?.leaseId ? <button className="ghost-button agent-chat-action" type="button" onClick={handleRelease}>释放</button> : null}
            </div>
          </header>
          <div className="agent-chat-meta">
            <span>thread {shortId(session?.threadId ?? "未连接")}</span>
            <span>turn {shortId(currentTurnId ?? "等待")}</span>
            <span>trace {shortId(session?.traceId ?? "等待")}</span>
            {session?.role ? <span>role {session.role}</span> : null}
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
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.ctrlKey) return;
                event.preventDefault();
                void handleSend();
              }}
            />
            <button className="primary-button" type="submit" disabled={busy || !draft.trim() || (mode === "threadpool-role" && !selectedRole)}>
              发送
            </button>
          </form>
        </section>
        <SplitResizeHandle
          className="workspace-resize-handle agent-chat-resizer"
          label="调整 Agent 对话和 Timeline 宽度"
          orientation="vertical"
          onResizeStart={layout.startResize}
          onReset={layout.resetSize}
          onNudge={layout.nudgeSize}
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
    <div className="agent-timeline-list">
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

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
