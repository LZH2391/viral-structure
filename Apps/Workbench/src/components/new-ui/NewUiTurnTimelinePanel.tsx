import { useEffect, useState } from "react";
import { getAgentChatTurnTimeline } from "../../api/client";
import type { AgentTimelineItem, AgentTurnTimeline } from "../../types";

const SETTLED_TIMELINE_POLL_COUNT = 3;

export type NewUiTurnTimelineTarget = {
  threadId?: string | null;
  turnId?: string | null;
  workspaceRoot?: string | null;
  running?: boolean;
  pending?: boolean;
};

type NewUiTurnTimelinePanelProps = {
  target: NewUiTurnTimelineTarget | null;
};

export function NewUiTurnTimelinePanel({ target }: NewUiTurnTimelinePanelProps) {
  const [timeline, setTimeline] = useState<AgentTurnTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timelineReveal, setTimelineReveal] = useState<{ key: string; visible: boolean }>({ key: "", visible: false });
  const [expandedByScope, setExpandedByScope] = useState<Record<string, boolean>>({});
  const threadId = target?.threadId ?? null;
  const turnId = target?.turnId ?? null;
  const workspaceRoot = target?.workspaceRoot ?? null;
  const targetRunning = Boolean(target?.running);
  const targetPending = Boolean(target?.pending);
  const targetKey = threadId && turnId ? `${threadId}:${turnId}:${workspaceRoot ?? ""}` : "";
  const activity = timeline?.activity ?? null;
  const timelineExpanded = targetKey ? expandedByScope[targetKey] ?? targetRunning : false;

  useEffect(() => {
    setTimeline(null);
    setError(null);
    setTimelineReveal({ key: "", visible: false });
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
        setTimelineReveal((current) => {
          if (current.key === targetKey) return current;
          return { key: targetKey, visible: false };
        });
        window.requestAnimationFrame(() => {
          if (cancelled) return;
          setTimelineReveal((current) => (
            current.key === targetKey ? { ...current, visible: true } : current
          ));
        });
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
      {timeline ? (
        <div className={`new-ui-turn-timeline-real ${timelineReveal.visible ? "is-visible" : ""}`.trim()}>
          {activity?.latestMessagePreview ? (
            <div className="new-ui-analysis-workflow-trace-latest" aria-live="polite">
              <span>最新活动</span>
              <strong>{activity.latestMessagePreview}</strong>
            </div>
          ) : null}
          {error ? <div className="new-ui-analysis-workflow-detail-empty">{error}</div> : null}
          {timeline.items?.length ? (
            <TimelineTurnScope
              expanded={timelineExpanded}
              timeline={timeline}
              running={targetRunning}
              onToggle={() => {
                if (!targetKey) return;
                setExpandedByScope((current) => ({ ...current, [targetKey]: !(current[targetKey] ?? targetRunning) }));
              }}
            />
          ) : (
            <div className="new-ui-analysis-workflow-detail-empty">正在读取运行追踪。</div>
          )}
        </div>
      ) : (
        <div className="new-ui-analysis-workflow-detail-empty">
          {error ?? (targetPending ? "等待后端返回真实 turn。" : target ? "正在读取运行追踪。" : "发送消息后会显示模型、工具和消息追踪。")}
        </div>
      )}
    </div>
  );
}

function TimelineTurnScope({
  expanded,
  timeline,
  running,
  onToggle,
}: {
  expanded: boolean;
  timeline: AgentTurnTimeline;
  running: boolean;
  onToggle: () => void;
}) {
  const panelId = `new-ui-turn-timeline-${sanitizeDomId(timeline.threadId)}-${sanitizeDomId(timeline.turnId)}`;
  const summary = buildTurnScopeSummary(timeline);

  return (
    <section className={`new-ui-turn-scope ${expanded ? "is-expanded" : ""} ${running ? "is-running" : ""}`.trim()} aria-label="Turn 运行追踪">
      <button
        className="new-ui-turn-scope-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="new-ui-turn-scope-chevron" aria-hidden="true">
          <ChevronGlyph />
        </span>
        <span className={`new-ui-analysis-workflow-trace-state is-${normalizeTurnStatus(timeline.status, running)}`}>
          {renderTurnStatus(timeline.status, running)}
        </span>
        <span className="new-ui-turn-scope-main">
          <strong>{formatTurnScopeTitle(timeline.turnId)}</strong>
          <span>{summary}</span>
        </span>
      </button>
      {expanded ? (
        <div id={panelId} className="new-ui-turn-scope-body">
          <div className="new-ui-analysis-workflow-trace-list">
            {timeline.items.map((item) => <TimelineRow key={`${item.id}_${item.index}`} item={item} />)}
          </div>
        </div>
      ) : null}
    </section>
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

function buildTurnScopeSummary(timeline: AgentTurnTimeline) {
  const count = timeline.items.length;
  const latest = timeline.activity?.latestToolName ? ` / ${timeline.activity.latestToolName}` : "";
  const tokens = timeline.activity?.tokenUsage?.totalTokens != null ? ` / tokens ${formatNumber(timeline.activity.tokenUsage.totalTokens)}` : "";
  return `${count} items${latest}${tokens}`;
}

function formatTurnScopeTitle(turnId: string) {
  return `turn ${shortId(turnId)}`;
}

function shortId(value?: string | null) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "无";
  return trimmed.length > 8 ? trimmed.slice(0, 8) : trimmed;
}

function normalizeTurnStatus(status: string | null | undefined, running: boolean) {
  if (running) return "running";
  const normalized = String(status ?? "").toLowerCase();
  if (["completed", "complete", "processed", "done", "success", "succeeded"].includes(normalized)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) return "failed";
  if (["running", "pending", "processing", "queued", "waiting"].includes(normalized)) return "running";
  return "unknown";
}

function renderTurnStatus(status: string | null | undefined, running: boolean) {
  const normalized = normalizeTurnStatus(status, running);
  const labels: Record<string, string> = {
    running: "运行中",
    completed: "完成",
    failed: "失败",
    unknown: "未知",
  };
  return labels[normalized] ?? normalized;
}

function sanitizeDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-") || "unknown";
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 18 18" focusable="false" aria-hidden="true">
      <path d="m6.2 3.8 5 5.2-5 5.2" />
    </svg>
  );
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
