import { type CSSProperties, type Dispatch, type FormEvent, type KeyboardEvent, type SetStateAction } from "react";
import type { AgentTurnTimeline } from "../../types";
import { formatSecondsCompact, shortId } from "../../utils/format";
import { CloseGlyph, ErrorAlertGlyph, ReferenceStructureGlyph, SendGlyph, StopTurnGlyph, UploadMaterialGlyph } from "./RestructureWorkspaceGlyphs";
import type { NewUiMaterialPackOption, NewUiRestructureSendContext, NewUiStructureOption, NewUiTurnTimelineTarget } from "./restructureWorkspaceTypes";

type RestructureAttachmentPanel = "material" | "structure" | null;

export function RestructureWorkspaceComposer({
  draft, setDraft, sendError, setSendError, visibleSendError, activeAttachmentPanel, setActiveAttachmentPanel,
  selectedMaterialPack, setSelectedMaterialPack, selectedStructure, setSelectedStructure, materialPackOptions, structureOptions,
  loadingMaterialPackOptions, uploadingMaterial, loadingStructureOptions, onRefreshMaterialPackOptions, onRefreshStructureOptions,
  onOpenMaterialUpload, onOpenMaterialPackDetail, onAutoAdvanceToggle, autoAdvanceEnabled, autoAdvanceBusy, contextUsage,
  onStopTurn, activeTurnTarget, stoppingTurn, canStopTurn, canUseComposer, canSend, sendingMessage, creatingConversation, onSubmitDraft,
}: {
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  sendError: string | null;
  setSendError: Dispatch<SetStateAction<string | null>>;
  visibleSendError: string | null;
  activeAttachmentPanel: RestructureAttachmentPanel;
  setActiveAttachmentPanel: Dispatch<SetStateAction<RestructureAttachmentPanel>>;
  selectedMaterialPack: NewUiMaterialPackOption | null;
  setSelectedMaterialPack: (option: NewUiMaterialPackOption | null) => void;
  selectedStructure: NewUiStructureOption | null;
  setSelectedStructure: Dispatch<SetStateAction<NewUiStructureOption | null>>;
  materialPackOptions: NewUiMaterialPackOption[];
  structureOptions: NewUiStructureOption[];
  loadingMaterialPackOptions: boolean;
  uploadingMaterial: boolean;
  loadingStructureOptions: boolean;
  onRefreshMaterialPackOptions?: () => Promise<void> | void;
  onRefreshStructureOptions?: () => Promise<void> | void;
  onOpenMaterialUpload?: () => void;
  onOpenMaterialPackDetail?: (option: NewUiMaterialPackOption) => void;
  onAutoAdvanceToggle?: (enabled: boolean) => void;
  autoAdvanceEnabled: boolean;
  autoAdvanceBusy: boolean;
  contextUsage: AgentTurnTimeline["activity"]["tokenUsage"] | null;
  onStopTurn?: () => Promise<void> | void;
  activeTurnTarget: NewUiTurnTimelineTarget | null;
  stoppingTurn: boolean;
  canStopTurn: boolean;
  canUseComposer: boolean;
  canSend: boolean;
  sendingMessage: boolean;
  creatingConversation: boolean;
  onSubmitDraft: () => Promise<void>;
}) {
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmitDraft();
  };
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void onSubmitDraft();
  };
  const attachmentChips = selectedMaterialPack || selectedStructure ? (
    <div className="new-ui-restructure-composer-attachments" aria-label="已选择的重组上下文">
      {selectedMaterialPack ? (
        <AttachmentChip
          label={selectedMaterialPack.failed ? "识别失败" : selectedMaterialPack.pending ? "识别中" : "素材包"}
          title={selectedMaterialPack.title ?? selectedMaterialPack.sampleVideoId ?? selectedMaterialPack.resultUri ?? "素材包"}
          tone={selectedMaterialPack.failed ? "danger" : selectedMaterialPack.pending ? "pending" : "neutral"}
          onOpen={onOpenMaterialPackDetail ? () => onOpenMaterialPackDetail(selectedMaterialPack) : undefined}
          onRemove={() => setSelectedMaterialPack(null)}
        />
      ) : null}
      {selectedStructure ? <AttachmentChip label="结构" title={selectedStructure.title || selectedStructure.artifactId} onRemove={() => setSelectedStructure(null)} /> : null}
    </div>
  ) : null;

  return (
    <form className="new-ui-restructure-composer" aria-label="重组输入区" onSubmit={(event) => void handleSubmit(event)}>
      {attachmentChips}
      <div className="new-ui-restructure-composer-field">
        <textarea
          rows={2}
          placeholder="描述目标品类、素材情况、想迁移的结构或要返工的点"
          value={draft}
          disabled={!canUseComposer || sendingMessage || creatingConversation}
          aria-describedby={visibleSendError ? "new-ui-restructure-send-error" : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (sendError) setSendError(null);
          }}
          onKeyDown={handleComposerKeyDown}
        />
        <div className="new-ui-restructure-composer-tools" aria-label="重组输入工具">
          <button className={`new-ui-restructure-tool-button ${activeAttachmentPanel === "material" ? "is-active" : ""}`.trim()} type="button" aria-expanded={activeAttachmentPanel === "material"} data-tooltip="选择素材识别包" onClick={() => { setActiveAttachmentPanel((current) => current === "material" ? null : "material"); void onRefreshMaterialPackOptions?.(); }}>
            <UploadMaterialGlyph /><span>上传素材</span>
          </button>
          <button className={`new-ui-restructure-tool-button ${activeAttachmentPanel === "structure" ? "is-active" : ""}`.trim()} type="button" aria-expanded={activeAttachmentPanel === "structure"} data-tooltip="固定一个样例结构" onClick={() => { setActiveAttachmentPanel((current) => current === "structure" ? null : "structure"); void onRefreshStructureOptions?.(); }}>
            <ReferenceStructureGlyph /><span>引用结构</span>
          </button>
        </div>
        {activeAttachmentPanel === "material" ? (
          <MaterialPackPickerPanel options={materialPackOptions} selected={selectedMaterialPack} loading={loadingMaterialPackOptions} uploading={uploadingMaterial} onSelect={(option) => { setSelectedMaterialPack(option); setActiveAttachmentPanel(null); }} onUpload={onOpenMaterialUpload ? () => { setActiveAttachmentPanel(null); onOpenMaterialUpload(); } : undefined} />
        ) : null}
        {activeAttachmentPanel === "structure" ? <StructurePickerPanel options={structureOptions} selected={selectedStructure} loading={loadingStructureOptions} onSelect={(option) => { setSelectedStructure(option); setActiveAttachmentPanel(null); }} /> : null}
        {onAutoAdvanceToggle ? (
          <button className={`new-ui-restructure-auto-advance-toggle ${autoAdvanceEnabled ? "is-on" : ""}`.trim()} type="button" aria-pressed={autoAdvanceEnabled} data-tooltip={autoAdvanceEnabled ? "槽位完成后自动完善 Shot 设计；Shot 设计审查通过后自动确认方案" : "开启后，槽位完成会自动推进到 Shot 设计和确认方案"} disabled={autoAdvanceBusy} onClick={() => onAutoAdvanceToggle(!autoAdvanceEnabled)}>
            <span className="new-ui-restructure-auto-advance-switch" aria-hidden="true"><i /></span><span>{autoAdvanceBusy ? "推进中" : "自动推进"}</span>
          </button>
        ) : null}
        <ContextUsageIndicator usage={contextUsage} />
        {onStopTurn && (activeTurnTarget?.running || stoppingTurn) ? (
          <button className="new-ui-restructure-send-button is-stop" type="button" aria-label="停止生成" data-tooltip={stoppingTurn ? "正在停止生成" : "停止生成"} disabled={!canStopTurn} onClick={() => { if (!canStopTurn) return; void onStopTurn(); }}><StopTurnGlyph /></button>
        ) : (
          <button className="new-ui-restructure-send-button" type="submit" aria-label="发送" data-tooltip="发送" disabled={!canSend}><SendGlyph /></button>
        )}
      </div>
    </form>
  );
}

