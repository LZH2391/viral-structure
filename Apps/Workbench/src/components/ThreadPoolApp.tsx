import { useCallback, useEffect, useMemo, useState } from "react";
import { discardThreadPoolThread, getThreadPoolRoleStatus, getThreadPoolRoles } from "../api/client";
import type { ThreadPoolHealth, ThreadPoolRoleDetail, ThreadPoolRoleSummary } from "../types";
import { formatThreadContextUsage } from "../utils/threadpoolFormat";
import { shortId } from "../utils/format";

export function ThreadPoolApp({ embedded = false, onBack }: { embedded?: boolean; onBack?: () => void } = {}) {
  const [roles, setRoles] = useState<ThreadPoolRoleSummary[]>([]);
  const [health, setHealth] = useState<ThreadPoolHealth | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadPoolRoleDetail | null>(null);
  const [status, setStatus] = useState("读取 ThreadPool");
  const [updatedAt, setUpdatedAt] = useState("等待刷新");

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
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : "读取失败"));
  }, [refresh]);

  useEffect(() => {
    if (!selectedRole) {
      setDetail(null);
      return;
    }
    getThreadPoolRoleStatus(selectedRole)
      .then((next) => {
        setDetail(next);
        setStatus(next.ok ? "已同步" : "读取 role 失败");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "读取 role 失败"));
  }, [selectedRole]);

  const refreshDetail = useCallback(async () => {
    await refresh();
    if (selectedRole) setDetail(await getThreadPoolRoleStatus(selectedRole));
  }, [refresh, selectedRole]);

  return (
    <div className={embedded ? "threadpool-shell embedded-view" : "threadpool-shell"}>
      {!embedded ? <ThreadPoolHeader status={status} health={health} updatedAt={updatedAt} onRefresh={refreshDetail} /> : null}
      {embedded ? <EmbeddedHeader status={status} health={health} updatedAt={updatedAt} onBack={onBack} onRefresh={refreshDetail} /> : null}
      <main className="threadpool-grid">
        <RoleList roles={roles} selectedRole={selectedRole} onSelect={setSelectedRole} />
        <RoleDetail detail={detail} onChanged={refreshDetail} />
      </main>
    </div>
  );
}

function ThreadPoolHeader({ status, health, updatedAt, onRefresh }: { status: string; health: ThreadPoolHealth | null; updatedAt: string; onRefresh: () => Promise<void> }) {
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
        <a className="ghost-button action-link" href="http://127.0.0.1:5177/">
          返回工作台
        </a>
        <button id="refreshThreadPoolBtn" className="primary-button" type="button" onClick={() => onRefresh().catch(() => undefined)}>
          刷新
        </button>
      </div>
    </header>
  );
}

function EmbeddedHeader({ status, health, updatedAt, onBack, onRefresh }: { status: string; health: ThreadPoolHealth | null; updatedAt: string; onBack?: () => void; onRefresh: () => Promise<void> }) {
  return (
    <div className="embedded-view-header">
      <div>
        <div className="section-heading">ThreadPool</div>
        <div id="threadpoolStatus" className="debug-trace-title">{status}</div>
      </div>
      <HealthStrip health={health} updatedAt={updatedAt} />
      <div className="top-actions">
        <button className="ghost-button" type="button" onClick={onBack}>
          返回工作台
        </button>
        <button id="refreshThreadPoolBtn" className="primary-button" type="button" onClick={() => onRefresh().catch(() => undefined)}>
          刷新
        </button>
      </div>
    </div>
  );
}

function HealthStrip({ health, updatedAt }: { health: ThreadPoolHealth | null; updatedAt: string }) {
  const ready = Boolean(health?.ready_for_leases);
  const recovering = Boolean(health?.recovering);
  return (
    <div className="run-strip">
      <span className={`run-pill ${ready ? "good" : recovering ? "warn" : ""}`}>{ready ? "ready" : recovering ? "recovering" : "offline"}</span>
      <span className="trace-label">{updatedAt}</span>
    </div>
  );
}

function RoleList({ roles, selectedRole, onSelect }: { roles: ThreadPoolRoleSummary[]; selectedRole: string | null; onSelect: (role: string) => void }) {
  return (
    <aside className="threadpool-list" aria-label="ThreadPool roles">
      <div className="section-heading">Roles</div>
      <div id="threadpoolRoleList" className="compact-list">
        {roles.length ? roles.map((role) => (
          <button key={role.role} className={`threadpool-role ${selectedRole === role.role ? "active" : ""}`} type="button" onClick={() => onSelect(role.role)}>
            <strong>{role.role}</strong>
            <span>{role.idle}/{role.minIdle} idle / {role.leased} leased</span>
            <b className={role.canAcquire ? "status-good" : role.warming ? "status-warn" : "status-bad"}>{role.canAcquire ? "can acquire" : role.warming ? "warming" : "blocked"}</b>
            <small>seed {shortId(role.seedThreadId ?? "")}</small>
          </button>
        )) : <EmptyState text="暂无 role 状态" />}
      </div>
    </aside>
  );
}

function RoleDetail({ detail, onChanged }: { detail: ThreadPoolRoleDetail | null; onChanged: () => Promise<void> }) {
  const threads = useMemo(() => detail?.threads ?? [], [detail]);
  const discard = async (threadId: string) => {
    if (!window.confirm(`确认 discard thread ${shortId(threadId)} ?`)) return;
    await discardThreadPoolThread(threadId);
    await onChanged();
  };
  return (
    <section className="threadpool-detail" aria-label="ThreadPool role detail">
      <div className="library-detail-header">
        <div>
          <div className="section-heading">Role Detail</div>
          <div className="debug-trace-title">{detail ? detail.role : "未选择 role"}</div>
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
            <Detail label="canInit" value={String(Boolean(detail.canInit))} />
            <Detail label="warming" value={detail.warming ? detail.warmupDetail ?? "warming" : "no"} />
            <Detail label="canAcquire" value={String(detail.canAcquire)} />
            <Detail label="warmupError" value={detail.warmupError ?? "无"} />
            <Detail label="startupError" value={detail.startupError ?? "无"} />
          </div>
          <div className="threadpool-section-title">Threads</div>
          <div className="threadpool-table" id="threadpoolThreadList">
            {threads.length ? threads.map((thread) => {
              const ctx = formatThreadContextUsage(thread.latest_input_tokens, thread.threshold_input_tokens);
              return (
                <article key={thread.thread_id} className="threadpool-thread">
                  <div>
                    <strong>{shortId(thread.thread_id)}</strong>
                    <span>{thread.status} / {thread.owner_id ? `owner ${shortId(thread.owner_id)}` : "no owner"}</span>
                    <small>{thread.lease_id ? `lease ${shortId(thread.lease_id)}` : "no lease"} / last {shortId(thread.last_owner_id ?? "") || "none"}</small>
                    <b className={`threadpool-ctx ${ctx.level}`}>{ctx.text}</b>
                  </div>
                  <button className="ghost-button" type="button" disabled={thread.seed || thread.status === "leased"} onClick={() => discard(thread.thread_id).catch(() => undefined)}>
                    discard
                  </button>
                </article>
              );
            }) : <EmptyState text="暂无 thread" />}
          </div>
          <div className="threadpool-section-title">Leases</div>
          <div className="threadpool-lease-list">
            {(detail.leases ?? []).map((lease) => (
              <Detail key={lease.lease_id} label={shortId(lease.lease_id)} value={`${shortId(lease.thread_id)} / ${lease.owner_id}`} />
            ))}
          </div>
        </div>
      ) : <EmptyState text="选择左侧 role 查看详情" />}
    </section>
  );
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
