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

export type AnalysisDetailSidebarState = {
  visible: boolean;
  title: string;
  item: AnalysisHistoryItem | null;
  selectedTimelineSegment?: AnalysisTimelineSegmentDetail | null;
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
  const selectedTimelineSegment = detail.selectedTimelineSegment ?? null;
  const selectedStageAvailable = selectedStageKey === "structureAnalysis"
    ? !materialWorkflow
    : stages.some((stage) => stage.key === selectedStageKey);
  const activeSelectedStageKey = selectedStageAvailable ? selectedStageKey : "upload";
  const selectedWorkflowStageKey = selectedTimelineSegment ? null : activeSelectedStageKey;
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
              <WorkflowStep stage={upload} connectorDone={upload.status === "done"} selected={selectedWorkflowStageKey === upload.key} onSelect={selectWorkflowStage} />
              <WorkflowStep stage={shotBoundary} connectorDone={shotBoundary.status === "done"} selected={selectedWorkflowStageKey === shotBoundary.key} onSelect={selectWorkflowStage} />
              <WorkflowStep stage={userMaterialTagger} connectorDone={userMaterialTagger.status === "done"} selected={selectedWorkflowStageKey === userMaterialTagger.key} onSelect={selectWorkflowStage} />
              <WorkflowStep stage={aggregate} isLast selected={selectedWorkflowStageKey === aggregate.key} onSelect={selectWorkflowStage} />
            </>
          ) : (
            <>
              <WorkflowStep stage={upload} connectorDone={upload.status === "done"} selected={selectedWorkflowStageKey === upload.key} onSelect={selectWorkflowStage} />
              <WorkflowStep stage={shotBoundary} connectorDone={shotBoundary.status === "done"} selected={selectedWorkflowStageKey === shotBoundary.key} onSelect={selectWorkflowStage} />
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
                onSelect={selectWorkflowStage}
              >
                <div className="new-ui-analysis-workflow-parallel" aria-label="结构分析并行子任务">
                  <ParallelStage stage={scriptSegment} selected={selectedWorkflowStageKey === scriptSegment.key} onSelect={selectWorkflowStage} />
                  <ParallelStage stage={rhythmStructure} selected={selectedWorkflowStageKey === rhythmStructure.key} onSelect={selectWorkflowStage} />
                  <ParallelStage stage={packagingStructure} selected={selectedWorkflowStageKey === packagingStructure.key} onSelect={selectWorkflowStage} />
                </div>
              </WorkflowStep>
              <WorkflowStep stage={atomization} connectorDone={atomization.status === "done"} selected={selectedWorkflowStageKey === atomization.key} onSelect={selectWorkflowStage} />
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
