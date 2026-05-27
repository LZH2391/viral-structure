import type { AgentRunJob, PackagingField, PackagingStructureArtifact, PackagingStructureHistoryEntry } from "../../types";
import { formatSecondsCompact } from "../../utils/format";
import { AgentTurnTimelinePanel } from "./AgentTurnTimeline";
import { formatPackagingHistoryMeta, renderPackagingResultOrigin } from "./formatters";

type PackagingBlock = PackagingStructureArtifact["packagingBlocks"][number];

function renderRange(item: { start?: number | null; end?: number | null }) {
  if (!Number.isFinite(item.start) || !Number.isFinite(item.end)) return "时间未知";
  return `${formatSecondsCompact(Number(item.start))} - ${formatSecondsCompact(Number(item.end))}`;
}

function renderConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "置信度未知";
  return `${Math.round(Math.max(0, Math.min(1, Number(value))) * 100)}%`;
}

function FieldList({ fields }: { fields?: PackagingField[] | null }) {
  const items = Array.isArray(fields) ? fields.filter((field) => String(field?.value ?? "").trim()) : [];
  if (!items.length) return null;
  return (
    <div className="rhythm-card-block-list">
      {items.map((field, index) => (
        <span key={`${field.label}_${index}`} className="rhythm-card-block">
          <b>{field.label}</b>
          <small>{field.value}</small>
        </span>
      ))}
    </div>
  );
}

