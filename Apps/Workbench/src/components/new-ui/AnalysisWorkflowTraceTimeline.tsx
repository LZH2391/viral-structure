import { useEffect, useMemo, useState } from "react";
import { getAgentTurnTimeline, getProcessingJob } from "../../api/client";
import type { AgentRunJob, AgentTimelineItem, AgentTraceCard, AgentTurnTimeline, WorkflowStageState } from "../../types";
import { pickDefaultTraceCard, resolveAgentTraceCards } from "../property-panel/agentTraceCards";
import type { AnalysisHistoryItem } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import type { WorkflowStageKey } from "./analysisWorkflowModel";

const SETTLED_TIMELINE_POLL_COUNT = 3;

export function NewUiWorkflowTraceTimeline({ stage }: { stage: WorkflowStageState }) {
  const [job, setJob] = useState<AgentRunJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [timelineByCard, setTimelineByCard] = useState<Record<string, AgentTurnTimeline | null>>({});
  const [errorByCard, setErrorByCard] = useState<Record<string, string | null>>({});
  const stageSignature = `${stage.key}:${stage.childJobId ?? ""}:${stage.childTraceId ?? ""}:${stage.attemptNo ?? ""}`;

  useEffect(() => {
    setJob(null);
    setJobError(null);
    setSelectedCardId(null);
    setTimelineByCard({});
    setErrorByCard({});
  }, [stageSignature]);

  useEffect(() => {
    if (!stage.childJobId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await getProcessingJob(stage.childJobId as string);
        if (cancelled) return;
        setJob(next);
        setJobError(null);
      } catch (error) {
        if (cancelled) return;
        setJobError(error instanceof Error ? error.message : "运行任务读取失败");
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [stage.childJobId]);

  const cards = useMemo(() => resolveAgentTraceCards(job), [job]);
  const selectedId = useMemo(() => pickDefaultTraceCard(cards, selectedCardId), [cards, selectedCardId]);
  const selectedCard = cards.find((card) => card.id === selectedId) ?? null;
  const selectedCacheKey = selectedCard ? traceCardCacheKey(selectedCard) : null;
  const selectedTimeline = selectedCacheKey ? timelineByCard[selectedCacheKey] ?? null : null;
  const selectedError = selectedCacheKey ? errorByCard[selectedCacheKey] ?? null : null;
  const activeCard = pickActiveCard(cards);
  const activity = selectedTimeline?.activity ?? selectedCard?.activity ?? activeCard?.activity ?? job?.agentActivity ?? null;
  const latestText = activeCard?.latestMessagePreview ?? activity?.latestMessagePreview ?? job?.activeThreadMessage?.text ?? null;
  const canTrace = Boolean(selectedCard?.threadId && selectedCard?.turnId);

  useEffect(() => {
    if (!selectedId) return;
    setSelectedCardId(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedCard?.threadId || !selectedCard.turnId) return;
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
      if (selectedCard.status !== "running") {
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
  }, [selectedCard?.id, selectedCard?.status, selectedCard?.threadId, selectedCard?.turnId]);

  return (
    <div className="new-ui-analysis-workflow-trace">
      {jobError ? <div className="new-ui-analysis-workflow-detail-empty">{jobError}</div> : null}
      {latestText ? (
        <div className="new-ui-analysis-workflow-trace-latest" aria-live="polite">
          <span>最新活动</span>
          <strong>{latestText}</strong>
        </div>
      ) : null}
      {cards.length ? (
        <div className="new-ui-analysis-workflow-trace-card-list" aria-label="Agent turn 列表">
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
      {selectedError ? <div className="new-ui-analysis-workflow-detail-empty">{selectedError}</div> : null}
      {selectedTimeline?.items?.length ? (
        <div className="new-ui-analysis-workflow-trace-list">
          {selectedTimeline.items.map((item) => <TimelineRow key={`${item.id}_${item.index}`} item={item} />)}
        </div>
      ) : (
        <div className="new-ui-analysis-workflow-detail-empty">{canTrace ? "正在读取运行追踪。" : "当前步骤还没有可读取的 turn。"}</div>
      )}
    </div>
  );
}

function TraceCardButton({ card, active, onSelect }: { card: AgentTraceCard; active: boolean; onSelect: () => void }) {
  return (
    <button className={`new-ui-analysis-workflow-trace-card ${active ? "is-active" : ""}`.trim()} type="button" aria-pressed={active} onClick={onSelect}>
      <span className={`new-ui-analysis-workflow-trace-state is-${card.status}`}>{renderTraceStatus(card.status)}</span>
      <strong>{card.label}</strong>
      <span>{card.role ?? "role 未知"}</span>
      {card.latestMessagePreview ? <em>{card.latestMessagePreview}</em> : null}
    </button>
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

export function resolveRunningTraceStage(item: AnalysisHistoryItem | null, selectedStageKey: WorkflowStageKey): WorkflowStageState | null {
  const workflowStages = item?.workflowRun?.stages ?? [];
  const candidates = selectedStageKey === "structureAnalysis"
    ? workflowStages.filter((stage) => ["scriptSegment", "rhythmStructure", "packagingStructure"].includes(stage.key))
    : workflowStages.filter((stage) => stage.key === selectedStageKey);
  return candidates.find((stage) => isWorkflowStageRunning(stage.status) && (stage.childJobId || stage.childTraceId))
    ?? candidates.find((stage) => isWorkflowStageRunning(stage.status))
    ?? null;
}

function pickActiveCard(cards: AgentTraceCard[]) {
  return cards.find((card) => card.status === "running")
    ?? cards.slice().sort((left, right) => Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""))[0]
    ?? null;
}

function traceCardCacheKey(card: AgentTraceCard) {
  return [card.id, card.threadId ?? "", card.turnId ?? ""].join(":");
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

function isWorkflowStageRunning(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}

export function TimelineSegmentDetailPanel({ segment }: { segment: AnalysisTimelineSegmentDetail }) {
  const metrics = [
    segment.shotRangeLabel ? { label: "镜头", value: segment.shotRangeLabel } : null,
  ].filter((metric): metric is { label: string; value: string } => Boolean(metric));
  const isSubtitleSegment = segment.tone === "subtitle";
  const detailFields = isSubtitleSegment
    ? [
      { label: "时间", value: segment.timeLabel },
      { label: "字幕文本", value: segment.summary },
    ]
    : segment.fields;

  return (
    <section className="new-ui-analysis-workflow-detail" aria-label="时间轴选中段详情" data-selected-stage={`timeline-${segment.tone}`}>
      <div className="new-ui-analysis-workflow-detail-header">
        <h2 className="new-ui-analysis-workflow-detail-title">详细信息</h2>
        <span className="new-ui-analysis-workflow-detail-status">{segmentKindLabel(segment.tone)}</span>
      </div>
      <div className="new-ui-analysis-workflow-detail-content">
        <div className="new-ui-analysis-workflow-detail-summary">
          <strong>{segmentKindLabel(segment.tone)}</strong>
        </div>
        {metrics.length ? (
          <div className="new-ui-analysis-workflow-detail-metrics" aria-label={`${segment.title}段落信息`}>
            {metrics.map((metric) => (
              <div key={metric.label} className="new-ui-analysis-workflow-detail-metric">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {detailFields.length ? (
          <div className="new-ui-analysis-workflow-detail-list">
            {detailFields.map((field) => (
              <article key={`${field.label}_${field.value}`} className="new-ui-analysis-workflow-detail-card">
                <strong>{field.label}</strong>
                <p>{field.value}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="new-ui-analysis-workflow-detail-empty">这个段落还没有更多字段。</div>
        )}
      </div>
    </section>
  );
}

function segmentKindLabel(tone: AnalysisTimelineSegmentDetail["tone"]) {
  if (tone === "shot") return "镜头";
  if (tone === "subtitle") return "字幕段";
  if (tone === "script") return "脚本段";
  if (tone === "rhythm") return "节奏段";
  if (tone === "packaging") return "包装段";
  if (tone === "materialClass") return "镜头类型";
  if (tone === "materialFunction") return "表达功能";
  if (tone === "materialProof") return "证明支撑";
  if (tone === "materialSequence") return "成片位置";
  return "槽位段";
}
