import { useState, type ReactNode } from "react";
import type { AnalysisHistoryItem } from "./analysisHistoryData";
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

export type AnalysisDetailSidebarState = {
  visible: boolean;
  title: string;
  item: AnalysisHistoryItem | null;
};

type AnalysisWorkflowSidebarProps = {
  detail: AnalysisDetailSidebarState;
};

export function AnalysisWorkflowSidebar({ detail }: AnalysisWorkflowSidebarProps) {
  const stages = resolveWorkflowStages(detail.item);
  const [upload, shotBoundary, scriptSegment, rhythmStructure, packagingStructure, atomization, aggregate] = stages;
  const structureStatus = resolveGroupStatus([scriptSegment, rhythmStructure, packagingStructure]);
  const [selectedStageKey, setSelectedStageKey] = useState<WorkflowStageKey>("upload");

  return (
    <section className="new-ui-analysis-workflow" aria-label="完整分析总览">
      <div className="new-ui-analysis-workflow-flow">
        <h2 className="new-ui-analysis-workflow-title">分析流程</h2>
        <ol className="new-ui-analysis-workflow-list">
          <WorkflowStep stage={upload} connectorDone={upload.status === "done"} selected={selectedStageKey === upload.key} onSelect={setSelectedStageKey} />
          <WorkflowStep stage={shotBoundary} connectorDone={shotBoundary.status === "done"} selected={selectedStageKey === shotBoundary.key} onSelect={setSelectedStageKey} />
          <WorkflowStep
            stage={{
              key: "structureAnalysis",
              label: "结构分析",
              moduleLabel: "",
              dependencyLabel: "",
              status: structureStatus,
            }}
            connectorDone={structureStatus === "done"}
            selected={selectedStageKey === "structureAnalysis"}
            onSelect={setSelectedStageKey}
          >
            <div className="new-ui-analysis-workflow-parallel" aria-label="结构分析并行子任务">
              <ParallelStage stage={scriptSegment} selected={selectedStageKey === scriptSegment.key} onSelect={setSelectedStageKey} />
              <ParallelStage stage={rhythmStructure} selected={selectedStageKey === rhythmStructure.key} onSelect={setSelectedStageKey} />
              <ParallelStage stage={packagingStructure} selected={selectedStageKey === packagingStructure.key} onSelect={setSelectedStageKey} />
            </div>
          </WorkflowStep>
          <WorkflowStep stage={atomization} connectorDone={atomization.status === "done"} selected={selectedStageKey === atomization.key} onSelect={setSelectedStageKey} />
          <WorkflowStep stage={aggregate} isLast selected={selectedStageKey === aggregate.key} onSelect={setSelectedStageKey} />
        </ol>
      </div>
      <WorkflowDetailPanel selectedStageKey={selectedStageKey} item={detail.item} stages={stages} structureStatus={structureStatus} />
    </section>
  );
}

function WorkflowStep({
  stage,
  connectorDone = false,
  isLast = false,
  selected,
  onSelect,
  children,
}: {
  stage: WorkflowStage;
  connectorDone?: boolean;
  isLast?: boolean;
  selected: boolean;
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
        <button
          className="new-ui-analysis-workflow-step-button"
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
        {children}
      </div>
    </li>
  );
}

function ParallelStage({ stage, selected, onSelect }: { stage: WorkflowStage; selected: boolean; onSelect: (stageKey: WorkflowStageKey) => void }) {
  return (
    <button
      className={`new-ui-analysis-workflow-parallel-item is-${stage.status} ${selected ? "is-selected" : ""}`.trim()}
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
