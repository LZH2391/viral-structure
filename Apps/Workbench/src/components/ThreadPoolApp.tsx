import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { discardThreadPoolThread, forceUpdateThreadPoolSeeds, getThreadConversation, getThreadPoolRoleStatus, getThreadPoolRoles, releaseThreadPoolOwnerLeases } from "../api/client";
import type { ThreadConversation, ThreadPoolHealth, ThreadPoolRoleDetail, ThreadPoolRoleSummary } from "../types";
import { SplitResizeHandle } from "./SplitResizeHandle";
import { useResizableTwoPaneLayout } from "../hooks/useResizableTwoPaneLayout";
import { formatThreadContextUsage } from "../utils/threadpoolFormat";
import { shortId } from "../utils/format";

const THREADPOOL_REFRESH_INTERVAL_MS = 2000;

export function ThreadPoolApp({ embedded = false }: { embedded?: boolean } = {}) {
  const [roles, setRoles] = useState<ThreadPoolRoleSummary[]>([]);
  const [health, setHealth] = useState<ThreadPoolHealth | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadPoolRoleDetail | null>(null);
  const [status, setStatus] = useState("读取 ThreadPool");
  const [updatedAt, setUpdatedAt] = useState("等待刷新");
  const [updatingSeeds, setUpdatingSeeds] = useState(false);
  const layoutRef = useRef<HTMLElement>(null);
  const layout = useResizableTwoPaneLayout({
    containerRef: layoutRef,
    storageKey: "threadpool:layout",
    cssVar: "--threadpool-list-width",
    defaultLeft: 340,
    minLeft: 260,
    maxLeft: 520,
    minRight: 460,
  });

  const refresh = useCallback(async () => {
    setStatus("刷新中");
    const data = await getThreadPoolRoles();
    const nextRoles = data.roles ?? [];
    setRoles(nextRoles);
    setHealth(data.health ?? null);
    setSelectedRole((current) => (nextRoles.some((item) => item.role === current) ? current : nextRoles[0]?.role ?? null));
    setUpdatedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    setStatus(data.ok ? "已同步" : "ThreadPool 不可用");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sync = async (showError: boolean) => {
      try {
        await refresh();
      } catch (error) {
        if (!cancelled && showError) setStatus(error instanceof Error ? error.message : "读取失败");
      }
    };
    void sync(true);
    const timer = window.setInterval(() => {
      void sync(false);
    }, THREADPOOL_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedRole) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const sync = async (showError: boolean) => {
      try {
        const next = await getThreadPoolRoleStatus(selectedRole);
        if (cancelled) return;
        setDetail(next);
        setStatus(next.ok ? "已同步" : "读取 role 失败");
      } catch (error) {
        if (!cancelled && showError) setStatus(error instanceof Error ? error.message : "读取 role 失败");
      }
    };
    void sync(true);
    const timer = window.setInterval(() => {
      void sync(false);
    }, THREADPOOL_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedRole]);

  const refreshDetail = useCallback(async () => {
    await refresh();
    if (selectedRole) setDetail(await getThreadPoolRoleStatus(selectedRole));
  }, [refresh, selectedRole]);

  const forceUpdateSeeds = useCallback(async () => {
    if (!window.confirm("确认强制更新所有 seed？空闲线程会被重建，运行中的线程会在释放后退休。")) return;
    setUpdatingSeeds(true);
    setStatus("正在更新 seed");
    try {
      const result = await forceUpdateThreadPoolSeeds();
      setStatus(`seed 更新已触发：删除 ${result.deleted_count ?? 0}，待退休 ${result.retiring_count ?? 0}`);
      await refreshDetail();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "seed 更新失败");
    } finally {
      setUpdatingSeeds(false);
    }
  }, [refreshDetail]);

  return (
    <div className={embedded ? "threadpool-shell embedded-view" : "threadpool-shell"}>
      {!embedded ? <ThreadPoolHeader status={status} health={health} updatedAt={updatedAt} onRefresh={refreshDetail} /> : null}
      <main ref={layoutRef} className="threadpool-grid">
        <RoleList roles={roles} selectedRole={selectedRole} onSelect={setSelectedRole} />
        <SplitResizeHandle
          className="workspace-resize-handle threadpool-resizer"
          label="调整角色列表宽度"
          orientation="vertical"
          onResizeStart={layout.startResize}
          onReset={layout.resetSize}
          onNudge={layout.nudgeSize}
        />
        <RoleDetail detail={detail} updatingSeeds={updatingSeeds} onForceUpdateSeeds={forceUpdateSeeds} onChanged={refreshDetail} />
      </main>
    </div>
  );
}

