import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getAgentTurnTimeline, getProcessingJob } from "../../api/client";
import type { AgentRunJob, AgentTimelineItem, AgentTraceCard, AgentTurnTimeline, WorkflowStageState } from "../../types";
import { pickDefaultTraceCard, resolveAgentTraceCards } from "../property-panel/agentTraceCards";
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

const SETTLED_TIMELINE_POLL_COUNT = 3;

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
  const rerunDisabled = Boolean(rerunningStageKey || detail.item?.isRunning);
  const structureStageKeys = ["scriptSegment", "rhythmStructure", "packagingStructure"];
  const structureGraphArtifactId = detail.item?.artifact?.functionSlotAtomizationAnalysis?.artifactId ?? null;
  const canOpenStructureGraph = Boolean(structureGraphArtifactId && onOpenStructureGraph);
  const canRerunStage = (stage: WorkflowStage) => Boolean(detail.onWorkflowStageRerun && rerunnableStageKeys.includes(stage.key));
  const canRerunStructure = Boolean(detail.onWorkflowStageRerun && structureStageKeys.every((stageKey) => rerunnableStageKeys.includes(stageKey)));
  const workflowStatus = String(detail.item?.workflowRun?.status ?? detail.item?.status ?? "").toLowerCase();
  const workflowRunning = Boolean(detail.item?.isRunning || ["running", "queued", "pending", "processing", "cache_waiting"].includes(workflowStatus));
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

