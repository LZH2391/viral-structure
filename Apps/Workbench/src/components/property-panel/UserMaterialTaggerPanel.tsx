import type { AgentRunJob, UserMaterialPackArtifact, UserMaterialPackHistoryEntry } from "../../types";
import { formatSecondsCompact } from "../../utils/format";
import { AgentTurnTimelinePanel } from "./AgentTurnTimeline";

type ShotCard = UserMaterialPackArtifact["shotCards"][number];

function renderRange(card: ShotCard) {
  const range = card.timeRange;
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) return "时间未知";
  return `${formatSecondsCompact(range.start)} - ${formatSecondsCompact(range.end)}`;
}

function renderConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "置信度未知";
  return `${Math.round(Math.max(0, Math.min(1, Number(value))) * 100)}%`;
}

function renderHistoryOrigin(value: string | null | undefined) {
  if (value === "cache_reuse") return "复用缓存";
  if (value === "repaired_turn") return "修复结果";
  if (value === "failed_validation") return "校验失败";
  return "新识别";
}

export function UserMaterialTaggerPanel({
  analysis,
  analysisHistory,
  job,
  onRun,
  onSelectShot,
}: {
  analysis?: UserMaterialPackArtifact | null;
  analysisHistory?: UserMaterialPackHistoryEntry[] | null;
  job?: AgentRunJob | null;
  onRun: () => void;
  onSelectShot: (time: number) => void;
}) {
  const running = job?.status === "pending" || job?.status === "processing";
  const cards = analysis?.shotCards ?? [];
  const groups = analysis?.materialGroups ?? [];
  const proof = analysis?.proofCoverage ?? [];
  const historyEntries = analysisHistory ?? [];
  const failed = analysis?.status === "failed" || analysis?.validation?.status === "failed" || job?.status === "failed";
  const failureMessage = job?.errorSummary?.message ?? null;
  const debugSnapshotUri = job?.errorSummary?.debugSnapshotUri ?? null;
  const statusText = job
    ? `${job.stage} / ${job.progress}%`
    : analysis
      ? failed
        ? "识别失败"
        : `${cards.length} 镜 / ${groups.length} 组 / ${proof.length} 证明类`
      : "等待识别";

  return (
    <section className="property-section agent-run-panel">
      <div className="section-heading">Agent</div>
      <AgentTurnTimelinePanel agentName="user-material-tagger" statusText={statusText} job={job} running={running} onRun={onRun} />
      {analysis ? (
        <div className="detail-hint">
          <div>status：{analysis.status}</div>
          <div>shotCards：{cards.length} / materialGroups：{groups.length} / proofCoverage：{proof.length}</div>
          <div>validation：{analysis.validation?.status ?? "未知"}{analysis.validation?.validatorCode ? ` / ${analysis.validation.validatorCode}` : ""}</div>
        </div>
      ) : null}
      {failed ? (
        <div className="detail-hint">
          <div>素材识别失败，当前没有可展示素材卡。请重试或打开运行追踪查看原因。</div>
          {failureMessage ? <div>原因：{failureMessage}</div> : null}
          {debugSnapshotUri ? <div>debugSnapshot：{debugSnapshotUri}</div> : null}
        </div>
      ) : null}
      {analysis?.restructureInputSummary ? (
        <div className="rhythm-overview-panel">
          <div className="rhythm-overview-heading">
            <span>重组可用性</span>
            <strong>{analysis.restructureInputSummary.recommendedUse?.[0] ?? "已生成素材识别包"}</strong>
          </div>
          <div className="rhythm-overview-grid">
            <div>
              <span>强素材</span>
              <strong>{analysis.restructureInputSummary.strongMaterialAreas?.length ?? 0}</strong>
            </div>
            <div>
              <span>弱素材</span>
              <strong>{analysis.restructureInputSummary.weakMaterialAreas?.length ?? 0}</strong>
            </div>
            <div>
              <span>缺口</span>
              <strong>{analysis.restructureInputSummary.missingMaterialAreas?.length ?? 0}</strong>
            </div>
          </div>
        </div>
      ) : null}
      {cards.length ? (
        <div className="agent-shot-list rhythm-card-list">
          {cards.map((card, index) => (
            <button
              key={`${card.shotRef}_${index}`}
              className="rhythm-card-item"
              type="button"
              onClick={() => onSelectShot(card.timeRange?.start ?? 0)}
            >
              <span className="rhythm-card-index">{card.shotNo ?? `M${String(index + 1).padStart(3, "0")}`}</span>
              <span className={`rhythm-card-badge ${card.needReview ? "needs-review" : ""}`}>
                {card.needReview ? "需复核" : renderConfidence(card.confidence)}
              </span>
              <span className="rhythm-card-time">{renderRange(card)}</span>
              <strong className="rhythm-card-title">{card.shotClass}</strong>
              <span className="rhythm-card-block">
                <b>功能</b>
                <small>{card.shotFunctions.slice(0, 3).join(" / ") || "未标注"}</small>
              </span>
              <span className="rhythm-card-block">
                <b>标签</b>
                <small>{card.materialTags.slice(0, 4).join(" / ") || "无"}</small>
              </span>
              <span className="rhythm-card-meta">{card.visualSummary}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="detail-hint">{failed ? "本次失败产物已记录，但没有有效 shotCards。" : "还没有素材识别结果。运行后会在这里展示素材卡和运行追踪。"}</div>
      )}
      {proof.length ? (
        <div className="agent-history-list">
          <strong>证明覆盖</strong>
          {proof.map((item) => (
            <div key={item.proofNeedClass} className="agent-history-item">
              <strong>{item.proofNeedClass} / {item.coverage}</strong>
              <span>shots {item.candidateShots.join(", ") || "无"} / groups {item.candidateGroups.join(", ") || "无"}</span>
              <small>{item.reason}</small>
            </div>
          ))}
        </div>
      ) : null}
      {historyEntries.length ? (
        <div className="agent-history-list">
          {historyEntries.slice(-5).reverse().map((entry) => (
            <div key={`${entry.artifactId}_${entry.createdAt}`} className={`agent-history-item ${analysis?.artifactId === entry.artifactId ? "is-current" : ""}`}>
              <strong>{renderHistoryOrigin(entry.resultOrigin)}</strong>
              <span>{entry.shotCardCount} 镜 / {entry.materialGroupCount} 组 / {entry.proofCoverageCount} 证明类</span>
              <small>turn {entry.turnId ? entry.turnId.slice(-10) : "无"} / cache {entry.cacheKey ? entry.cacheKey.slice(0, 12) : "无"}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
