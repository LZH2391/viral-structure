import { useState, type ReactNode } from "react";
import type { AnalysisHistoryItem } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import {
  resolveGroupStatus,
  resolveWorkflowDetail,
  resolveWorkflowStages,
  stageTitle,
  statusLabel,
  type WorkflowStage,
  type WorkflowStageKey,
  type WorkflowStageStatus,
  type WorkflowStages,
} from "./analysisWorkflowModel";

type RerunTarget = string | string[];

export type AnalysisDetailSidebarState = {
  visible: boolean;
  title: string;
  item: AnalysisHistoryItem | null;
  selectedTimelineSegment?: AnalysisTimelineSegmentDetail | null;
  rerunnableStageKeys?: string[];
  rerunningStageKey?: string | null;
  onWorkflowStageRerun?: (stageKey: RerunTarget) => void;
};

type AnalysisWorkflowSidebarProps = {
  detail: AnalysisDetailSidebarState;
  onWorkflowStageSelect?: () => void;
};

export function AnalysisWorkflowSidebar({ detail, onWorkflowStageSelect }: AnalysisWorkflowSidebarProps) {
  const stages = resolveWorkflowStages(detail.item);
  const materialWorkflow = stages.some((stage) => stage.key === "userMaterialTagger");
  const upload = stageByKey(stages, "upload");
  const shotBoundary = stageByKey(stages, "shotBoundary");
  const scriptSegment = stageByKey(stages, "scriptSegment");
  const rhythmStructure = stageByKey(stages, "rhythmStructure");
  const packagingStructure = stageByKey(stages, "packagingStructure");
  const userMaterialTagger = stageByKey(stages, "userMaterialTagger");
  const atomization = stageByKey(stages, "functionSlotAtomization");
  const aggregate = stageByKey(stages, "aggregate");
  const structureStatus = materialWorkflow ? "waiting" : resolveGroupStatus([scriptSegment, rhythmStructure, packagingStructure]);
  const [selectedStageKey, setSelectedStageKey] = useState<WorkflowStageKey>("upload");
  const [pendingRerun, setPendingRerun] = useState<{ label: string; target: RerunTarget; grouped: boolean } | null>(null);
  const selectedTimelineSegment = detail.selectedTimelineSegment ?? null;
  const selectedStageAvailable = selectedStageKey === "structureAnalysis"
    ? !materialWorkflow
    : stages.some((stage) => stage.key === selectedStageKey);
  const activeSelectedStageKey = selectedStageAvailable ? selectedStageKey : "upload";
  const selectedWorkflowStageKey = selectedTimelineSegment ? null : activeSelectedStageKey;
  const rerunnableStageKeys = detail.rerunnableStageKeys ?? [];
  const rerunningStageKey = detail.rerunningStageKey ?? null;
  const rerunDisabled = Boolean(rerunningStageKey || detail.item?.isRunning);
  const structureStageKeys = ["scriptSegment", "rhythmStructure", "packagingStructure"];
  const canRerunStage = (stage: WorkflowStage) => Boolean(detail.onWorkflowStageRerun && rerunnableStageKeys.includes(stage.key));
  const canRerunStructure = Boolean(detail.onWorkflowStageRerun && structureStageKeys.every((stageKey) => rerunnableStageKeys.includes(stageKey)));
  const requestRerun = (stage: WorkflowStage, target: RerunTarget = stage.key) => {
    setPendingRerun({ label: stage.label, target, grouped: Array.isArray(target) });
  };
  const confirmRerun = () => {
    if (!pendingRerun) return;
    const target = pendingRerun.target;
    setPendingRerun(null);
    detail.onWorkflowStageRerun?.(target);
  };
  const selectWorkflowStage = (stageKey: WorkflowStageKey) => {
    setSelectedStageKey(stageKey);
    onWorkflowStageSelect?.();
  };

  return (
    <section className="new-ui-analysis-workflow" aria-label={materialWorkflow ? "素材识别总览" : "完整分析总览"}>
      <div className="new-ui-analysis-workflow-flow">
        <h2 className="new-ui-analysis-workflow-title">分析流程</h2>
        <ol className="new-ui-analysis-workflow-list">
          {materialWorkflow ? (
            <>
              <WorkflowStep stage={upload} connectorDone={upload.status === "done"} selected={selectedWorkflowStageKey === upload.key} canRerun={canRerunStage(upload)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === upload.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
              <WorkflowStep stage={shotBoundary} connectorDone={shotBoundary.status === "done"} selected={selectedWorkflowStageKey === shotBoundary.key} canRerun={canRerunStage(shotBoundary)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === shotBoundary.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
              <WorkflowStep stage={userMaterialTagger} connectorDone={userMaterialTagger.status === "done"} selected={selectedWorkflowStageKey === userMaterialTagger.key} canRerun={canRerunStage(userMaterialTagger)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === userMaterialTagger.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
              <WorkflowStep stage={aggregate} isLast selected={selectedWorkflowStageKey === aggregate.key} onSelect={selectWorkflowStage} />
            </>
          ) : (
            <>
              <WorkflowStep stage={upload} connectorDone={upload.status === "done"} selected={selectedWorkflowStageKey === upload.key} canRerun={canRerunStage(upload)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === upload.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
              <WorkflowStep stage={shotBoundary} connectorDone={shotBoundary.status === "done"} selected={selectedWorkflowStageKey === shotBoundary.key} canRerun={canRerunStage(shotBoundary)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === shotBoundary.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
              <WorkflowStep
                stage={{
                  key: "structureAnalysis",
                  label: "结构分析",
                  moduleLabel: "",
                  dependencyLabel: "",
                  status: structureStatus,
                }}
                connectorDone={structureStatus === "done"}
                selected={selectedWorkflowStageKey === "structureAnalysis"}
                canRerun={canRerunStructure}
                rerunDisabled={rerunDisabled}
                rerunning={rerunningStageKey === "structureAnalysis"}
                rerunStageKey={structureStageKeys}
                onRerun={requestRerun}
                onSelect={selectWorkflowStage}
              >
                <div className="new-ui-analysis-workflow-parallel" aria-label="结构分析并行子任务">
                  <ParallelStage stage={scriptSegment} selected={selectedWorkflowStageKey === scriptSegment.key} canRerun={canRerunStage(scriptSegment)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === scriptSegment.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
                  <ParallelStage stage={rhythmStructure} selected={selectedWorkflowStageKey === rhythmStructure.key} canRerun={canRerunStage(rhythmStructure)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === rhythmStructure.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
                  <ParallelStage stage={packagingStructure} selected={selectedWorkflowStageKey === packagingStructure.key} canRerun={canRerunStage(packagingStructure)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === packagingStructure.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
                </div>
              </WorkflowStep>
              <WorkflowStep stage={atomization} connectorDone={atomization.status === "done"} selected={selectedWorkflowStageKey === atomization.key} canRerun={canRerunStage(atomization)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === atomization.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
              <WorkflowStep stage={aggregate} isLast selected={selectedWorkflowStageKey === aggregate.key} onSelect={selectWorkflowStage} />
            </>
          )}
        </ol>
      </div>
      {selectedTimelineSegment ? (
        <TimelineSegmentDetailPanel segment={selectedTimelineSegment} />
      ) : (
        <WorkflowDetailPanel selectedStageKey={activeSelectedStageKey} item={detail.item} stages={stages} structureStatus={structureStatus} />
      )}
      {pendingRerun ? <RerunConfirmDialog pending={pendingRerun} onCancel={() => setPendingRerun(null)} onConfirm={confirmRerun} /> : null}
    </section>
  );
}

function stageByKey(stages: WorkflowStages, key: WorkflowStageKey): WorkflowStage {
  return stages.find((stage) => stage.key === key) ?? {
    key,
    label: stageTitle(key),
    moduleLabel: "",
    dependencyLabel: "",
    status: "waiting",
  };
}

function WorkflowStep({
  stage,
  connectorDone = false,
  isLast = false,
  selected,
  canRerun = false,
  rerunDisabled = false,
  rerunning = false,
  rerunStageKey,
  onRerun,
  onSelect,
  children,
}: {
  stage: WorkflowStage;
  connectorDone?: boolean;
  isLast?: boolean;
  selected: boolean;
  canRerun?: boolean;
  rerunDisabled?: boolean;
  rerunning?: boolean;
  rerunStageKey?: RerunTarget;
  onRerun?: (stage: WorkflowStage, stageKey?: RerunTarget) => void;
  onSelect: (stageKey: WorkflowStageKey) => void;
  children?: ReactNode;
}) {
  return (
    <li className={`new-ui-analysis-workflow-step is-${stage.status} ${selected ? "is-selected" : ""}`.trim()} data-stage={stage.key}>
      <div className="new-ui-analysis-workflow-connector" aria-hidden="true">
        <span className="new-ui-analysis-workflow-status-dot" />
        <span className={`new-ui-analysis-workflow-vline ${connectorDone ? "is-done" : ""} ${isLast ? "is-hidden" : ""}`.trim()} />
      </div>
      <div className="new-ui-analysis-workflow-step-body">
        <div className="new-ui-analysis-workflow-step-button">
          <button
            className="new-ui-analysis-workflow-step-select"
            type="button"
            aria-pressed={selected}
            title={`查看或调整${stage.label}详情`}
            onClick={() => onSelect(stage.key)}
          >
            <span className="new-ui-analysis-workflow-step-copy">
              <span className="new-ui-analysis-workflow-step-label">{stage.label}</span>
              <span className="new-ui-analysis-workflow-badge">{statusLabel(stage.status)}</span>
            </span>
          </button>
          {canRerun ? (
            <button
              className={`new-ui-analysis-workflow-rerun-button ${rerunning ? "is-rerunning" : ""}`.trim()}
              type="button"
              disabled={rerunDisabled || stage.status === "running"}
              aria-label={rerunning ? `正在重跑${stage.label}` : `重跑${stage.label}`}
              title={rerunning ? `正在重跑${stage.label}` : `重跑${stage.label}`}
              onClick={() => onRerun?.(stage, rerunStageKey ?? stage.key)}
            >
              <RerunIcon />
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </li>
  );
}

function ParallelStage({
  stage,
  selected,
  canRerun = false,
  rerunDisabled = false,
  rerunning = false,
  onRerun,
  onSelect,
}: {
  stage: WorkflowStage;
  selected: boolean;
  canRerun?: boolean;
  rerunDisabled?: boolean;
  rerunning?: boolean;
  onRerun?: (stage: WorkflowStage, stageKey?: RerunTarget) => void;
  onSelect: (stageKey: WorkflowStageKey) => void;
}) {
  return (
    <div className={`new-ui-analysis-workflow-parallel-item is-${stage.status} ${selected ? "is-selected" : ""}`.trim()}>
      <button
        className="new-ui-analysis-workflow-parallel-button"
        type="button"
        aria-pressed={selected}
        title={`查看或调整${stage.label}详情`}
        onClick={() => onSelect(stage.key)}
      >
        <span className="new-ui-analysis-workflow-parallel-label">
          {stage.status === "running" ? <span className="new-ui-analysis-workflow-spinner" aria-hidden="true" /> : <span className="new-ui-analysis-workflow-mini-dot" aria-hidden="true" />}
          <span>{stage.label}</span>
        </span>
      </button>
      {canRerun ? (
        <button
          className={`new-ui-analysis-workflow-rerun-button is-compact ${rerunning ? "is-rerunning" : ""}`.trim()}
          type="button"
          disabled={rerunDisabled || stage.status === "running"}
          aria-label={rerunning ? `正在重跑${stage.label}` : `重跑${stage.label}`}
          title={rerunning ? `正在重跑${stage.label}` : `重跑${stage.label}`}
          onClick={() => onRerun?.(stage, stage.key)}
        >
          <RerunIcon />
        </button>
      ) : null}
    </div>
  );
}

function RerunIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M18.3 8.2A7 7 0 1 0 19 13" />
      <path d="M18.6 4.8v3.8h-3.8" />
    </svg>
  );
}

function RerunConfirmDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { label: string; target: RerunTarget; grouped: boolean };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="new-ui-analysis-rerun-confirm-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="new-ui-analysis-rerun-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-ui-analysis-rerun-confirm-title"
        aria-describedby="new-ui-analysis-rerun-confirm-desc"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="new-ui-analysis-rerun-confirm-title">确认重跑</h2>
        <p id="new-ui-analysis-rerun-confirm-desc">
          {pending.grouped
            ? "结构分析会同时重跑脚本段落、节奏结构和包装结构，并刷新下游结果。"
            : `${pending.label}会重新生成，并刷新依赖它的下游结果。`}
        </p>
        <div className="new-ui-analysis-rerun-confirm-actions">
          <button className="new-ui-analysis-rerun-confirm-secondary" type="button" onClick={onCancel}>取消</button>
          <button className="new-ui-analysis-rerun-confirm-primary" type="button" onClick={onConfirm}>确认</button>
        </div>
      </section>
    </div>
  );
}

function WorkflowDetailPanel({
  selectedStageKey,
  item,
  stages,
  structureStatus,
}: {
  selectedStageKey: WorkflowStageKey;
  item: AnalysisHistoryItem | null;
  stages: WorkflowStages;
  structureStatus: WorkflowStageStatus;
}) {
  const detail = resolveWorkflowDetail(selectedStageKey, item, stages, structureStatus);
  return (
    <section className="new-ui-analysis-workflow-detail" aria-label={`${stageTitle(selectedStageKey)}详情区域`} data-selected-stage={selectedStageKey}>
      <div className="new-ui-analysis-workflow-detail-header">
        <h2 className="new-ui-analysis-workflow-detail-title">详细信息</h2>
        <span className={`new-ui-analysis-workflow-detail-status is-${detail.status}`}>{statusLabel(detail.status)}</span>
      </div>
      <div className="new-ui-analysis-workflow-detail-content">
        <div className="new-ui-analysis-workflow-detail-summary">
          <strong>{detail.title}</strong>
          <p>{detail.summary}</p>
        </div>
        {detail.metrics.length ? (
          <div className="new-ui-analysis-workflow-detail-metrics" aria-label={`${detail.title}结果数量`}>
            {detail.metrics.map((metric) => (
              <div key={metric.label} className="new-ui-analysis-workflow-detail-metric">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {detail.cards.length ? (
          <div className="new-ui-analysis-workflow-detail-list">
            {detail.cards.map((card) => (
              <article key={`${card.title}_${card.meta}`} className="new-ui-analysis-workflow-detail-card">
                <strong>{card.title}</strong>
                <span>{card.meta}</span>
                <p>{card.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="new-ui-analysis-workflow-detail-empty">{detail.emptyText}</div>
        )}
        {detail.nextText ? <div className="new-ui-analysis-workflow-detail-next">{detail.nextText}</div> : null}
      </div>
    </section>
  );
}

function TimelineSegmentDetailPanel({ segment }: { segment: AnalysisTimelineSegmentDetail }) {
  const metrics = [
    { label: "类型", value: segmentKindLabel(segment.tone) },
    { label: "时间", value: segment.timeLabel },
    segment.shotRangeLabel ? { label: "镜头", value: segment.shotRangeLabel } : null,
  ].filter((metric): metric is { label: string; value: string } => Boolean(metric));

  return (
    <section className="new-ui-analysis-workflow-detail" aria-label="时间轴选中段详情" data-selected-stage={`timeline-${segment.tone}`}>
      <div className="new-ui-analysis-workflow-detail-header">
        <h2 className="new-ui-analysis-workflow-detail-title">详细信息</h2>
        <span className="new-ui-analysis-workflow-detail-status">{segmentKindLabel(segment.tone)}</span>
      </div>
      <div className="new-ui-analysis-workflow-detail-content">
        <div className="new-ui-analysis-workflow-detail-summary">
          <strong>{segment.title}</strong>
          <p>{segment.summary}</p>
        </div>
        <div className="new-ui-analysis-workflow-detail-metrics" aria-label={`${segment.title}段落信息`}>
          {metrics.map((metric) => (
            <div key={metric.label} className="new-ui-analysis-workflow-detail-metric">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
        {segment.fields.length ? (
          <div className="new-ui-analysis-workflow-detail-list">
            {segment.fields.slice(0, 4).map((field) => (
              <article key={`${field.label}_${field.value}`} className="new-ui-analysis-workflow-detail-card">
                <strong>{field.label}</strong>
                <p>{field.value}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="new-ui-analysis-workflow-detail-empty">这个段落还没有更多字段。</div>
        )}
      </div>
    </section>
  );
}

function segmentKindLabel(tone: AnalysisTimelineSegmentDetail["tone"]) {
  if (tone === "subtitle") return "字幕段";
  if (tone === "script") return "脚本段";
  if (tone === "rhythm") return "节奏段";
  if (tone === "packaging") return "包装段";
  return "槽位段";
}
