import { useMemo, useRef, useState } from "react";
import type { AgentRunJob, FunctionSlotAtomizationArtifact, FunctionSlotAtomizationHistoryEntry, FunctionSlotBoundaryReviewIssue } from "../../types";
import { shortTurnId } from "./formatters";

export function FunctionSlotAtomizationPanel({
  analysis,
  analysisHistory,
  job,
  hasRequiredInputs,
  onRun,
  onManualBoundaryEdit,
}: {
  analysis?: FunctionSlotAtomizationArtifact | null;
  analysisHistory?: FunctionSlotAtomizationHistoryEntry[] | null;
  job?: AgentRunJob | null;
  hasRequiredInputs: boolean;
  onRun: () => void;
  onManualBoundaryEdit: (editedJsonText: string) => Promise<void>;
}) {
  const [manualEditorOpen, setManualEditorOpen] = useState(false);
  const running = job?.status === "pending" || job?.status === "processing";
  const slots = analysis?.slotMap?.slots ?? [];
  const bindings = analysis?.bindingGraph?.bindings ?? [];
  const scriptAtomCount = analysis?.atomInventory?.scriptAtoms?.length ?? 0;
  const rhythmAtomCount = analysis?.atomInventory?.rhythmAtoms?.length ?? 0;
  const packagingAtomCount = analysis?.atomInventory?.packagingAtoms?.length ?? 0;
  const historyEntries = analysisHistory ?? [];
  const failed = analysis?.status === "failed" || analysis?.validation?.status === "failed" || job?.status === "failed";
  const needsManualBoundaryEdit = shouldShowManualBoundaryEdit(analysis);
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
          {analysis.boundaryReview ? <div>boundary review：{analysis.boundaryReview.decision}{analysis.boundaryReview.issues?.length ? ` / issues ${analysis.boundaryReview.issues.length}` : ""}</div> : null}
        </div>
      ) : null}
      {needsManualBoundaryEdit ? (
        <div className="manual-boundary-callout">
          <div>
            <strong>需要人工修正字段边界</strong>
            <span>第二次 boundary review 仍返回 rework，请手动修改指定字段并提交落地。</span>
          </div>
          <button className="primary-button" type="button" onClick={() => setManualEditorOpen(true)}>
            打开修正
          </button>
        </div>
      ) : null}
      {analysis && !needsManualBoundaryEdit ? (
        <div className="manual-boundary-test-entry">
          <div>
            <strong>临时测试入口</strong>
            <span>仅用于测试手动修正小窗；提交仍按后端正式条件校验，测完删除。</span>
          </div>
          <button className="ghost-button" type="button" onClick={() => setManualEditorOpen(true)}>
            测试小窗
          </button>
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
      {manualEditorOpen && analysis ? (
        <BoundaryManualEditDialog
          analysis={analysis}
          onClose={() => setManualEditorOpen(false)}
          onSubmit={async (editedJsonText) => {
            await onManualBoundaryEdit(editedJsonText);
            setManualEditorOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function renderConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "置信度未知";
  return `${Math.round(Math.max(0, Math.min(1, Number(value))) * 100)}%`;
}

function renderOrigin(origin?: string) {
  if (origin === "manual_boundary_edit") return "manual boundary edit";
  if (origin === "boundary_reworked_turn") return "boundary reworked turn";
  if (origin === "repaired_turn") return "repaired turn";
  if (origin === "cache_reuse") return "cache reuse";
  if (origin === "failed_validation") return "failed validation";
  return "new turn";
}

function BoundaryManualEditDialog({
  analysis,
  onClose,
  onSubmit,
}: {
  analysis: FunctionSlotAtomizationArtifact;
  onClose: () => void;
  onSubmit: (editedJsonText: string) => Promise<void>;
}) {
  const initialJson = useMemo(() => stringifyRawAtomization(analysis), [analysis]);
  const issues = analysis.boundaryReview?.issues ?? [];
  const [text, setText] = useState(initialJson);
  const [selectedPath, setSelectedPath] = useState<string | null>(firstIssuePath(issues));
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const jumpToPath = (path: string | null) => {
    setSelectedPath(path);
    if (!path) return;
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const range = findJsonPathRange(textarea.value, path);
      textarea.focus();
      if (!range) return;
      textarea.setSelectionRange(range.start, range.end);
      const line = textarea.value.slice(0, range.start).split("\n").length;
      const lineHeight = 19;
      textarea.scrollTop = Math.max(0, (line - 4) * lineHeight);
    });
  };

  const validateJson = () => {
    try {
      const parsed = JSON.parse(text);
      const hasCore = parsed && typeof parsed === "object"
        && "atom_inventory" in parsed
        && "slot_map" in parsed
        && "binding_graph" in parsed;
      setStatus(hasCore ? "JSON 结构可提交" : "JSON 可解析，但缺少原子化核心字段");
      return hasCore;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "JSON 解析失败");
      return false;
    }
  };

  const submit = async () => {
    if (!validateJson()) return;
    setSubmitting(true);
    setStatus("提交中");
    try {
      await onSubmit(text);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "提交失败");
      setSubmitting(false);
    }
  };

  return (
    <div className="cache-dialog-backdrop manual-boundary-backdrop" role="presentation">
      <section className="manual-boundary-dialog" role="dialog" aria-modal="true" aria-labelledby="manualBoundaryTitle">
        <header className="manual-boundary-header">
          <div>
            <h2 id="manualBoundaryTitle">手动修正字段边界</h2>
            <p>只改 reviewer 指出的字段。提交后会生成新的人工修正版原子化 artifact。</p>
          </div>
          <button className="ghost-button" type="button" onClick={onClose} disabled={submitting}>关闭</button>
        </header>
        <div className="manual-boundary-body">
          <aside className="manual-boundary-issues">
            <strong>需要修正的字段</strong>
            {issues.length ? issues.map((issue, index) => (
              <button
                key={`${issue.issue}_${index}`}
                className={`manual-boundary-issue ${issuePaths(issue).includes(selectedPath ?? "") ? "active" : ""}`}
                type="button"
                onClick={() => jumpToPath(issuePaths(issue)[0] ?? null)}
              >
                <span>{issuePaths(issue)[0] ?? `issue ${index + 1}`}</span>
                <small>{issue.issue}</small>
                <em>{issue.minimalFix ?? issue.minimal_fix ?? "按 reviewer 建议做最小修复"}</em>
              </button>
            )) : <div className="detail-hint">review 没有返回 issues，但当前结论仍是 rework。</div>}
          </aside>
          <div className="manual-boundary-editor">
            <div className="manual-boundary-editor-bar">
              <span>{selectedPath ? `当前字段：${selectedPath}` : "完整 JSON"}</span>
              <button className="ghost-button" type="button" onClick={validateJson}>校验 JSON</button>
            </div>
            <textarea ref={textareaRef} value={text} spellCheck={false} onChange={(event) => setText(event.currentTarget.value)} />
            {status ? <div className="detail-hint">{status}</div> : null}
          </div>
        </div>
        <footer className="manual-boundary-actions">
          <button className="ghost-button" type="button" onClick={() => setText(initialJson)} disabled={submitting}>还原</button>
          <button className="ghost-button" type="button" onClick={onClose} disabled={submitting}>取消</button>
          <button className="primary-button" type="button" onClick={submit} disabled={submitting}>{submitting ? "提交中" : "提交并落地"}</button>
        </footer>
      </section>
    </div>
  );
}

function shouldShowManualBoundaryEdit(analysis?: FunctionSlotAtomizationArtifact | null) {
  if (!analysis || analysis.status !== "processed") return false;
  if (analysis.resultOrigin === "manual_boundary_edit") return false;
  if (analysis.boundaryReview?.manuallyResolved) return false;
  if (analysis.boundaryReview?.decision !== "rework") return false;
  const reviewAttemptCount = Number(analysis.boundaryReview.reviewAttemptCount ?? 0);
  const reworkAttemptCount = Number(analysis.validation?.boundaryReworkAttemptCount ?? 0);
  const reviewHistory = analysis.boundaryReviewHistory ?? [];
  return reviewAttemptCount >= 2 || reworkAttemptCount >= 1 || reviewHistory.filter((item) => item.decision === "rework").length >= 2;
}

function issuePaths(issue: FunctionSlotBoundaryReviewIssue) {
  return issue.fieldPaths ?? issue.field_paths ?? [];
}

function firstIssuePath(issues: FunctionSlotBoundaryReviewIssue[]) {
  return issues.flatMap(issuePaths)[0] ?? null;
}

function findJsonPathRange(text: string, path: string) {
  const keys = path.match(/[A-Za-z0-9_$-]+(?=(?:\[\d+\])?\.?)/g) ?? [];
  const key = keys[keys.length - 1];
  if (!key) return null;
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:`);
  const match = pattern.exec(text);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringifyRawAtomization(analysis: FunctionSlotAtomizationArtifact) {
  return JSON.stringify(toRawAtomizationJson(analysis), null, 2);
}

function toRawAtomizationJson(analysis: FunctionSlotAtomizationArtifact) {
  return {
    atom_inventory: {
      script_atoms: analysis.atomInventory.scriptAtoms.map((atom) => toRawAtom(atom, "script")),
      rhythm_atoms: analysis.atomInventory.rhythmAtoms.map((atom) => toRawAtom(atom, "rhythm")),
      packaging_atoms: analysis.atomInventory.packagingAtoms.map((atom) => toRawAtom(atom, "packaging")),
    },
    slot_map: {
      slots: analysis.slotMap.slots.map((slot) => ({
        slot_id: slot.slotId,
        slot_order: slot.slotOrder,
        slot_name: slot.slotName,
        slot_type: slot.slotType,
        viewer_state_before: slot.viewerStateBefore,
        viewer_state_after: slot.viewerStateAfter,
        persuasion_task: slot.persuasionTask,
        script_atom_ids: slot.scriptAtomIds,
        rhythm_atom_ids: slot.rhythmAtomIds,
        packaging_atom_ids: slot.packagingAtomIds,
        required_sync_points: slot.requiredSyncPoints,
        substitution_rules: slot.substitutionRules,
        source_refs: toRawSourceRefs(slot.sourceRefs),
        confidence: slot.confidence,
        need_review: slot.needReview,
      })),
    },
    binding_graph: {
      bindings: analysis.bindingGraph.bindings.map((binding) => ({
        id: binding.id,
        type: binding.type,
        slot_ids: binding.slotIds,
        atom_ids: binding.atomIds,
        rule: binding.rule,
        risk_if_broken: binding.riskIfBroken,
        confidence: binding.confidence,
      })),
    },
    conflict_checks: analysis.conflictChecks.map((rule) => ({
      id: rule.id,
      slot_ids: rule.slotIds,
      atom_ids: rule.atomIds,
      reason: rule.reason,
      fix: rule.fix,
      applies_to: (rule as { appliesTo?: string[] }).appliesTo ?? [],
      source_binding_ids: (rule as { sourceBindingIds?: string[] }).sourceBindingIds ?? [],
    })),
    recombination_rules: analysis.recombinationRules.map((rule) => ({
      id: rule.id,
      slot_ids: (rule as { slotIds?: string[] }).slotIds ?? [],
      atom_ids: (rule as { atomIds?: string[] }).atomIds ?? [],
      reason: rule.reason,
      fix: (rule as { fix?: string }).fix ?? "",
      applies_to: rule.appliesTo,
      source_binding_ids: rule.sourceBindingIds,
    })),
    recomposition_templates: analysis.recompositionTemplates.map((template) => ({
      template_id: template.templateId,
      template_name: template.templateName,
      sequence: template.sequence,
    })),
  };
}

function toRawAtom(atom: FunctionSlotAtomizationArtifact["atomInventory"]["scriptAtoms"][number], type: "script" | "rhythm" | "packaging") {
  const base = {
    id: atom.id,
    slot: atom.slot,
    label: atom.label,
    source_refs: toRawSourceRefs(atom.sourceRefs),
    confidence: atom.confidence,
    need_review: atom.needReview,
  };
  if (type === "script") {
    return {
      ...base,
      semantic_function: atom.function,
      claim_type: atom.claimType ?? "",
      proof_need: atom.proofNeed ?? "",
      dependency_before: (atom as { dependencyBefore?: string[] }).dependencyBefore ?? [],
      dependency_after: (atom as { dependencyAfter?: string[] }).dependencyAfter ?? [],
      must_keep: atom.mustKeep ?? [],
      replaceable_variables: atom.replaceableVariables ?? [],
    };
  }
  if (type === "rhythm") {
    return {
      ...base,
      attention_function: atom.function,
      pace: atom.pace ?? "",
      density_type: atom.densityType ?? "",
      beat_shape: atom.beatShape ?? "",
      best_for_script_functions: (atom as { bestForScriptFunctions?: string[] }).bestForScriptFunctions ?? [],
      avoid_for: atom.avoidFor ?? [],
      sync_points: atom.syncPoints ?? [],
    };
  }
  return {
    ...base,
    packaging_function: atom.packagingFunction ?? atom.function,
    visual_elements: (atom as { visualElements?: string[] }).visualElements ?? [],
    visual_hierarchy: atom.visualHierarchy ?? "",
    proof_type: atom.proofType ?? "",
    visual_proof_type: atom.visualProofType ?? "",
    replaceable_forms: atom.replaceableForms ?? [],
    risk: atom.risk ?? "",
  };
}

function toRawSourceRefs(refs: { scriptSegmentLabels?: string[]; rhythmSectionLabels?: string[]; packagingBlockLabels?: string[]; shotRefs: string[] }) {
  return {
    script_segment_labels: refs.scriptSegmentLabels ?? [],
    rhythm_section_labels: refs.rhythmSectionLabels ?? [],
    packaging_block_labels: refs.packagingBlockLabels ?? [],
    shot_refs: refs.shotRefs ?? [],
  };
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
