import { useEffect, useMemo, useState } from "react";
import { getAgentChatTurnTimeline } from "../../api/client";
import type { AgentTimelineItem, AgentTurnTimeline } from "../../types";
import { shortTurnId } from "../property-panel/formatters";

const SETTLED_TIMELINE_POLL_COUNT = 3;

export type NewUiTurnTimelineTarget = {
  threadId: string;
  turnId: string;
  workspaceRoot?: string | null;
  running?: boolean;
};

type NewUiTurnTimelinePanelProps = {
  title: string;
  target: NewUiTurnTimelineTarget | null;
};

export function NewUiTurnTimelinePanel({ title, target }: NewUiTurnTimelinePanelProps) {
  const [timeline, setTimeline] = useState<AgentTurnTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threadId = target?.threadId ?? null;
  const turnId = target?.turnId ?? null;
  const workspaceRoot = target?.workspaceRoot ?? null;
  const targetRunning = Boolean(target?.running);
  const targetKey = threadId && turnId ? `${threadId}:${turnId}:${workspaceRoot ?? ""}` : "";
  const activity = timeline?.activity ?? null;
  const summary = useMemo(() => buildTimelineSummary(timeline), [timeline]);

  useEffect(() => {
    setTimeline(null);
    setError(null);
  }, [targetKey]);

  useEffect(() => {
    if (!threadId || !turnId) return undefined;
    let cancelled = false;
    let settlePollsRemaining = SETTLED_TIMELINE_POLL_COUNT;
    const load = async () => {
      try {
        const next = await getAgentChatTurnTimeline(threadId, turnId, workspaceRoot);
        if (cancelled) return;
        setTimeline(next);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "运行追踪读取失败");
      }
    };
    void load();
    const timer = window.setInterval(() => {
      const shouldContinue = targetRunning;
      if (!shouldContinue) {
        if (settlePollsRemaining <= 0) {
          window.clearInterval(timer);
          return;
        }
        settlePollsRemaining -= 1;
      }
      void load();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [targetKey, threadId, turnId, workspaceRoot, targetRunning]);

  return (
    <div className="new-ui-analysis-workflow-trace">
      <div className="new-ui-analysis-workflow-detail-summary">
        <strong>{title}</strong>
        <p>{target ? `thread ${shortTurnId(target.threadId)} / turn ${shortTurnId(target.turnId)}` : "当前会话还没有可读取的 turn。"}</p>
      </div>
      <div className="new-ui-analysis-workflow-trace-heading">
        <strong>运行追踪</strong>
        <span>{summary}</span>
      </div>
      {activity?.latestMessagePreview ? (
        <div className="new-ui-analysis-workflow-trace-latest" aria-live="polite">
          <span>最新活动</span>
          <strong>{activity.latestMessagePreview}</strong>
        </div>
      ) : null}
      {error ? <div className="new-ui-analysis-workflow-detail-empty">{error}</div> : null}
      {timeline?.items?.length ? (
        <div className="new-ui-analysis-workflow-trace-list">
          {timeline.items.map((item) => <TimelineRow key={`${item.id}_${item.index}`} item={item} />)}
        </div>
      ) : (
        <div className="new-ui-analysis-workflow-detail-empty">{target ? "正在读取运行追踪。" : "发送消息后会显示模型、工具和消息追踪。"}</div>
      )}
    </div>
  );
}

function TimelineRow({ item }: { item: AgentTimelineItem }) {
  return (
    <div className={`new-ui-analysis-workflow-trace-row is-${item.kind}`}>
      <span className="new-ui-analysis-workflow-trace-dot" />
      <div className="new-ui-analysis-workflow-trace-event">
        <div className="new-ui-analysis-workflow-trace-meta">
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

function buildTimelineSummary(timeline: AgentTurnTimeline | null) {
  if (!timeline) return "等待 turn timeline";
  const activity = timeline.activity;
  const items = `${timeline.items.length} items`;
  const tokens = activity?.tokenUsage?.totalTokens != null ? `tokens ${formatNumber(activity.tokenUsage.totalTokens)}` : "tokens 未知";
  const tool = activity?.latestToolName ? ` · ${activity.latestToolName}` : "";
  return `${timeline.status || "unknown"} · ${items} · ${tokens}${tool}`;
}

function renderKind(kind: AgentTimelineItem["kind"]) {
  const labels: Record<AgentTimelineItem["kind"], string> = {
    user_input: "user_input",
    agent_message: "agent_message",
    plan: "plan",
    reasoning: "reasoning",
    command_execution: "command",
    mcp_tool_call: "mcp_tool",
    dynamic_tool_call: "dynamic_tool",
    file_change: "file_change",
    web_search: "web_search",
    tool_call: "tool_call",
    tool_result: "tool_result",
    token_usage: "token_usage",
    context_compacted: "compact",
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
