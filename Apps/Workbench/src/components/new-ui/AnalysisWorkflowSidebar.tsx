import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AnalysisHistoryItem } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import { NewUiWorkflowTraceTimeline, resolveRunningTraceStage, TimelineSegmentDetailPanel } from "./AnalysisWorkflowTraceTimeline";
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
  workflowActionBusy?: "cancel" | "resume" | null;
  onWorkflowCancel?: () => void;
  onWorkflowResume?: () => void;
  onWorkflowDetailCardSelect?: (target: AnalysisTimelineSegmentDetail) => void;
};

type AnalysisWorkflowSidebarProps = {
  detail: AnalysisDetailSidebarState;
  onOpenStructureGraph?: (target: { artifactId: string; title: string }) => void;
  onWorkflowStageSelect?: () => void;
};

export function AnalysisWorkflowSidebar({ detail, onOpenStructureGraph, onWorkflowStageSelect }: AnalysisWorkflowSidebarProps) {
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
  const structureStageKeys = ["scriptSegment", "rhythmStructure", "packagingStructure"];
  const structureGraphArtifactId = detail.item?.artifact?.functionSlotAtomizationAnalysis?.artifactId ?? null;
  const canOpenStructureGraph = Boolean(structureGraphArtifactId && onOpenStructureGraph);
  const canRerunStage = (stage: WorkflowStage) => Boolean(detail.onWorkflowStageRerun && rerunnableStageKeys.includes(stage.key));
  const canRerunStructure = Boolean(detail.onWorkflowStageRerun && structureStageKeys.every((stageKey) => rerunnableStageKeys.includes(stageKey)));
  const workflowStatus = String(detail.item?.workflowRun?.status ?? detail.item?.status ?? "").toLowerCase();
  const runtimeStatus = String(detail.item?.runtimeState?.status ?? "").toLowerCase();
  const workflowRunning = Boolean(
    ["running", "queued", "pending", "processing", "cache_waiting"].includes(workflowStatus)
      || ["queued", "running", "waiting", "blocked"].includes(runtimeStatus)
      || (!detail.item?.workflowRun && !detail.item?.runtimeState && detail.item?.isRunning),
  );
  const rerunDisabled = Boolean(rerunningStageKey || workflowRunning);
  const workflowCanceled = workflowStatus === "canceled";
  const canCancelWorkflow = Boolean(detail.onWorkflowCancel && detail.item?.workflowRunId && workflowRunning && !detail.workflowActionBusy);
  const canResumeWorkflow = Boolean(detail.onWorkflowResume && detail.item?.workflowRunId && workflowCanceled && !detail.workflowActionBusy);
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
  const openStructureGraph = () => {
    if (!structureGraphArtifactId) return;
    onOpenStructureGraph?.({ artifactId: structureGraphArtifactId, title: detail.title });
  };

  return (
    <section className="new-ui-analysis-workflow" aria-label={materialWorkflow ? "素材识别总览" : "结构分析总览"}>
      <div className="new-ui-analysis-workflow-flow">
        <div className="new-ui-analysis-workflow-heading">
          <h2 className="new-ui-analysis-workflow-title">{materialWorkflow ? "素材识别流程" : "结构分析流程"}</h2>
          {workflowRunning || workflowCanceled || detail.workflowActionBusy ? (
            <button
              className={`new-ui-analysis-workflow-run-action ${workflowCanceled ? "is-resume" : "is-cancel"}`.trim()}
              type="button"
              disabled={workflowCanceled ? !canResumeWorkflow : !canCancelWorkflow}
              data-tooltip={workflowCanceled ? "从已完成步骤继续，未完成步骤会重新执行" : "停止整条分析任务"}
              onClick={() => {
                if (workflowCanceled) detail.onWorkflowResume?.();
                else detail.onWorkflowCancel?.();
              }}
            >
              {detail.workflowActionBusy === "cancel"
                ? "停止中"
                : detail.workflowActionBusy === "resume"
                ? "继续中"
                : workflowCanceled
                ? (materialWorkflow ? "继续识别" : "继续分析")
                : "停止"}
            </button>
          ) : null}
        </div>
        <ol className="new-ui-analysis-workflow-list">
          {materialWorkflow ? (
            <>
              <WorkflowStep stage={upload} connectorDone={upload.status === "done"} selected={selectedWorkflowStageKey === upload.key} canRerun={canRerunStage(upload)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === upload.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
              <WorkflowStep stage={shotBoundary} connectorDone={shotBoundary.status === "done"} selected={selectedWorkflowStageKey === shotBoundary.key} canRerun={canRerunStage(shotBoundary)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === shotBoundary.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
              <WorkflowStep stage={userMaterialTagger} connectorDone={userMaterialTagger.status === "done"} selected={selectedWorkflowStageKey === userMaterialTagger.key} canRerun={canRerunStage(userMaterialTagger)} rerunDisabled={rerunDisabled} rerunning={rerunningStageKey === userMaterialTagger.key} onRerun={requestRerun} onSelect={selectWorkflowStage} />
              <WorkflowStep
                stage={aggregate}
                isLast
                selected={selectedWorkflowStageKey === aggregate.key}
                onSelect={selectWorkflowStage}
              />
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
              <WorkflowStep
                stage={aggregate}
                isLast
                selected={selectedWorkflowStageKey === aggregate.key}
                graphAvailable={canOpenStructureGraph}
                onOpenGraph={openStructureGraph}
                onSelect={selectWorkflowStage}
              />
            </>
          )}
        </ol>
      </div>
      {selectedTimelineSegment ? (
        <TimelineSegmentDetailPanel segment={selectedTimelineSegment} />
      ) : (
        <WorkflowDetailPanel
          selectedStageKey={activeSelectedStageKey}
          item={detail.item}
          stages={stages}
          structureStatus={structureStatus}
          onDetailCardSelect={detail.onWorkflowDetailCardSelect}
        />
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
  graphAvailable = false,
  onRerun,
  onOpenGraph,
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
  graphAvailable?: boolean;
  onRerun?: (stage: WorkflowStage, stageKey?: RerunTarget) => void;
  onOpenGraph?: () => void;
  onSelect: (stageKey: WorkflowStageKey) => void;
  children?: ReactNode;
}) {
  const showGraphAction = stage.key === "aggregate" && onOpenGraph;
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
            data-tooltip={`查看或调整${stage.label}详情`}
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
              data-tooltip={rerunning ? `正在重跑${stage.label}` : `重跑${stage.label}`}
              onClick={() => onRerun?.(stage, rerunStageKey ?? stage.key)}
            >
              <RerunIcon />
            </button>
          ) : null}
          {showGraphAction ? (
            <button
              className="new-ui-analysis-workflow-rerun-button new-ui-analysis-workflow-graph-button"
              type="button"
              disabled={!graphAvailable}
              aria-label={graphAvailable ? "查看样例结构图" : "完成原子化后可查看样例结构图"}
              data-tooltip={graphAvailable ? "查看样例结构图" : "完成原子化后可查看样例结构图"}
              onClick={onOpenGraph}
            >
              <StructureGraphIcon />
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
        data-tooltip={`查看或调整${stage.label}详情`}
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
          data-tooltip={rerunning ? `正在重跑${stage.label}` : `重跑${stage.label}`}
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

function StructureGraphIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <circle cx="6.5" cy="7" r="2.3" />
      <circle cx="17.5" cy="7" r="2.3" />
      <circle cx="12" cy="17" r="2.3" />
      <path d="M8.6 8.3 10.2 14.7" />
      <path d="M15.4 8.3 13.8 14.7" />
      <path d="M8.8 7h6.4" />
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
  onDetailCardSelect,
}: {
  selectedStageKey: WorkflowStageKey;
  item: AnalysisHistoryItem | null;
  stages: WorkflowStages;
  structureStatus: WorkflowStageStatus;
  onDetailCardSelect?: (target: AnalysisTimelineSegmentDetail) => void;
}) {
  const detail = resolveWorkflowDetail(selectedStageKey, item, stages, structureStatus);
  const runningTraceStage = detail.status === "running" ? resolveRunningTraceStage(item, selectedStageKey) : null;
  return (
    <section className="new-ui-analysis-workflow-detail" aria-label={`${stageTitle(selectedStageKey)}详情区域`} data-selected-stage={selectedStageKey}>
      <div className="new-ui-analysis-workflow-detail-header">
        <h2 className={`new-ui-analysis-workflow-detail-title ${runningTraceStage ? "is-processing" : ""}`.trim()}>
          {runningTraceStage ? (
            <>
              处理中<span className="new-ui-processing-dots" aria-hidden="true" />
            </>
          ) : "详细信息"}
        </h2>
        {runningTraceStage ? null : <span className={`new-ui-analysis-workflow-detail-status is-${detail.status}`}>{statusLabel(detail.status)}</span>}
      </div>
      {runningTraceStage ? (
        <NewUiWorkflowTraceTimeline stage={runningTraceStage} />
      ) : (
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
              {detail.cards.map((card) => {
                const cardKey = `${card.title}_${card.meta}`;
                const cardContent = (
                  <>
                    <strong>{card.title}</strong>
                    {card.meta ? <span>{card.meta}</span> : null}
                    <p>{card.body}</p>
                  </>
                );
                return card.timelineTarget && onDetailCardSelect ? (
                  <button
                    key={cardKey}
                    className="new-ui-analysis-workflow-detail-card is-clickable"
                    type="button"
                    onClick={() => onDetailCardSelect(card.timelineTarget as AnalysisTimelineSegmentDetail)}
                  >
                    {cardContent}
                  </button>
                ) : (
                  <article key={cardKey} className="new-ui-analysis-workflow-detail-card">
                    {cardContent}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="new-ui-analysis-workflow-detail-empty">{detail.emptyText}</div>
          )}
          {detail.nextText ? <div className="new-ui-analysis-workflow-detail-next">{detail.nextText}</div> : null}
        </div>
      )}
    </section>
  );
}