export function RestructureSendErrorAlert({ message }: { message: string }) {
  return (
    <div id="new-ui-restructure-send-error" className="new-ui-restructure-send-error-alert" role="alert">
      <ErrorAlertGlyph />
      <p>{message}</p>
    </div>
  );
}

function AttachmentChip({ label, title, tone = "neutral", onOpen, onRemove }: { label: string; title: string; tone?: "neutral" | "pending" | "danger"; onOpen?: () => void; onRemove: () => void }) {
  return (
    <span className={`new-ui-restructure-attachment-chip is-${tone}`}>
      {onOpen ? (
        <button className="new-ui-restructure-attachment-chip-main" type="button" aria-label={`打开${label} ${title}`} onClick={onOpen}>
          <b>{label}</b>
          <span>{title}</span>
        </button>
      ) : (
        <span className="new-ui-restructure-attachment-chip-main">
          <b>{label}</b>
          <span>{title}</span>
        </span>
      )}
      <button className="new-ui-restructure-attachment-chip-remove" type="button" aria-label={`移除${label}`} onClick={onRemove}>
        <CloseGlyph />
      </button>
    </span>
  );
}

function MaterialPackPickerPanel({
  options,
  selected,
  loading,
  uploading,
  onSelect,
  onUpload,
}: {
  options: NewUiMaterialPackOption[];
  selected: NewUiMaterialPackOption | null;
  loading: boolean;
  uploading: boolean;
  onSelect: (option: NewUiMaterialPackOption) => void;
  onUpload?: () => void;
}) {
  return (
    <section className="new-ui-restructure-picker-panel is-material" aria-label="选择素材识别包">
      <button className="new-ui-restructure-picker-card is-upload-card" type="button" disabled={!onUpload || uploading} onClick={onUpload}>
        <span className="new-ui-restructure-picker-card-icon" aria-hidden="true">
          <UploadMaterialGlyph />
        </span>
        <strong>{uploading ? "正在启动识别" : "上传新素材"}</strong>
        <small>{uploading ? "完成后会自动附带" : "选择视频并启动素材识别"}</small>
      </button>
      {loading ? <PickerStateCard text="正在读取素材包" /> : null}
      {!loading && !options.length ? <PickerStateCard text="暂无可用素材识别结果" /> : null}
      {!loading ? options.map((option) => (
        <button
          key={`${option.sampleVideoId}:${option.artifactId ?? ""}`}
          className={`new-ui-restructure-picker-card ${isSameMaterialPackOption(option, selected) ? "is-selected" : ""} ${option.failed ? "is-failed" : option.pending ? "is-pending" : ""}`.trim()}
          type="button"
          onClick={() => onSelect(option)}
        >
          <span className="new-ui-restructure-picker-thumb" aria-hidden="true">
            {option.coverUrl ? <img src={option.coverUrl} alt="" loading="lazy" decoding="async" /> : <UploadMaterialGlyph />}
          </span>
          <strong>{option.title || `素材 ${shortId(option.sampleVideoId)}`}</strong>
          <small>{formatMaterialPackOptionMeta(option)}</small>
        </button>
      )) : null}
    </section>
  );
}