export function PackagingStructurePanel({
  analysis,
  analysisHistory,
  job,
  onRun,
  onSelectPackagingBlock,
}: {
  analysis?: PackagingStructureArtifact | null;
  analysisHistory?: PackagingStructureHistoryEntry[] | null;
  job?: AgentRunJob | null;
  onRun: () => void;
  onSelectPackagingBlock: (time: number) => void;
}) {
  const running = job?.status === "pending" || job?.status === "processing";
  const notes = analysis?.shotPackagingNotes ?? [];
  const blocks = analysis?.packagingBlocks ?? [];
  const historyEntries = analysisHistory ?? [];
  const failed = analysis?.status === "failed" || analysis?.validation?.status === "failed" || job?.status === "failed";
  const failureMessage = analysis?.reason ?? job?.errorSummary?.message ?? null;
  const debugSnapshotUri = analysis?.debugSnapshotUri ?? job?.errorSummary?.debugSnapshotUri ?? null;
  const overviewFields = Array.isArray(analysis?.overview?.fields) ? analysis.overview.fields : [];
  const uncertainties = Array.isArray(analysis?.overview?.uncertainties) ? analysis.overview.uncertainties : [];
  const statusText = job
    ? `${job.stage} / ${job.progress}%`
    : analysis
      ? failed
        ? "分析失败"
        : `${notes.length} 镜 / ${blocks.length} 包装块`
      : "等待分析";

  return (
    <section className="property-section agent-run-panel">
      <div className="section-heading">Agent</div>
      <AgentTurnTimelinePanel agentName="packaging-structure" statusText={statusText} job={job} running={running} onRun={onRun} />
      {analysis ? (
        <div className="detail-hint">
          <div>turn：{analysis.agent?.turnId ?? "无"}</div>
          <div>status：{analysis.status}</div>
          <div>shotNotes：{notes.length} / packagingBlocks：{blocks.length}</div>
          <div>validation：{analysis.validation?.status ?? "未知"}{analysis.validation?.validatorCode ? ` / ${analysis.validation.validatorCode}` : ""}</div>
        </div>
      ) : null}
      {analysis?.overview ? (
        <div className="rhythm-overview-panel">
          <div className="rhythm-overview-heading">
            <span>整体包装</span>
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
          {uncertainties.length ? <div className="rhythm-overview-note">不确定：{uncertainties.join("；")}</div> : null}
        </div>
      ) : null}
      {failed ? (
        <div className="detail-hint">
          <div>包装结构分析失败，当前没有可展示包装结构。请重试或打开运行追踪查看原因。</div>
          {failureMessage ? <div>原因：{failureMessage}</div> : null}
          {debugSnapshotUri ? <div>debugSnapshot：{debugSnapshotUri}</div> : null}
        </div>
      ) : null}
      {blocks.length ? (
        <div className="agent-shot-list rhythm-card-list">
          {blocks.map((block, index) => (
            <PackagingBlockButton
              key={block.blockId}
              block={block}
              index={index}
              onSelect={() => onSelectPackagingBlock(Number(block.start) || 0)}
            />
          ))}
        </div>
      ) : (
        <div className="detail-hint">{failed ? "本次失败产物已记录，但没有有效 packagingBlocks。" : "还没有包装结构结果。运行后会在这里展示总览、包装块和逐镜观察。"}</div>
      )}
      {notes.length ? (
        <div className="agent-history-list">
          <strong>逐镜包装观察</strong>
          {notes.map((note, index) => (
            <button key={note.noteId} className="agent-history-item" type="button" onClick={() => onSelectPackagingBlock(Number(note.start) || 0)}>
              <strong>{note.shotNo ?? `P${String(index + 1).padStart(3, "0")}`} / {note.shotRef}</strong>
              <span>{renderRange(note)} / {note.needReview ? "需复核" : renderConfidence(note.confidence)}</span>
              <small>{note.packagingFunction}</small>
              <FieldList fields={note.fields} />
            </button>
          ))}
        </div>
      ) : null}
      {analysis ? (
        <div className="agent-history-list">
          <strong>卖点/证据/转化包装</strong>
          {analysis.claimStack.map((item) => (
            <div key={item.claimId} className="agent-history-item">
              <strong>承诺：{item.label}</strong>
              <span>shots {item.shotRefs.join(", ") || "无"} / {renderRange(item)}</span>
              <FieldList fields={item.fields} />
            </div>
          ))}
          {analysis.proofStack.map((item) => (
            <div key={item.proofId} className="agent-history-item">
              <strong>证据：{item.label}</strong>
              <span>shots {item.shotRefs.join(", ") || "无"} / {renderRange(item)}</span>
              <FieldList fields={item.fields} />
            </div>
          ))}
          {analysis.conversionWrap ? (
            <div className="agent-history-item">
              <strong>转化：{analysis.conversionWrap.summary}</strong>
              <span>shots {analysis.conversionWrap.shotRefs.join(", ") || "无"} / {renderRange(analysis.conversionWrap)}</span>
              <FieldList fields={analysis.conversionWrap.fields} />
            </div>
          ) : null}
        </div>
      ) : null}
      {historyEntries.length ? (
        <div className="agent-history-list">
          {historyEntries.slice(-5).reverse().map((entry) => (
            <div key={`${entry.artifactId}_${entry.createdAt}`} className={`agent-history-item ${analysis?.artifactId === entry.artifactId ? "is-current" : ""}`}>
              <strong>{renderPackagingResultOrigin(entry.resultOrigin)}</strong>
              <span>{entry.shotPackagingNoteCount} 镜 / {entry.packagingBlockCount} 包装块</span>
              <small>{formatPackagingHistoryMeta(entry)}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PackagingBlockButton({ block, index, onSelect }: { block: PackagingBlock; index: number; onSelect: () => void }) {
  return (
    <button className="rhythm-card-item" type="button" onClick={onSelect}>
      <span className="rhythm-card-index">P{String(index + 1).padStart(3, "0")}</span>
      <span className={`rhythm-card-badge ${block.needReview ? "needs-review" : ""}`}>
        {block.needReview ? "需复核" : renderConfidence(block.confidence)}
      </span>
      <span className="rhythm-card-time">{renderRange(block)}</span>
      <strong className="rhythm-card-title">{block.label}</strong>
      <FieldList fields={block.fields} />
      <span className="rhythm-card-meta">shots {block.shotRefs.join(", ") || "无"} / {block.packagingFunction}</span>
    </button>
  );
}