function ThreadPoolHeader({
  status,
  health,
  updatedAt,
  onRefresh,
}: {
  status: string;
  health: ThreadPoolHealth | null;
  updatedAt: string;
  onRefresh: () => Promise<void>;
}) {
  return (
    <header className="topbar">
      <div className="project-block">
        <div className="project-name">ThreadPool</div>
        <div id="threadpoolStatus" className="save-status">
          {status}
        </div>
      </div>
      <HealthStrip health={health} updatedAt={updatedAt} />
      <div className="top-actions">
        <a className="ghost-button action-link" href="/">
          返回工作台
        </a>
        <button id="refreshThreadPoolBtn" className="primary-button" type="button" onClick={() => onRefresh().catch(() => undefined)}>
          刷新
        </button>
      </div>
    </header>
  );
}

function HealthStrip({ health, updatedAt }: { health: ThreadPoolHealth | null; updatedAt: string }) {
  const ready = Boolean(health?.ready_for_leases);
  const recovering = Boolean(health?.recovering);
  const startupError = health?.startup_error;
  return (
    <div className="run-strip">
      <span className={`run-pill ${ready ? "good" : recovering ? "warn" : ""}`}>{ready ? "ready" : recovering ? "recovering" : "offline"}</span>
      <span className="trace-label">{updatedAt}</span>
      {startupError ? <span className="trace-label">{startupError}</span> : null}
    </div>
  );
}

function RoleList({ roles, selectedRole, onSelect }: { roles: ThreadPoolRoleSummary[]; selectedRole: string | null; onSelect: (role: string) => void }) {
  return (
    <aside className="threadpool-list" aria-label="ThreadPool roles">
      <div className="section-heading">Roles</div>
      <div id="threadpoolRoleList" className="compact-list">
        {roles.length ? roles.map((role) => (
          <RoleListItem key={role.role} role={role} active={selectedRole === role.role} onSelect={onSelect} />
        )) : <EmptyState text="暂无 role 状态" />}
      </div>
    </aside>
  );
}

function RoleListItem({ role, active, onSelect }: { role: ThreadPoolRoleSummary; active: boolean; onSelect: (role: string) => void }) {
  const state = resolveRoleAvailability(role);
  return (
    <button className={`threadpool-role ${active ? "active" : ""}`} type="button" onClick={() => onSelect(role.role)}>
      <strong>{role.role}</strong>
      <span>{role.idle}/{role.minIdle} idle / {role.leased} leased</span>
      <b className={state.className}>{state.label}</b>
      <small>seed {shortId(role.seedThreadId ?? "")}</small>
    </button>
  );
}

function resolveRoleAvailability(role: ThreadPoolRoleSummary) {
  if (role.canAcquire) {
    return {
      className: role.replenishing ? "status-warn" : "status-good",
      label: role.replenishing ? "replenishing" : "can acquire",
    };
  }
  if (role.warming || role.seedMissing) return { className: "status-warn", label: "warming" };
  if (role.replenishing) return { className: "status-warn", label: "replenishing" };
  return { className: "status-bad", label: "blocked" };
}