function StructurePickerPanel({
  options,
  selected,
  loading,
  onSelect,
}: {
  options: NewUiStructureOption[];
  selected: NewUiStructureOption | null;
  loading: boolean;
  onSelect: (option: NewUiStructureOption) => void;
}) {
  return (
    <section className="new-ui-restructure-picker-panel is-structure" aria-label="选择样例结构">
      {loading ? <PickerStateCard text="正在读取样例结构" /> : null}
      {!loading && !options.length ? <PickerStateCard text="暂无 FunctionSlotLibrary 样例" /> : null}
      {!loading ? options.map((option) => (
        <button
          key={option.artifactId}
          className={`new-ui-restructure-picker-card ${isSameStructureOption(option, selected) ? "is-selected" : ""}`.trim()}
          type="button"
          onClick={() => onSelect(option)}
        >
          <span className="new-ui-restructure-picker-card-icon" aria-hidden="true">
            <ReferenceStructureGlyph />
          </span>
          <strong>{option.title || `样例 ${shortId(option.sampleVideoId ?? option.artifactId)}`}</strong>
          <small>{formatStructureOptionMeta(option)}</small>
        </button>
      )) : null}
    </section>
  );
}

function PickerStateCard({ text }: { text: string }) {
  return (
    <div className="new-ui-restructure-picker-card is-state-card">
      <strong>{text}</strong>
    </div>
  );
}

