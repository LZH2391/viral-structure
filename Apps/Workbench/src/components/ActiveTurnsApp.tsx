import { useCallback, useEffect, useMemo, useState } from "react";
import { listActiveTurns, retryActiveTurn, stopActiveTurn, type ActiveTurnSummary } from "../api/client";
import { shortId } from "../utils/format";

type OwnerFilter = "all" | "agent-chat" | "processing-job" | "workflow-stage";

export function ActiveTurnsApp({ embedded = false }: { embedded?: boolean }) {
  const [turns, setTurns] = useState<ActiveTurnSummary[]>([]);
  const [filter, setFilter] = useState<OwnerFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [busyBindingId, setBusyBindingId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const payload = await listActiveTurns(filter === "all" ? {} : { ownerType: filter });
    setTurns(payload.activeTurns ?? []);
    setError(null);
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const payload = await listActiveTurns(filter === "all" ? {} : { ownerType: filter });
        if (cancelled) return;
        setTurns(payload.activeTurns ?? []);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "读取运行面板失败");
      }
      if (!cancelled) timer = window.setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [filter]);

  const counts = useMemo(() => ({
    total: turns.length,
    agentChat: turns.filter((turn) => turn.ownerType === "agent-chat").length,
    processingJob: turns.filter((turn) => turn.ownerType === "processing-job").length,
    workflowStage: turns.filter((turn) => turn.ownerType === "workflow-stage").length,
  }), [turns]);

  const handleStop = useCallback(async (turn: ActiveTurnSummary) => {
    if (!turn.bindingId) return;
    setBusyBindingId(turn.bindingId);
    setError(null);
    try {
      await stopActiveTurn(turn.bindingId, { turnId: turn.turnId });
      setLastAction(`已停止 ${shortId(turn.turnId)}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "停止失败");
    } finally {
      setBusyBindingId(null);
    }
  }, [refresh]);

  const handleRetry = useCallback(async (turn: ActiveTurnSummary) => {
    if (!turn.bindingId) return;
    setBusyBindingId(turn.bindingId);
    setError(null);
    try {
      const result = await retryActiveTurn(turn.bindingId);
      setLastAction(`已重试 ${shortId(result.turnId ?? turn.turnId)}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试失败");
    } finally {
      setBusyBindingId(null);
    }
  }, [refresh]);

  return (
    <main className={embedded ? "active-turns-shell embedded-view" : "active-turns-shell"}>
      <header className="active-turns-header">
        <div>
          <h1>运行面板</h1>
          <p>只显示当前正在运行、提交或收集中的 AppServer turn</p>
        </div>
        <div className="active-turns-summary" aria-label="active turn summary">
          <span>{counts.total} total</span>
          <span>{counts.processingJob} jobs</span>
          <span>{counts.agentChat} chat</span>
          <span>{counts.workflowStage} workflow</span>
        </div>
      </header>

      <section className="active-turns-toolbar" aria-label="运行面板筛选">
        <div className="active-turns-filters" role="tablist">
          {(["all", "processing-job", "workflow-stage", "agent-chat"] as OwnerFilter[]).map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? "active" : ""}
              aria-selected={filter === item}
              role="tab"
              onClick={() => setFilter(item)}
            >
              {filterLabel(item)}
            </button>
          ))}
        </div>
        <button className="ghost-button" type="button" onClick={() => void refresh()}>刷新</button>
      </section>

      {error ? <div className="active-turns-error">{error}</div> : null}
      {lastAction ? <div className="active-turns-note">{lastAction}</div> : null}

      <section className="active-turns-grid" aria-label="运行中 turns">
        {turns.length ? turns.map((turn) => (
          <article className="active-turn-card" key={turn.bindingId ?? `${turn.threadId}-${turn.turnId}`}>
            <div className="active-turn-card-head">
              <div>
                <strong>{turn.ownerType}</strong>
                <span>{turn.stageName ?? "unknown stage"}</span>
              </div>
              <i>{turn.status}</i>
            </div>
            <dl>
              <dt>owner</dt>
              <dd>{shortId(turn.ownerId)}</dd>
              <dt>thread</dt>
              <dd>{shortId(turn.threadId)}</dd>
              <dt>turn</dt>
              <dd>{shortId(turn.turnId)}</dd>
              <dt>trace</dt>
              <dd>{shortId(turn.traceId ?? "none")}</dd>
              <dt>attempt</dt>
              <dd>{shortId(turn.currentAttemptId ?? "none")}</dd>
              <dt>replay</dt>
              <dd>{formatReplayRef(turn.replayRef)}</dd>
            </dl>
            <div className="active-turn-actions">
              <button className="ghost-button danger-action" type="button" disabled={busyBindingId === turn.bindingId || !turn.bindingId} onClick={() => void handleStop(turn)}>
                {busyBindingId === turn.bindingId ? "处理中" : "停止"}
              </button>
              <button className="ghost-button" type="button" disabled={busyBindingId === turn.bindingId || !canRetryFromPanel(turn)} onClick={() => void handleRetry(turn)} title={retryTitle(turn)}>
                重试
              </button>
            </div>
          </article>
        )) : (
          <div className="active-turns-empty">
            <strong>没有运行中的 turn</strong>
            <span>completed / failed / canceled 会从这里移除</span>
          </div>
        )}
      </section>
    </main>
  );
}

function filterLabel(filter: OwnerFilter) {
  if (filter === "all") return "全部";
  if (filter === "processing-job") return "Jobs";
  if (filter === "workflow-stage") return "Workflow";
  return "AgentChat";
}

function formatReplayRef(ref: ActiveTurnSummary["replayRef"]) {
  if (!ref) return "no replay";
  const id = ref.refId ?? ref.messageId ?? ref.sourceTurnId ?? "no-ref";
  return [ref.type ?? "ref", shortId(id)].filter(Boolean).join(" / ");
}

function canRetryFromPanel(turn: ActiveTurnSummary) {
  return (turn.ownerType === "agent-chat" && turn.replayRef?.type === "agent-chat-message")
    || (turn.ownerType === "processing-job" && turn.replayRef?.type === "processing-job-input");
}

function retryTitle(turn: ActiveTurnSummary) {
  if (turn.ownerType === "agent-chat") return "同 thread 重试 AgentChat 用户消息";
  if (!canRetryFromPanel(turn)) return "该 turn 没有可安全重放的 owner replayRef";
  return "用 owner 保存的输入重试";
}
