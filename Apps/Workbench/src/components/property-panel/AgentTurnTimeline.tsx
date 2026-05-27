import { useEffect, useMemo, useState } from "react";
import { getAgentTurnTimeline } from "../../api/client";
import type { AgentActivitySummary, AgentRunJob, AgentTimelineItem, AgentTurnTimeline } from "../../types";
import { shortTurnId } from "./formatters";

type Props = {
  agentName: string;
  statusText: string;
  job?: AgentRunJob | null;
  running: boolean;
  runDisabled?: boolean;
  runLabel?: string;
  onRun: () => void;
};

export function AgentTurnTimelinePanel({
  agentName,
  statusText,
  job,
  running,
  runDisabled = false,
  runLabel,
  onRun,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [timeline, setTimeline] = useState<AgentTurnTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threadId = job?.agentRun?.threadId ?? job?.agentActivity?.threadId ?? job?.activeThreadMessage?.threadId ?? null;
  const turnId = job?.agentRun?.turnId ?? job?.agentActivity?.turnId ?? job?.activeThreadMessage?.turnId ?? null;
  const canTrace = Boolean(threadId && turnId);
  const activity = timeline?.activity ?? resolveActivity(job);
  const latestText = activity?.latestMessagePreview ?? job?.activeThreadMessage?.text ?? null;
  const statusBadge = renderJobStatus(job, running);

  useEffect(() => {
    if (!expanded || !threadId || !turnId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await getAgentTurnTimeline(threadId, turnId);
        if (cancelled) return;
        setTimeline(next);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "运行追踪读取失败");
      }
    };
    void load();
    if (!running) return () => {
      cancelled = true;
    };
    const timer = window.setInterval(() => {
      void load();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [expanded, running, threadId, turnId]);

  const summary = useMemo(() => buildTraceSummary(activity, turnId), [activity, turnId]);

  return (
    <div className="agent-trace-shell">
      <div className="agent-summary-card">
        <div className="agent-summary-top">
          <div>
            <strong>{agentName}</strong>
            <span>{statusText}</span>
          </div>
          <div className="agent-summary-actions">
            {statusBadge ? (
              <span className="agent-status-badge">
                {statusBadge}
              </span>
            ) : null}
            <button className="primary-button" type="button" disabled={running || runDisabled} onClick={onRun}>
              {runLabel ?? (running ? "运行中" : "运行")}
            </button>
            <button className="ghost-button" type="button" disabled={!canTrace} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
              追踪
            </button>
          </div>
        </div>
        {latestText ? (
          <div className="agent-latest-activity" aria-live="polite">
            <span>最新活动</span>
            <strong>{latestText}</strong>
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div className="agent-turn-timeline">
          <div className="agent-turn-heading">
            <strong>运行追踪</strong>
            <span>{summary}</span>
          </div>
          {error ? <div className="detail-hint">{error}</div> : null}
          {timeline?.items?.length ? (
            <div className="agent-timeline-list">
              {timeline.items.map((item) => <TimelineRow key={`${item.id}_${item.index}`} item={item} />)}
            </div>
          ) : (
            <div className="detail-hint">{canTrace ? "正在读取运行追踪。" : "当前任务还没有可读取的 turn。"}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TimelineRow({ item }: { item: AgentTimelineItem }) {
  return (
    <div className={`agent-timeline-row item-${item.kind}`}>
      <span className="agent-timeline-dot" />
      <div className="agent-timeline-card">
        <div className="agent-timeline-meta">
          <span>{formatTime(item.createdAt)}</span>
          <span>{renderKind(item.kind)}</span>
          {item.metadata?.toolName ? <span>{item.metadata.toolName}</span> : null}
          {item.metadata?.exitCode != null ? <span>exit {item.metadata.exitCode}</span> : null}
          {item.metadata?.durationMs != null ? <span>{formatDuration(item.metadata.durationMs)}</span> : null}
        </div>
        <strong>{item.title}</strong>
        {item.textPreview ? <p>{item.textPreview}</p> : null}
      </div>
    </div>
  );
}

function resolveActivity(job?: AgentRunJob | null): AgentActivitySummary | null {
  return job?.agentActivity ?? null;
}

function buildTraceSummary(activity: AgentActivitySummary | null, turnId?: string | null) {
  const turn = turnId ? `turn ${shortTurnId(turnId)}` : "turn 无";
  const items = activity ? `${activity.effectiveItemCount || activity.itemCount} 个活动` : "0 个活动";
  const tokens = activity?.tokenUsage?.totalTokens != null ? `tokens ${formatNumber(activity.tokenUsage.totalTokens)}` : "tokens 未知";
  return `${turn} · ${items} · ${tokens}`;
}

function renderJobStatus(job: AgentRunJob | null | undefined, running: boolean) {
  if (job?.status === "failed") return "失败";
  if (job?.status === "processed") return "完成";
  if (running) return null;
  return null;
}

function renderKind(kind: AgentTimelineItem["kind"]) {
  const labels: Record<AgentTimelineItem["kind"], string> = {
    user_input: "user_input",
    agent_message: "agent_message",
    reasoning: "reasoning",
    tool_call: "tool_call",
    tool_result: "tool_result",
    token_usage: "token_usage",
    turn_status: "turn_status",
    unknown: "unknown",
  };
  return labels[kind] ?? kind;
}

function formatTime(value?: string | null) {
  if (!value) return "--:--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDuration(value: number) {
  if (!Number.isFinite(value)) return "";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
