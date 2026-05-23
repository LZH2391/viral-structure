import type { AgentRunJob, RhythmStructureArtifact, RhythmStructureHistoryEntry } from "../../types";
import { formatSecondsCompact } from "../../utils/format";
import { formatRhythmHistoryMeta, renderRhythmResultOrigin } from "./formatters";

function renderCardTime(card: RhythmStructureArtifact["cards"][number]) {
  return `${formatSecondsCompact(card.start)} - ${formatSecondsCompact(card.end)}`;
}

export function RhythmStructurePanel({
  analysis,
  analysisHistory,
  job,
  onRun,
  onSelectCard,
}: {
  analysis?: RhythmStructureArtifact | null;
  analysisHistory?: RhythmStructureHistoryEntry[] | null;
  job?: AgentRunJob | null;
  onRun: () => void;
  onSelectCard: (time: number) => void;
}) {
  const running = job?.status === "pending" || job?.status === "processing";
  const cards = analysis?.cards ?? [];
  const historyEntries = analysisHistory ?? [];
  const failed = analysis?.status === "failed" || analysis?.validation?.status === "failed" || job?.status === "failed";
  const failureMessage = analysis?.reason ?? job?.errorSummary?.message ?? null;
  const debugSnapshotUri = analysis?.debugSnapshotUri ?? job?.errorSummary?.debugSnapshotUri ?? null;
  const activeThreadMessage = resolveActiveThreadMessage(job);
  const statusText = job
    ? `${job.stage} / ${job.progress}%`
    : analysis
      ? failed
        ? "分析失败"
        : `${cards.length} 张卡`
      : "等待分析";

  return (
    <section className="property-section agent-run-panel">
      <div className="section-heading">Agent</div>
      <div className="agent-capability-row">
        <div>
          <strong>rhythm-structure</strong>
          <span>{statusText}</span>
        </div>
        <button className="primary-button" type="button" disabled={running} onClick={onRun}>
          {running ? "运行中" : "运行"}
        </button>
      </div>
      {activeThreadMessage ? (
        <div className="agent-thread-message" aria-live="polite">
          <span>线程消息</span>
          <strong>{activeThreadMessage.text}</strong>
        </div>
      ) : null}
      {analysis ? (
        <div className="detail-hint">
          <div>turn：{analysis.agent?.turnId ?? "无"}</div>
          <div>status：{analysis.status}</div>
          <div>cardCount：{cards.length}</div>
          <div>resultOrigin：{renderRhythmResultOrigin(analysis.resultOrigin)}</div>
          <div>validation：{analysis.validation?.status ?? "未知"}{analysis.validation?.validatorCode ? ` / ${analysis.validation.validatorCode}` : ""}</div>
          <div>repairAttemptCount：{analysis.validation?.repairAttemptCount ?? 0}</div>
          <div>sourceTurn：{analysis.sourceTurnId ?? "无"}</div>
          <div>cacheKey：{analysis.cacheKey ? analysis.cacheKey.slice(0, 12) : "无"}</div>
        </div>
      ) : null}
      {analysis?.overview ? (
        <div className="detail-hint">
          <div>整体形态：{analysis.overview.rhythmShape}</div>
          <div>节奏总览：{analysis.overview.pacingSummary}</div>
          <div>峰值范围：{analysis.overview.peakRange || "无"}</div>
          <div>转折点：{analysis.overview.turningPoints.join("；") || "无"}</div>
          <div>迁移规律：{analysis.overview.transferableRhythmRule}</div>
          {analysis.overview.uncertainties.length ? <div>不确定：{analysis.overview.uncertainties.join("；")}</div> : null}
        </div>
      ) : null}
      {failed ? (
        <div className="detail-hint">
          <div>节奏结构分析失败，当前没有可展示卡片。请重试或打开运行追踪查看原因。</div>
          {failureMessage ? <div>原因：{failureMessage}</div> : null}
          {debugSnapshotUri ? <div>debugSnapshot：{debugSnapshotUri}</div> : null}
        </div>
      ) : null}
      {cards.length ? (
        <div className="agent-shot-list">
          {cards.map((card, index) => (
            <button
              key={card.cardId}
              className="agent-shot-item agent-script-item"
              type="button"
              onClick={() => onSelectCard(card.start)}
            >
              <strong>R{String(index + 1).padStart(3, "0")}</strong>
              <span className="agent-shot-time">{renderCardTime(card)}</span>
              <b className="agent-shot-summary">{card.label}</b>
              <small title={card.rhythmRole}>{card.rhythmRole}</small>
              <span className="agent-script-meta">shots: {card.shotRefs.join(", ") || "无"}</span>
              <span className="agent-script-meta">pattern: {card.rhythmPattern}</span>
              <span className="agent-script-meta">effect: {card.attentionEffect}</span>
              <span className="agent-script-meta">evidence: {card.evidence.join("；") || "无"}</span>
              <span className="agent-script-meta">rule: {card.transferableRule}</span>
              <span className="agent-script-meta">confidence: {card.confidence} / needReview: {card.needReview ? "是" : "否"}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="detail-hint">{failed ? "本次失败产物已记录，但没有有效 cards。" : "还没有节奏结构结果。运行后会在这里展示总览和卡片。"}</div>
      )}
      {historyEntries.length ? (
        <div className="agent-history-list">
          {historyEntries.slice(-5).reverse().map((entry) => (
            <div key={`${entry.artifactId}_${entry.createdAt}`} className={`agent-history-item ${analysis?.artifactId === entry.artifactId ? "is-current" : ""}`}>
              <strong>{renderRhythmResultOrigin(entry.resultOrigin)}</strong>
              <span>{entry.cardCount} 卡 / source turn {entry.sourceTurnId ? entry.sourceTurnId.slice(-10) : "无"} / cache {entry.cacheKey ? entry.cacheKey.slice(0, 12) : "无"}</span>
              <small>{formatRhythmHistoryMeta(entry)}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function resolveActiveThreadMessage(job?: AgentRunJob | null) {
  if (!job || job.status !== "processing") return null;
  if (!job.agentRun?.threadId || !job.agentRun?.turnId) return null;
  const message = job.activeThreadMessage;
  if (!message?.text?.trim()) return null;
  if (message.threadId && message.threadId !== job.agentRun.threadId) return null;
  if (message.turnId && message.turnId !== job.agentRun.turnId) return null;
  return message;
}
