import type { CSSProperties } from "react";
import type { AgentChatDialogueRoboticReview, AgentTurnTimeline } from "../../types";

export function TimelineView({ timeline }: { timeline: AgentTurnTimeline | null }) {
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

export function DialogueReviewSummary({
  review,
  canRework,
  reworking,
  onRework,
}: {
  review: AgentChatDialogueRoboticReview;
  canRework: boolean;
  reworking: boolean;
  onRework: () => void;
}) {
  const decision = review.decision ?? "unknown";
  const issueCount = Number.isFinite(Number(review.issueCount)) ? Number(review.issueCount) : 0;
  return (
    <div className={`agent-chat-dialogue-review ${decision}`}>
      <div>
        <b>台词审查</b>
        <span>{formatDialogueReviewDecision(decision)} · {issueCount} issue{issueCount === 1 ? "" : "s"}</span>
      </div>
      <small>{review.reviewOutputPath ? `review ${review.reviewOutputPath}` : review.status ?? "processed"}</small>
      {decision === "rework" ? (
        <button className="ghost-button agent-chat-action" type="button" disabled={!canRework || reworking} onClick={onRework}>
          {reworking ? "返工中" : "按审查返工"}
        </button>
      ) : null}
    </div>
  );
}

function formatDialogueReviewDecision(value?: string | null) {
  if (value === "pass") return "通过";
  if (value === "rework") return "建议返工";
  if (value === "blocked") return "阻塞";
  return value ?? "未知";
}

export function ContextUsageIndicator({ usage }: { usage: AgentTurnTimeline["activity"]["tokenUsage"] | null }) {
  const ratio = typeof usage?.contextUsageRatio === "number" && Number.isFinite(usage.contextUsageRatio)
    ? Math.max(0, Math.min(1, usage.contextUsageRatio))
    : null;
  const percent = ratio == null ? "--" : String(Math.round(ratio * 100));
  const progress = ratio == null ? 0 : Math.round(ratio * 100);
  const state = usage?.contextUsageState ?? "unknown";
  return (
    <span
      className={`agent-chat-context-usage ${state}`}
      title={formatContextUsageTitle(usage)}
      style={{ "--context-progress": `${progress}%` } as CSSProperties}
    >
      <b>{percent}% used</b>
      <i aria-hidden="true" />
    </span>
  );
}

function formatContextUsageTitle(usage: AgentTurnTimeline["activity"]["tokenUsage"] | null) {
  if (!usage || usage.contextUsageState === "unknown") return "上下文使用未知";
  return [
    usage.inputTokens != null ? `input ${usage.inputTokens}` : null,
    usage.modelContextWindow != null ? `window ${usage.modelContextWindow}` : null,
    usage.contextThresholdTokens != null ? `threshold ${usage.contextThresholdTokens}` : null,
  ].filter(Boolean).join(" / ") || "上下文使用未知";
}