export function buildRestructureSendContext(materialPack: NewUiMaterialPackOption | null, structure: NewUiStructureOption | null): NewUiRestructureSendContext {
  const readyMaterialPack = materialPack && !materialPack.pending && !materialPack.failed ? materialPack : null;
  return {
    materialPackRef: readyMaterialPack ? {
      sampleVideoId: readyMaterialPack.sampleVideoId,
      artifactId: readyMaterialPack.artifactId ?? null,
      title: readyMaterialPack.title ?? null,
      traceId: readyMaterialPack.traceId ?? null,
      resultUri: readyMaterialPack.resultUri ?? null,
      shotCardCount: readyMaterialPack.shotCardCount ?? null,
      materialGroupCount: readyMaterialPack.materialGroupCount ?? null,
      proofCoverageCount: readyMaterialPack.proofCoverageCount ?? null,
    } : null,
    structureRef: structure ? {
      artifactId: structure.artifactId,
      sampleVideoId: structure.sampleVideoId ?? null,
      title: structure.title ?? null,
      traceId: structure.traceId ?? null,
      slotCount: structure.slotCount ?? null,
      atomCount: structure.atomCount ?? null,
    } : null,
  };
}

function isSameMaterialPackOption(left: NewUiMaterialPackOption | null, right: NewUiMaterialPackOption | null) {
  return Boolean(left && right && left.sampleVideoId === right.sampleVideoId && (
    left.pending || right.pending || left.failed || right.failed || (left.artifactId ?? null) === (right.artifactId ?? null)
  ));
}

function isSameStructureOption(left: NewUiStructureOption | null, right: NewUiStructureOption | null) {
  return Boolean(left && right && left.artifactId === right.artifactId);
}

function formatMaterialPackOptionMeta(option: NewUiMaterialPackOption) {
  if (option.failed) return option.errorMessage || "素材识别失败，请重新上传";
  if (option.pending) return "素材识别中，完成后自动附带";
  const counts = [
    option.shotCardCount != null ? `${option.shotCardCount} 镜头卡` : null,
    option.materialGroupCount != null ? `${option.materialGroupCount} 组` : null,
    option.proofCoverageCount != null ? `${option.proofCoverageCount} 证明项` : null,
  ].filter(Boolean);
  const duration = option.durationSeconds != null ? formatSecondsCompact(option.durationSeconds) : null;
  return [...counts, duration].filter(Boolean).join(" / ") || `sample ${shortId(option.sampleVideoId)}`;
}

function formatStructureOptionMeta(option: NewUiStructureOption) {
  const counts = [
    option.slotCount != null ? `${option.slotCount} 槽位` : null,
    option.atomCount != null ? `${option.atomCount} 原子` : null,
  ].filter(Boolean);
  return counts.join(" / ") || `artifact ${shortId(option.artifactId)}`;
}

export function ContextUsageIndicator({ usage }: { usage: AgentTurnTimeline["activity"]["tokenUsage"] | null }) {
  const ratio = typeof usage?.contextUsageRatio === "number" && Number.isFinite(usage.contextUsageRatio)
    ? Math.max(0, Math.min(1, usage.contextUsageRatio))
    : null;
  const percent = ratio == null ? "--" : String(Math.round(ratio * 100));
  const progress = ratio == null ? 0 : Math.round(ratio * 100);
  const state = usage?.contextUsageState ?? "unknown";
  const label = `${percent}% used`;
  return (
    <span
      className={`new-ui-restructure-context-usage ${state}`}
      aria-label={formatContextUsageTitle(usage)}
      data-tooltip={formatContextUsageTitle(usage)}
      style={{ "--context-progress": `${progress}%` } as CSSProperties}
    >
      <b>{label}</b>
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
