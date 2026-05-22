import type { AgentRunJob, ScriptSegmentArtifact } from "../../types";
import { formatSecondsCompact } from "../../utils/format";

function renderSegmentTime(segment: ScriptSegmentArtifact["segments"][number]) {
  return `${formatSecondsCompact(segment.start)} - ${formatSecondsCompact(segment.end)}`;
}

export function ScriptSegmentPanel({
  analysis,
  job,
  onRun,
}: {
  analysis?: ScriptSegmentArtifact | null;
  job?: AgentRunJob | null;
  onRun: () => void;
}) {
  const running = job?.status === "pending" || job?.status === "processing";
  const segments = analysis?.segments ?? [];
  const statusText = job
    ? `${job.stage} / ${job.progress}%`
    : analysis
      ? `${segments.length} / ${segments.length} 段`
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
      {analysis ? (
        <div className="detail-hint">
          <div>turn：{analysis.agent?.turnId ?? "无"}</div>
          <div>segmentCount：{segments.length}</div>
          <div>validation：{analysis.validation?.status ?? "未知"}{analysis.validation?.validatorCode ? ` / ${analysis.validation.validatorCode}` : ""}</div>
          <div>repairAttemptCount：{analysis.validation?.repairAttemptCount ?? 0}</div>
        </div>
      ) : null}
      {analysis?.reason ? <div className="detail-hint">原因：{analysis.reason}</div> : null}
      {segments.length ? (
        <div className="agent-shot-list">
          {segments.map((segment, index) => (
            <article key={segment.segmentId} className="agent-shot-item agent-script-item">
              <strong>S{String(index + 1).padStart(3, "0")}</strong>
              <span className="agent-shot-time">{renderSegmentTime(segment)}</span>
              <b className="agent-shot-summary">{segment.label}</b>
              <small title={segment.roleInScript}>{segment.roleInScript}</small>
            </article>
          ))}
        </div>
      ) : (
        <div className="detail-hint">还没有脚本段落结果。运行后会在这里展示分段。</div>
      )}
    </section>
  );
}
