import type { AgentRunJob, ScriptSegmentArtifact, ScriptSegmentHistoryEntry, StructureCard } from "../../types";
import { formatSecondsCompact } from "../../utils/format";
import { formatScriptHistoryMeta, renderScriptResultOrigin } from "./formatters";

function renderSegmentTime(segment: ScriptSegmentArtifact["segments"][number]) {
  return `${formatSecondsCompact(segment.start)} - ${formatSecondsCompact(segment.end)}`;
}

export function ScriptSegmentPanel({
  analysis,
  analysisHistory,
  currentCard,
  job,
  onRun,
  onSelectSegment,
}: {
  analysis?: ScriptSegmentArtifact | null;
  analysisHistory?: ScriptSegmentHistoryEntry[] | null;
  currentCard?: StructureCard | null;
  job?: AgentRunJob | null;
  onRun: () => void;
  onSelectSegment: (time: number) => void;
}) {
  const running = job?.status === "pending" || job?.status === "processing";
  const segments = analysis?.segments ?? [];
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
        : `${segments.length} / ${segments.length} 段`
      : "等待分析";

  return (
    <section className="property-section agent-run-panel">
      <div className="section-heading">Agent</div>
      <div className="agent-capability-row">
        <div>
          <strong>script-segment</strong>
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
          <div>segmentCount：{segments.length}</div>
          <div>resultOrigin：{renderScriptResultOrigin(analysis.resultOrigin)}</div>
          <div>validation：{analysis.validation?.status ?? "未知"}{analysis.validation?.validatorCode ? ` / ${analysis.validation.validatorCode}` : ""}</div>
          <div>repairAttemptCount：{analysis.validation?.repairAttemptCount ?? 0}</div>
          <div>sourceTurn：{analysis.sourceTurnId ?? "无"}</div>
          <div>cacheKey：{analysis.cacheKey ? analysis.cacheKey.slice(0, 12) : "无"}</div>
        </div>
      ) : null}
      {failed ? (
        <div className="detail-hint">
          <div>脚本段落分析失败，当前没有可展示分段。请重试或打开运行追踪查看原因。</div>
          {failureMessage ? <div>原因：{failureMessage}</div> : null}
          {debugSnapshotUri ? <div>debugSnapshot：{debugSnapshotUri}</div> : null}
        </div>
      ) : null}
      {analysis?.reason ? <div className="detail-hint">原因：{analysis.reason}</div> : null}
      {segments.length ? (
        <div className="agent-shot-list agent-card-list">
          {segments.map((segment, index) => (
            <button
              key={segment.segmentId}
              className={`agent-shot-item agent-script-item ${currentCard?.sourceSegmentId === segment.segmentId ? "active" : ""}`}
              type="button"
              aria-current={currentCard?.sourceSegmentId === segment.segmentId ? "true" : undefined}
              onClick={() => onSelectSegment(segment.start)}
            >
              <strong>S{String(index + 1).padStart(3, "0")}</strong>
              <span className="agent-shot-time">{renderSegmentTime(segment)}</span>
              <b className="agent-shot-summary">{segment.label}</b>
              <small title={segment.roleInScript}>{segment.roleInScript}</small>
              <span className="agent-script-meta">shots: {segment.shotRefs.join(", ") || "无"}</span>
              <span className="agent-script-meta">evidence: {segment.evidence.join("；") || "无"}</span>
              <span className="agent-script-meta">rule: {segment.transferableRule}</span>
              <span className="agent-script-meta">confidence: {segment.confidence} / needReview: {segment.needReview ? "是" : "否"}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="detail-hint">{failed ? "本次失败产物已记录，但没有有效 segments。" : "还没有脚本段落结果。运行后会在这里展示分段。"}</div>
      )}
      {historyEntries.length ? (
        <div className="agent-history-list">
          {historyEntries.slice(-5).reverse().map((entry) => (
            <div key={`${entry.artifactId}_${entry.createdAt}`} className={`agent-history-item ${analysis?.artifactId === entry.artifactId ? "is-current" : ""}`}>
              <strong>{renderScriptResultOrigin(entry.resultOrigin)}</strong>
              <span>{entry.segmentCount} 段 / source turn {entry.sourceTurnId ? entry.sourceTurnId.slice(-10) : "无"} / cache {entry.cacheKey ? entry.cacheKey.slice(0, 12) : "无"}</span>
              <small>{formatScriptHistoryMeta(entry)}</small>
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