function RoleDetail({
  detail,
  updatingSeeds,
  onForceUpdateSeeds,
  onChanged,
}: {
  detail: ThreadPoolRoleDetail | null;
  updatingSeeds: boolean;
  onForceUpdateSeeds: () => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const threads = useMemo(() => (detail?.threads ?? []).filter((thread) => !thread.seed), [detail]);
  const [conversationStatus, setConversationStatus] = useState("选择 thread 查看对话");
  const [conversationThreadId, setConversationThreadId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ThreadConversation | null>(null);
  const maintenanceBlocked = Boolean(detail?.warming) || detail?.readyForLeases === false;
  const maintenanceBlockedTitle = detail?.warming
    ? "ThreadPool 正在 warming，维护操作暂不可用"
    : detail?.readyForLeases === false
      ? "ThreadPool 当前未 ready，维护操作暂不可用"
      : undefined;

  useEffect(() => {
    if (!conversationThreadId) {
      setConversation(null);
      setConversationStatus("选择 thread 查看对话");
      return;
    }
    if (!threads.some((thread) => thread.thread_id === conversationThreadId)) {
      setConversationThreadId(null);
      setConversation(null);
      setConversationStatus("选择 thread 查看对话");
    }
  }, [conversationThreadId, threads]);

  const discard = async (threadId: string) => {
    if (!window.confirm(`确认 discard thread ${shortId(threadId)} ?`)) return;
    await discardThreadPoolThread(threadId);
    await onChanged();
  };
  const releaseOwner = async (ownerId: string) => {
    if (!ownerId || !window.confirm(`清理本工作区 owner ${shortId(ownerId)} 的 lease ?`)) return;
    await releaseThreadPoolOwnerLeases(ownerId);
    await onChanged();
  };
  const viewConversation = async (threadId: string) => {
    setConversationThreadId(threadId);
    setConversationStatus(`读取 ${shortId(threadId)} 对话`);
    try {
      const next = await getThreadConversation(threadId);
      setConversation(next);
      setConversationStatus(`已同步 ${shortId(threadId)} 对话`);
    } catch (error) {
      setConversation(null);
      setConversationStatus(error instanceof Error ? error.message : "读取对话失败");
    }
  };
  return (
    <section className="threadpool-detail" aria-label="ThreadPool role detail">
      <div className="library-detail-header">
        <div>
          <div className="section-heading">Role Detail</div>
          <div className="debug-trace-title">{detail ? detail.role : "未选择 role"}</div>
        </div>
        <div className="threadpool-maintenance-actions">
          <button id="forceUpdateSeedsBtn" className="ghost-button danger-action" type="button" disabled={updatingSeeds} onClick={() => onForceUpdateSeeds().catch(() => undefined)}>
            {updatingSeeds ? "更新中" : "更新 seed"}
          </button>
        </div>
      </div>
      {detail ? (
        <div className="threadpool-detail-body">
          <div className="threadpool-summary-grid">
            <Detail label="seed" value={detail.seedThreadId ?? "无"} />
            <Detail label="skill" value={detail.skillPath ?? "无"} />
            <Detail label="idle" value={String(detail.counts.idle)} />
            <Detail label="leased" value={String(detail.counts.leased)} />
            <Detail label="recovering" value={String(Boolean(detail.recovering))} />
            <Detail label="ready" value={String(Boolean(detail.readyForLeases))} />
            <Detail label="startupAlive" value={String(Boolean(detail.startupThreadAlive))} />
            <Detail label="startupMs" value={detail.startupElapsedMs == null ? "无" : String(detail.startupElapsedMs)} />
            <Detail label="startupStalled" value={String(Boolean(detail.startupStalled))} />
            <Detail label="canInit" value={String(Boolean(detail.canInit))} />
            <Detail label="warming" value={detail.warming ? detail.warmupDetail ?? "warming" : "no"} />
            <Detail label="replenishing" value={detail.replenishing ? detail.warmupDetail ?? "yes" : "no"} />
            <Detail label="canAcquire" value={String(detail.canAcquire)} />
            <Detail label="warmupError" value={detail.warmupError ?? "无"} />
            <Detail label="startupError" value={detail.startupError ?? "无"} />
          </div>
          <div className="threadpool-section-title">Threads</div>
          <div className="threadpool-table" id="threadpoolThreadList">
            {threads.length ? threads.map((thread) => {
              const ctx = formatThreadContextUsage(thread.latest_input_tokens, thread.threshold_input_tokens);
              const suspectedOrphan = thread.status === "leased" && Boolean(thread.last_seen_at) && Date.now() - Date.parse(thread.last_seen_at ?? "") > 30 * 60 * 1000;
              return (
                <article key={thread.thread_id} className={`threadpool-thread ${suspectedOrphan ? "suspected-orphan" : ""}`}>
                  <div>
                    <strong>{shortId(thread.thread_id)}</strong>
                    <span>{thread.status} / owner {thread.owner_id ? shortId(thread.owner_id) : "none"} / last owner {shortId(thread.last_owner_id ?? "") || "none"}</span>
                    <small>{thread.lease_id ? `lease ${shortId(thread.lease_id)}` : "no lease"} / seen {formatSeenAt(thread.last_seen_at)} {suspectedOrphan ? "/ suspected orphan" : ""}</small>
                    <b className={`threadpool-ctx ${ctx.level}`}>{ctx.text}</b>
                  </div>
                  <div className="threadpool-thread-actions">
                    <button className="ghost-button" type="button" disabled={maintenanceBlocked || thread.seed || thread.status === "leased"} title={maintenanceBlockedTitle} onClick={() => discard(thread.thread_id).catch(() => undefined)}>
                      discard
                    </button>
                    <button className="ghost-button" type="button" disabled={maintenanceBlocked || thread.status !== "leased" || !thread.owner_id} title={maintenanceBlockedTitle} onClick={() => releaseOwner(thread.owner_id ?? "").catch(() => undefined)}>
                      清理 owner
                    </button>
                    <button className="ghost-button" type="button" onClick={() => viewConversation(thread.thread_id).catch(() => undefined)}>
                      查看对话
                    </button>
                  </div>
                </article>
              );
            }) : <EmptyState text="暂无 thread" />}
          </div>
          <div className="threadpool-section-title">Conversation</div>
          <ThreadConversationPanel
            status={conversationStatus}
            conversation={conversation}
            activeThreadId={conversationThreadId}
          />
          <div className="threadpool-section-title">Leases</div>
          <div className="threadpool-lease-list">
            {(detail.leases ?? []).map((lease) => (
              <Detail key={lease.lease_id} label={shortId(lease.lease_id)} value={`${shortId(lease.thread_id)} / owner ${shortId(lease.owner_id)} / seen ${formatSeenAt(lease.last_seen_at)}`} />
            ))}
          </div>
        </div>
      ) : <EmptyState text="选择左侧 role 查看详情" />}
    </section>
  );
}

function ThreadConversationPanel({
  status,
  conversation,
  activeThreadId,
}: {
  status: string;
  conversation: ThreadConversation | null;
  activeThreadId: string | null;
}) {
  return (
    <section className="threadpool-conversation-panel" aria-label="Thread conversation inspector">
      <div className="threadpool-conversation-header">
        <div>
          <strong>{conversation?.title || (activeThreadId ? shortId(activeThreadId) : "未选择 thread")}</strong>
          <span>{conversation ? `${conversation.status ?? "unknown"} / ${conversation.turns.length} turns` : status}</span>
        </div>
      </div>
      {conversation?.turns?.length ? (
        <div className="threadpool-conversation-list">
          {conversation.turns.map((turn) => (
            <article key={turn.turnId} className="threadpool-conversation-turn">
              <div className="threadpool-conversation-meta">
                <strong>{shortId(turn.turnId)}</strong>
                <span>{turn.status}</span>
                <small>{formatConversationMeta(turn)}</small>
              </div>
              <details className="threadpool-conversation-block">
                <summary>输入摘要</summary>
                <p>{turn.inputSummary || "无"}</p>
              </details>
              <details className="threadpool-conversation-block">
                <summary>最终输出</summary>
                <pre>{turn.finalMessage || "无"}</pre>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text={activeThreadId ? "该 thread 暂无可读 turn" : "选择 thread 查看真实对话"} />
      )}
    </section>
  );
}

function formatSeenAt(value?: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleTimeString("zh-CN", { hour12: false });
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <b>{label}</b>
      <span>{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <strong>{text}</strong>
      <span>刷新后查看 ThreadPool 状态</span>
    </div>
  );
}

function formatConversationMeta(turn: NonNullable<ThreadConversation["turns"]>[number]) {
  const parts = [
    turn.createdAt ? formatSeenAt(turn.createdAt) : null,
    turn.tokenUsage?.inputTokens != null ? `in ${turn.tokenUsage.inputTokens}` : null,
    turn.tokenUsage?.outputTokens != null ? `out ${turn.tokenUsage.outputTokens}` : null,
    turn.tokenUsage?.totalTokens != null ? `total ${turn.tokenUsage.totalTokens}` : null,
  ].filter(Boolean);
  return parts.join(" / ") || "无 token";
}
