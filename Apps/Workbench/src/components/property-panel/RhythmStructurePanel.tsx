import type { AgentRunJob, RhythmStructureArtifact, RhythmStructureHistoryEntry } from "../../types";
import { formatSecondsCompact } from "../../utils/format";
import { formatRhythmHistoryMeta, renderRhythmResultOrigin } from "./formatters";

function renderCardTime(card: RhythmStructureArtifact["cards"][number]) {
  return `${formatSecondsCompact(card.start)} - ${formatSecondsCompact(card.end)}`;
}

function renderConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "置信度未知";
  const normalized = Number(value);
  return `${Math.round(Math.max(0, Math.min(1, normalized)) * 100)}%`;
}

function renderEvidencePreview(evidence: string[]) {
  const first = evidence.find((item) => item.trim());
  if (!first) return "无证据";
  const remaining = evidence.filter((item) => item.trim()).length - 1;
  return remaining > 0 ? `${first} +${remaining}` : first;
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
        <div className="rhythm-overview-panel">
          <div className="rhythm-overview-heading">
            <span>整体节奏</span>
            <strong>{analysis.overview.rhythmShape}</strong>
          </div>
          <div className="rhythm-overview-grid">
            <div>
              <span>走势</span>
              <strong>{analysis.overview.pacingSummary}</strong>
            </div>
            <div>
              <span>峰值</span>
              <strong>{analysis.overview.peakRange || "无"}</strong>
            </div>
            <div>
              <span>转折</span>
              <strong>{analysis.overview.turningPoints.join("；") || "无"}</strong>
            </div>
            <div>
              <span>迁移</span>
              <strong>{analysis.overview.transferableRhythmRule}</strong>
            </div>
          </div>
          {analysis.overview.uncertainties.length ? (
            <div className="rhythm-overview-note">不确定：{analysis.overview.uncertainties.join("；")}</div>
          ) : null}
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
        <div className="agent-shot-list rhythm-card-list">
          {cards.map((card, index) => (
            <button
              key={card.cardId}
              className="rhythm-card-item"
              type="button"
              onClick={() => onSelectCard(card.start)}
            >
              <span className="rhythm-card-index">R{String(index + 1).padStart(3, "0")}</span>
              <span className={`rhythm-card-badge ${card.needReview ? "needs-review" : ""}`}>
                {card.needReview ? "需复核" : renderConfidence(card.confidence)}
              </span>
              <span className="rhythm-card-time">{renderCardTime(card)}</span>
              <strong className="rhythm-card-title">{card.label}</strong>
              <span className="rhythm-card-role">{card.rhythmRole}</span>
              <span className="rhythm-card-pattern">{card.rhythmPattern}</span>
              <span className="rhythm-card-block">
                <b>观感作用</b>
                <small>{card.attentionEffect}</small>
              </span>
              <span className="rhythm-card-block">
                <b>迁移规则</b>
                <small>{card.transferableRule}</small>
              </span>
              <span className="rhythm-card-meta" title={card.evidence.join("；") || undefined}>
                shots {card.shotRefs.join(", ") || "无"} / 证据：{renderEvidencePreview(card.evidence)}
              </span>
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
