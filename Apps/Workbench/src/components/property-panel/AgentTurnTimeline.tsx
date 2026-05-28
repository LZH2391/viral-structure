import { useEffect, useMemo, useState } from "react";
import { getAgentTurnTimeline } from "../../api/client";
import type { AgentActivitySummary, AgentRunJob, AgentTimelineItem, AgentTraceCard, AgentTurnTimeline } from "../../types";
import { pickDefaultTraceCard, resolveAgentTraceCards } from "./agentTraceCards";
import { shortTurnId } from "./formatters";

const SETTLED_TIMELINE_POLL_COUNT = 3;

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
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [timelineByCard, setTimelineByCard] = useState<Record<string, AgentTurnTimeline | null>>({});
  const [errorByCard, setErrorByCard] = useState<Record<string, string | null>>({});
  const cards = useMemo(() => resolveAgentTraceCards(job), [job]);
  const selectedId = useMemo(() => pickDefaultTraceCard(cards, selectedCardId), [cards, selectedCardId]);
  const selectedCard = cards.find((card) => card.id === selectedId) ?? null;
  const selectedCacheKey = selectedCard ? traceCardCacheKey(selectedCard) : null;
  const selectedTimeline = selectedCacheKey ? timelineByCard[selectedCacheKey] ?? null : null;
  const selectedError = selectedCacheKey ? errorByCard[selectedCacheKey] ?? null : null;
  const activeCard = pickActiveCard(cards);
  const activity = selectedTimeline?.activity ?? selectedCard?.activity ?? activeCard?.activity ?? resolveActivity(job);
  const latestText = activeCard?.latestMessagePreview ?? activity?.latestMessagePreview ?? job?.activeThreadMessage?.text ?? null;
  const statusBadge = renderJobStatus(job, running);
  const canTrace = Boolean(selectedCard?.threadId && selectedCard?.turnId);
  const summary = useMemo(() => buildTraceSummary(cards, activity, selectedCard), [cards, activity, selectedCard]);

  useEffect(() => {
    if (!selectedId) return;
    setSelectedCardId(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!expanded || !selectedCard?.threadId || !selectedCard.turnId) return;
    let cancelled = false;
    const cardKey = traceCardCacheKey(selectedCard);
    let settlePollsRemaining = SETTLED_TIMELINE_POLL_COUNT;
    const load = async () => {
      try {
        const next = await getAgentTurnTimeline(selectedCard.threadId as string, selectedCard.turnId as string);
        if (cancelled) return;
        setTimelineByCard((current) => ({ ...current, [cardKey]: next }));
        setErrorByCard((current) => ({ ...current, [cardKey]: null }));
      } catch (loadError) {
        if (cancelled) return;
        setErrorByCard((current) => ({ ...current, [cardKey]: loadError instanceof Error ? loadError.message : "运行追踪读取失败" }));
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!running && selectedCard.status !== "running") {
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
  }, [expanded, running, selectedCard?.id, selectedCard?.status, selectedCard?.threadId, selectedCard?.turnId]);

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
            <button className="ghost-button" type="button" disabled={!cards.length} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
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
          {cards.length ? (
            <div className="agent-trace-card-list" aria-label="Agent turn 列表">
              {cards.map((card) => (
                <TraceCardButton
                  key={card.id}
                  card={card}
                  active={card.id === selectedCard?.id}
                  onSelect={() => setSelectedCardId(card.id)}
                />
              ))}
            </div>
          ) : null}
          {selectedError ? <div className="detail-hint">{selectedError}</div> : null}
          {selectedTimeline?.items?.length ? (
            <div className="agent-timeline-list">
              {selectedTimeline.items.map((item) => <TimelineRow key={`${item.id}_${item.index}`} item={item} />)}
            </div>
          ) : (
            <div className="detail-hint">{canTrace ? "正在读取运行追踪。" : "当前卡片还没有可读取的 turn。"}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TraceCardButton({ card, active, onSelect }: { card: AgentTraceCard; active: boolean; onSelect: () => void }) {
  const activity = card.activity;
  return (
    <button className={`agent-trace-card ${active ? "active" : ""}`} type="button" aria-pressed={active} onClick={onSelect}>
      <span className={`agent-trace-state state-${card.status}`}>{renderTraceStatus(card.status)}</span>
      <strong>{card.label}</strong>
      <span>{card.role ?? "role 未知"}</span>
      <small>{formatTraceIds(card)}</small>
      <small>{formatActivity(activity)}</small>
      {card.latestMessagePreview ? <em>{card.latestMessagePreview}</em> : null}
    </button>
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

function pickActiveCard(cards: AgentTraceCard[]) {
  return cards.find((card) => card.status === "running")
    ?? cards.slice().sort((left, right) => Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""))[0]
    ?? null;
}

function resolveActivity(job?: AgentRunJob | null): AgentActivitySummary | null {
  return job?.agentActivity ?? null;
}

function traceCardCacheKey(card: AgentTraceCard) {
  return [card.id, card.threadId ?? "", card.turnId ?? ""].join(":");
}

function buildTraceSummary(cards: AgentTraceCard[], activity: AgentActivitySummary | null, selectedCard?: AgentTraceCard | null) {
  const selected = selectedCard?.turnId ? `turn ${shortTurnId(selectedCard.turnId)}` : "turn 无";
  const runningCount = cards.filter((card) => card.status === "running").length;
  const turns = `${cards.filter((card) => card.turnId).length}/${cards.length || 0} turns`;
  const items = activity ? `${activity.effectiveItemCount || activity.itemCount} 个活动` : "0 个活动";
  const tokens = activity?.tokenUsage?.totalTokens != null ? `tokens ${formatNumber(activity.tokenUsage.totalTokens)}` : "tokens 未知";
  return `${turns} · ${runningCount ? `${runningCount} running · ` : ""}${selected} · ${items} · ${tokens}`;
}

function renderJobStatus(job: AgentRunJob | null | undefined, running: boolean) {
  if (job?.status === "failed") return "失败";
  if (job?.status === "processed") return "完成";
  if (running) return null;
  return null;
}

function renderTraceStatus(status: AgentTraceCard["status"]) {
  const labels: Record<AgentTraceCard["status"], string> = {
    pending: "待提交",
    running: "运行中",
    completed: "完成",
    failed: "失败",
    unknown: "未知",
  };
  return labels[status] ?? status;
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
    turn_status: "turn_status",
    unknown: "unknown",
  };
  return labels[kind] ?? kind;
}

function formatTraceIds(card: AgentTraceCard) {
  const thread = card.threadId ? `thread ${shortTurnId(card.threadId)}` : "thread 无";
  const turn = card.turnId ? `turn ${shortTurnId(card.turnId)}` : "turn 无";
  return `${thread} / ${turn}`;
}

function formatActivity(activity: AgentActivitySummary | null) {
  if (!activity) return "items 0 / tokens 未知";
  const count = activity.effectiveItemCount || activity.itemCount || 0;
  const tokens = activity.tokenUsage?.totalTokens != null ? formatNumber(activity.tokenUsage.totalTokens) : "未知";
  const tool = activity.latestToolName ? ` / ${activity.latestToolName}` : "";
  return `items ${count} / tokens ${tokens}${tool}`;
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