function NewUiWorkflowTraceTimeline({ stage }: { stage: WorkflowStageState }) {
  const [job, setJob] = useState<AgentRunJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [timelineByCard, setTimelineByCard] = useState<Record<string, AgentTurnTimeline | null>>({});
  const [errorByCard, setErrorByCard] = useState<Record<string, string | null>>({});
  const stageSignature = `${stage.key}:${stage.childJobId ?? ""}:${stage.childTraceId ?? ""}:${stage.attemptNo ?? ""}`;

  useEffect(() => {
    setJob(null);
    setJobError(null);
    setSelectedCardId(null);
    setTimelineByCard({});
    setErrorByCard({});
  }, [stageSignature]);

  useEffect(() => {
    if (!stage.childJobId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await getProcessingJob(stage.childJobId as string);
        if (cancelled) return;
        setJob(next);
        setJobError(null);
      } catch (error) {
        if (cancelled) return;
        setJobError(error instanceof Error ? error.message : "运行任务读取失败");
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [stage.childJobId]);

  const cards = useMemo(() => resolveAgentTraceCards(job), [job]);
  const selectedId = useMemo(() => pickDefaultTraceCard(cards, selectedCardId), [cards, selectedCardId]);
  const selectedCard = cards.find((card) => card.id === selectedId) ?? null;
  const selectedCacheKey = selectedCard ? traceCardCacheKey(selectedCard) : null;
  const selectedTimeline = selectedCacheKey ? timelineByCard[selectedCacheKey] ?? null : null;
  const selectedError = selectedCacheKey ? errorByCard[selectedCacheKey] ?? null : null;
  const activeCard = pickActiveCard(cards);
  const activity = selectedTimeline?.activity ?? selectedCard?.activity ?? activeCard?.activity ?? job?.agentActivity ?? null;
  const latestText = activeCard?.latestMessagePreview ?? activity?.latestMessagePreview ?? job?.activeThreadMessage?.text ?? null;
  const canTrace = Boolean(selectedCard?.threadId && selectedCard?.turnId);

  useEffect(() => {
    if (!selectedId) return;
    setSelectedCardId(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedCard?.threadId || !selectedCard.turnId) return;
    let cancelled = false;
    const cardKey = traceCardCacheKey(selectedCard);
    let settlePollsRemaining = SETTLED_TIMELINE_POLL_COUNT;
    const load = async () => {
      try {
        const next = await getAgentTurnTimeline(selectedCard.threadId as string, selectedCard.turnId as string);
        if (cancelled) return;
        setTimelineByCard((current) => ({ ...current, [cardKey]: next }));
        setErrorByCard((current) => ({ ...current, [cardKey]: null }));
      } catch (loadError) {
        if (cancelled) return;
        setErrorByCard((current) => ({ ...current, [cardKey]: loadError instanceof Error ? loadError.message : "运行追踪读取失败" }));
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (selectedCard.status !== "running") {
        if (settlePollsRemaining <= 0) {
          window.clearInterval(timer);
          return;
        }
        settlePollsRemaining -= 1;
      }
      void load();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedCard?.id, selectedCard?.status, selectedCard?.threadId, selectedCard?.turnId]);

  return (
    <div className="new-ui-analysis-workflow-trace">
      {jobError ? <div className="new-ui-analysis-workflow-detail-empty">{jobError}</div> : null}
      {latestText ? (
        <div className="new-ui-analysis-workflow-trace-latest" aria-live="polite">
          <span>最新活动</span>
          <strong>{latestText}</strong>
        </div>
      ) : null}
      {cards.length ? (
        <div className="new-ui-analysis-workflow-trace-card-list" aria-label="Agent turn 列表">
          {cards.map((card) => (
            <TraceCardButton
              key={card.id}
              card={card}
              active={card.id === selectedCard?.id}
              onSelect={() => setSelectedCardId(card.id)}
            />
          ))}
        </div>
      ) : null}
      {selectedError ? <div className="new-ui-analysis-workflow-detail-empty">{selectedError}</div> : null}
      {selectedTimeline?.items?.length ? (
        <div className="new-ui-analysis-workflow-trace-list">
          {selectedTimeline.items.map((item) => <TimelineRow key={`${item.id}_${item.index}`} item={item} />)}
        </div>
      ) : (
        <div className="new-ui-analysis-workflow-detail-empty">{canTrace ? "正在读取运行追踪。" : "当前步骤还没有可读取的 turn。"}</div>
      )}
    </div>
  );
}

function TraceCardButton({ card, active, onSelect }: { card: AgentTraceCard; active: boolean; onSelect: () => void }) {
  return (
    <button className={`new-ui-analysis-workflow-trace-card ${active ? "is-active" : ""}`.trim()} type="button" aria-pressed={active} onClick={onSelect}>
      <span className={`new-ui-analysis-workflow-trace-state is-${card.status}`}>{renderTraceStatus(card.status)}</span>
      <strong>{card.label}</strong>
      <span>{card.role ?? "role 未知"}</span>
      {card.latestMessagePreview ? <em>{card.latestMessagePreview}</em> : null}
    </button>
  );
}

function TimelineRow({ item }: { item: AgentTimelineItem }) {
  return (
    <div className={`new-ui-analysis-workflow-trace-row is-${item.kind}`}>
      <span className="new-ui-analysis-workflow-trace-dot" />
      <div className="new-ui-analysis-workflow-trace-event">
        <div className="new-ui-analysis-workflow-trace-meta">
          <span>{formatTime(item.createdAt)}</span>
          <span>{renderKind(item.kind)}</span>
          {item.metadata?.toolName ? <span>{item.metadata.toolName}</span> : null}
          {item.metadata?.exitCode != null ? <span>exit {item.metadata.exitCode}</span> : null}
          {item.metadata?.durationMs != null ? <span>{formatDuration(item.metadata.durationMs)}</span> : null}
        </div>
        <strong>{item.title}</strong>
        {item.textPreview ? <p>{item.textPreview}</p> : null}
      </div>
    </div>
  );
}

function resolveRunningTraceStage(item: AnalysisHistoryItem | null, selectedStageKey: WorkflowStageKey): WorkflowStageState | null {
  const workflowStages = item?.workflowRun?.stages ?? [];
  const candidates = selectedStageKey === "structureAnalysis"
    ? workflowStages.filter((stage) => ["scriptSegment", "rhythmStructure", "packagingStructure"].includes(stage.key))
    : workflowStages.filter((stage) => stage.key === selectedStageKey);
  return candidates.find((stage) => isWorkflowStageRunning(stage.status) && (stage.childJobId || stage.childTraceId))
    ?? candidates.find((stage) => isWorkflowStageRunning(stage.status))
    ?? null;
}

function pickActiveCard(cards: AgentTraceCard[]) {
  return cards.find((card) => card.status === "running")
    ?? cards.slice().sort((left, right) => Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""))[0]
    ?? null;
}

function traceCardCacheKey(card: AgentTraceCard) {
  return [card.id, card.threadId ?? "", card.turnId ?? ""].join(":");
}

function renderTraceStatus(status: AgentTraceCard["status"]) {
  const labels: Record<AgentTraceCard["status"], string> = {
    pending: "待提交",
    running: "运行中",
    completed: "完成",
    failed: "失败",
    unknown: "未知",
  };
  return labels[status] ?? status;
}

function renderKind(kind: AgentTimelineItem["kind"]) {
  const labels: Record<AgentTimelineItem["kind"], string> = {
    user_input: "user_input",
    agent_message: "agent_message",
    plan: "plan",
    reasoning: "reasoning",
    command_execution: "command",
    mcp_tool_call: "mcp_tool",
    dynamic_tool_call: "dynamic_tool",
    file_change: "file_change",
    web_search: "web_search",
    tool_call: "tool_call",
    tool_result: "tool_result",
    token_usage: "token_usage",
    context_compacted: "compact",
    turn_status: "turn_status",
    unknown: "unknown",
  };
  return labels[kind] ?? kind;
}

function formatTime(value?: string | null) {
  if (!value) return "--:--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDuration(value: number) {
  if (!Number.isFinite(value)) return "";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function isWorkflowStageRunning(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}

function TimelineSegmentDetailPanel({ segment }: { segment: AnalysisTimelineSegmentDetail }) {
  const metrics = [
    segment.shotRangeLabel ? { label: "镜头", value: segment.shotRangeLabel } : null,
  ].filter((metric): metric is { label: string; value: string } => Boolean(metric));
  const isSubtitleSegment = segment.tone === "subtitle";
  const detailFields = isSubtitleSegment
    ? [
      { label: "时间", value: segment.timeLabel },
      { label: "字幕文本", value: segment.summary },
    ]
    : segment.fields;

  return (
    <section className="new-ui-analysis-workflow-detail" aria-label="时间轴选中段详情" data-selected-stage={`timeline-${segment.tone}`}>
      <div className="new-ui-analysis-workflow-detail-header">
        <h2 className="new-ui-analysis-workflow-detail-title">详细信息</h2>
        <span className="new-ui-analysis-workflow-detail-status">{segmentKindLabel(segment.tone)}</span>
      </div>
      <div className="new-ui-analysis-workflow-detail-content">
        <div className="new-ui-analysis-workflow-detail-summary">
          <strong>{segmentKindLabel(segment.tone)}</strong>
        </div>
        {metrics.length ? (
          <div className="new-ui-analysis-workflow-detail-metrics" aria-label={`${segment.title}段落信息`}>
            {metrics.map((metric) => (
              <div key={metric.label} className="new-ui-analysis-workflow-detail-metric">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {detailFields.length ? (
          <div className="new-ui-analysis-workflow-detail-list">
            {detailFields.map((field) => (
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
  if (tone === "shot") return "镜头";
  if (tone === "subtitle") return "字幕段";
  if (tone === "script") return "脚本段";
  if (tone === "rhythm") return "节奏段";
  if (tone === "packaging") return "包装段";
  if (tone === "materialClass") return "镜头类型";
  if (tone === "materialFunction") return "表达功能";
  if (tone === "materialProof") return "证明支撑";
  if (tone === "materialSequence") return "成片位置";
  return "槽位段";
}
