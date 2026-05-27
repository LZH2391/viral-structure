import type { AgentRunJob, RhythmStructureArtifact, RhythmStructureHistoryEntry } from "../../types";
import { formatSecondsCompact } from "../../utils/format";
import { AgentTurnTimelinePanel } from "./AgentTurnTimeline";
import { formatRhythmHistoryMeta, renderRhythmResultOrigin } from "./formatters";

type RhythmSection = RhythmStructureArtifact["sections"][number];

function renderSectionTime(section: RhythmSection) {
  return `${formatSecondsCompact(section.start)} - ${formatSecondsCompact(section.end)}`;
}

function renderConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "置信度未知";
  const normalized = Number(value);
  return `${Math.round(Math.max(0, Math.min(1, normalized)) * 100)}%`;
}

function renderFieldPreview(fields: RhythmSection["fields"]) {
  const normalized = Array.isArray(fields) ? fields : [];
  const first = normalized.find((item) => String(item?.value ?? "").trim());
  if (!first) return "无观察";
  const remaining = normalized.filter((item) => String(item?.value ?? "").trim()).length - 1;
  return remaining > 0 ? `${first.label}：${first.value} +${remaining}` : `${first.label}：${first.value}`;
}

function resolveHistorySectionCount(entry: RhythmStructureHistoryEntry) {
  return entry.sectionCount ?? entry.cardCount ?? 0;
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
  const sections = analysis?.sections ?? [];
  const historyEntries = analysisHistory ?? [];
  const overviewFields = Array.isArray(analysis?.overview?.fields) ? analysis.overview.fields : [];
  const uncertainties = Array.isArray(analysis?.overview?.uncertainties) ? analysis.overview.uncertainties : [];
  const failed = analysis?.status === "failed" || analysis?.validation?.status === "failed" || job?.status === "failed";
  const failureMessage = analysis?.reason ?? job?.errorSummary?.message ?? null;
  const debugSnapshotUri = analysis?.debugSnapshotUri ?? job?.errorSummary?.debugSnapshotUri ?? null;
  const statusText = job
    ? `${job.stage} / ${job.progress}%`
    : analysis
      ? failed
        ? "分析失败"
        : `${sections.length} 个区间`
      : "等待分析";

  return (
    <section className="property-section agent-run-panel">
      <div className="section-heading">Agent</div>
      <AgentTurnTimelinePanel agentName="rhythm-structure" statusText={statusText} job={job} running={running} onRun={onRun} />
      {analysis ? (
        <div className="detail-hint">
          <div>turn：{analysis.agent?.turnId ?? "无"}</div>
          <div>status：{analysis.status}</div>
          <div>sectionCount：{sections.length}</div>
          <div>validation：{analysis.validation?.status ?? "未知"}{analysis.validation?.validatorCode ? ` / ${analysis.validation.validatorCode}` : ""}</div>
        </div>
      ) : null}
      {analysis?.overview ? (
        <div className="rhythm-overview-panel">
          <div className="rhythm-overview-heading">
            <span>整体节奏</span>
            <strong>{analysis.overview.summary}</strong>
          </div>
          {overviewFields.length ? (
            <div className="rhythm-overview-grid">
              {overviewFields.map((field, index) => (
                <div key={`${field.label}_${index}`}>
                  <span>{field.label}</span>
                  <strong>{field.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
          {uncertainties.length ? (
            <div className="rhythm-overview-note">不确定：{uncertainties.join("；")}</div>
          ) : null}
        </div>
      ) : null}
      {failed ? (
        <div className="detail-hint">
          <div>节奏结构分析失败，当前没有可展示区间。请重试或打开运行追踪查看原因。</div>
          {failureMessage ? <div>原因：{failureMessage}</div> : null}
          {debugSnapshotUri ? <div>debugSnapshot：{debugSnapshotUri}</div> : null}
        </div>
      ) : null}
      {sections.length ? (
        <div className="agent-shot-list rhythm-card-list">
          {sections.map((section, index) => {
            const fields = Array.isArray(section.fields) ? section.fields : [];
            const shotRefs = Array.isArray(section.shotRefs) ? section.shotRefs : [];
            return (
              <button
                key={section.sectionId}
                className="rhythm-card-item"
                type="button"
                onClick={() => onSelectCard(Number(section.start) || 0)}
              >
                <span className="rhythm-card-index">R{String(index + 1).padStart(3, "0")}</span>
                <span className={`rhythm-card-badge ${section.needReview ? "needs-review" : ""}`}>
                  {section.needReview ? "需复核" : renderConfidence(section.confidence)}
                </span>
                <span className="rhythm-card-time">{renderSectionTime(section)}</span>
                <strong className="rhythm-card-title">{section.label}</strong>
                {fields.map((field, fieldIndex) => (
                  <span key={`${section.sectionId}_${field.label}_${fieldIndex}`} className="rhythm-card-block">
                    <b>{field.label}</b>
                    <small>{field.value}</small>
                  </span>
                ))}
                <span className="rhythm-card-meta" title={fields.map((field) => `${field.label}：${field.value}`).join("；") || undefined}>
                  shots {shotRefs.join(", ") || "无"} / 观察：{renderFieldPreview(fields)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="detail-hint">{failed ? "本次失败产物已记录，但没有有效 sections。" : "还没有节奏结构结果。运行后会在这里展示总览和区间。"}</div>
      )}
      {historyEntries.length ? (
        <div className="agent-history-list">
          {historyEntries.slice(-5).reverse().map((entry) => (
            <div key={`${entry.artifactId}_${entry.createdAt}`} className={`agent-history-item ${analysis?.artifactId === entry.artifactId ? "is-current" : ""}`}>
              <strong>{renderRhythmResultOrigin(entry.resultOrigin)}</strong>
              <span>{resolveHistorySectionCount(entry)} 区间 / source turn {entry.sourceTurnId ? entry.sourceTurnId.slice(-10) : "无"} / cache {entry.cacheKey ? entry.cacheKey.slice(0, 12) : "无"}</span>
              <small>{formatRhythmHistoryMeta(entry)}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
