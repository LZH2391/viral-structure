import type { AgentRunJob, FunctionSlotAtomizationArtifact, FunctionSlotAtomizationHistoryEntry } from "../../types";
import { shortTurnId } from "./formatters";

export function FunctionSlotAtomizationPanel({
  analysis,
  analysisHistory,
  job,
  hasRequiredInputs,
  onRun,
}: {
  analysis?: FunctionSlotAtomizationArtifact | null;
  analysisHistory?: FunctionSlotAtomizationHistoryEntry[] | null;
  job?: AgentRunJob | null;
  hasRequiredInputs: boolean;
  onRun: () => void;
}) {
  const running = job?.status === "pending" || job?.status === "processing";
  const slots = analysis?.slotMap?.slots ?? [];
  const bindings = analysis?.bindingGraph?.bindings ?? [];
  const scriptAtomCount = analysis?.atomInventory?.scriptAtoms?.length ?? 0;
  const rhythmAtomCount = analysis?.atomInventory?.rhythmAtoms?.length ?? 0;
  const packagingAtomCount = analysis?.atomInventory?.packagingAtoms?.length ?? 0;
  const historyEntries = analysisHistory ?? [];
  const failed = analysis?.status === "failed" || analysis?.validation?.status === "failed" || job?.status === "failed";
  const activeThreadMessage = resolveActiveThreadMessage(job);
  const statusText = job
    ? `${job.stage} / ${job.progress}%`
    : analysis
      ? failed
        ? "分析失败"
        : `${slots.length} 槽位 / ${scriptAtomCount + rhythmAtomCount + packagingAtomCount} 原子`
      : hasRequiredInputs
        ? "等待分析"
        : "等待三份上游分析";

  return (
    <section className="property-section agent-run-panel">
      <div className="section-heading">Agent</div>
      <div className="agent-capability-row">
        <div>
          <strong>function-slot-atomization</strong>
          <span>{statusText}</span>
        </div>
        <button className="primary-button" type="button" disabled={running || !hasRequiredInputs} onClick={onRun}>
          {running ? "运行中" : "运行"}
        </button>
      </div>
      {!hasRequiredInputs ? (
        <div className="detail-hint">请先完成脚本段落、节奏结构、包装结构三份分析，再运行原子化。</div>
      ) : null}
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
          <div>slots：{slots.length} / bindings：{bindings.length}</div>
          <div>atoms：脚本 {scriptAtomCount} / 节奏 {rhythmAtomCount} / 包装 {packagingAtomCount}</div>
          <div>validation：{analysis.validation?.status ?? "未知"}{analysis.validation?.validatorCode ? ` / ${analysis.validation.validatorCode}` : ""}</div>
        </div>
      ) : null}
      {failed ? (
        <div className="detail-hint">
          <div>功能槽位原子化失败，当前没有可展示槽位链。请重试或打开运行追踪查看原因。</div>
          {analysis?.reason ?? job?.errorSummary?.message ? <div>原因：{analysis?.reason ?? job?.errorSummary?.message}</div> : null}
          {analysis?.debugSnapshotUri ?? job?.errorSummary?.debugSnapshotUri ? <div>debugSnapshot：{analysis?.debugSnapshotUri ?? job?.errorSummary?.debugSnapshotUri}</div> : null}
        </div>
      ) : null}
      {slots.length ? (
        <div className="agent-shot-list rhythm-card-list">
          {slots.map((slot, index) => (
            <div key={slot.slotId} className="rhythm-card-item">
              <span className="rhythm-card-index">F{String(index + 1).padStart(3, "0")}</span>
              <span className={`rhythm-card-badge ${slot.needReview ? "needs-review" : ""}`}>
                {slot.needReview ? "需复核" : renderConfidence(slot.confidence)}
              </span>
              <span className="rhythm-card-time">{slot.slotType}</span>
              <strong className="rhythm-card-title">{slot.slotName}</strong>
              <span className="rhythm-card-meta">{slot.viewerStateBefore || "未知状态"} → {slot.viewerStateAfter || "未知状态"}</span>
              <span className="rhythm-card-meta">{slot.persuasionTask}</span>
              <div className="rhythm-card-block-list">
                <span className="rhythm-card-block"><b>脚本原子</b><small>{slot.scriptAtomIds.join(", ")}</small></span>
                <span className="rhythm-card-block"><b>节奏原子</b><small>{slot.rhythmAtomIds.join(", ")}</small></span>
                <span className="rhythm-card-block"><b>包装原子</b><small>{slot.packagingAtomIds.join(", ")}</small></span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="detail-hint">{failed ? "本次失败产物已记录，但没有有效 slot_map.slots。" : "运行后会在这里展示功能槽位链、原子绑定和重组规则摘要。"}</div>
      )}
      {analysis?.recombinationRules?.length ? (
        <div className="agent-history-list">
          <strong>重组规则</strong>
          {analysis.recombinationRules.slice(0, 8).map((rule) => (
            <div key={rule.id} className="agent-history-item">
              <strong>{rule.id}</strong>
              <small>{rule.reason}</small>
              {rule.appliesTo.length ? <span>applies：{rule.appliesTo.join(", ")}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {bindings.length ? (
        <div className="agent-history-list">
          <strong>绑定关系</strong>
          {bindings.slice(0, 8).map((binding) => (
            <div key={binding.id} className="agent-history-item">
              <strong>{binding.type} / {binding.id}</strong>
              <small>{binding.rule}</small>
              {binding.riskIfBroken ? <span>风险：{binding.riskIfBroken}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {historyEntries.length ? (
        <div className="agent-history-list">
          {historyEntries.slice(-5).reverse().map((entry) => (
            <div key={`${entry.artifactId}_${entry.createdAt}`} className={`agent-history-item ${analysis?.artifactId === entry.artifactId ? "is-current" : ""}`}>
              <strong>{renderOrigin(entry.resultOrigin)}</strong>
              <span>{entry.slotCount} 槽位 / {entry.bindingCount} 关系</span>
              <small>{formatHistoryMeta(entry)}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function renderConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "置信度未知";
  return `${Math.round(Math.max(0, Math.min(1, Number(value))) * 100)}%`;
}

function renderOrigin(origin?: string) {
  if (origin === "repaired_turn") return "repaired turn";
  if (origin === "cache_reuse") return "cache reuse";
  if (origin === "failed_validation") return "failed validation";
  return "new turn";
}

function formatHistoryMeta(entry: FunctionSlotAtomizationHistoryEntry) {
  const time = entry.createdAt ? new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false }) : "未知时间";
  const turn = entry.turnId ? shortTurnId(entry.turnId) : "无";
  const validator = entry.validatorCode ? ` / ${entry.validatorCode}` : "";
  return `${time} / turn ${turn}${validator}`;
}

function resolveActiveThreadMessage(job?: AgentRunJob | null) {
  if (!job || job.status !== "processing") return null;
  const message = job.activeThreadMessage;
  if (!message?.text?.trim()) return null;
  return message;
}
