import type { ProcessingJob, WorkflowRun, WorkflowStageState } from "../../types";
import { shortId } from "../../utils/format";
import { stageLabel } from "../../utils/workbenchHelpers";

export type FullAnalysisStageTarget = WorkflowStageState["key"];

export function StageStep({
  stage,
  job,
  onRerun,
  onOpenStage,
  onResolveCache,
  disabled,
}: {
  stage: WorkflowStageState;
  job: ProcessingJob | null;
  onRerun: (stageKey: string) => void;
  onOpenStage?: (stageKey: FullAnalysisStageTarget) => void;
  onResolveCache: (stage: WorkflowStageState, job: ProcessingJob, decision: "reuse" | "refresh") => void;
  disabled: boolean;
}) {
  const failed = stage.status === "failed";
  const runtimeStatus = getStageRuntimeStatus(stage);
  const runtimeLabel = resolveRuntimeLabel(stage, job);
  const runtimeStageText = resolveRuntimeStageText(stage, job);
  const runtimeProgress = resolveRuntimeProgress(stage, job);
  const traceText = job?.traceId ?? stage.childTraceId ?? null;
  const openStage = () => onOpenStage?.(stage.key);
  return (
    <div
      className={`workflow-step workflow-step-${stage.status} ${onOpenStage ? "is-clickable" : ""}`}
      role={onOpenStage ? "button" : undefined}
      tabIndex={onOpenStage ? 0 : undefined}
      onClick={openStage}
      onKeyDown={(event) => {
        if (!onOpenStage || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        openStage();
      }}
    >
      <div className="workflow-step-heading">
        <strong>{stage.label}</strong>
        <span>{runtimeLabel}</span>
      </div>
      <small>{stage.artifactId ? `artifact ${shortId(stage.artifactId)}` : stage.childJobId ? `job ${shortId(stage.childJobId)}` : `attempt ${stage.attemptNo}`}</small>
      {runtimeStageText ? <span className="workflow-step-stage">{runtimeStageText}</span> : null}
      {runtimeProgress != null ? <span className="workflow-step-progress">{runtimeProgress}%</span> : null}
      {traceText ? <span className="workflow-step-trace">child trace {shortId(traceText)}</span> : null}
      {stage.errorSummary?.message ? <em>{stage.errorSummary.message}</em> : null}
      {job?.status === "cache_waiting" && job.cachePrompt?.cachedItem ? (
        <div className="workflow-step-actions">
          <button className="ghost-button" type="button" onClick={(event) => {
            event.stopPropagation();
            onResolveCache(stage, job, "refresh");
          }}>
            重新生成
          </button>
          <button className="primary-button" type="button" onClick={(event) => {
            event.stopPropagation();
            onResolveCache(stage, job, "reuse");
          }}>
            复用缓存
          </button>
        </div>
      ) : null}
      {stage.key !== "upload" && stage.key !== "aggregate" ? (
        <button className={failed ? "primary-button" : "ghost-button"} type="button" disabled={disabled || runtimeStatus === "running"} onClick={(event) => {
          event.stopPropagation();
          onRerun(stage.key);
        }}>
          重跑
        </button>
      ) : null}
    </div>
  );
}

export function canRerun(stage: WorkflowStageState, run: WorkflowRun | null, isRunExecuting: (run: WorkflowRun | null) => boolean) {
  return Boolean(run?.sampleVideoId && !isRunExecuting(run) && ["processed", "failed"].includes(stage.status));
}

function stageStatusLabel(stage: WorkflowStageState) {
  if (stage.status === "processed") return "完成";
  if (stage.status === "failed") return "失败";
  if (stage.status === "cache_waiting") return "等待缓存决策";
  if (stage.status === "running") return "运行中";
  return "等待";
}

function getStageRuntimeStatus(stage: WorkflowStageState) {
  if (stage.status === "running") return "running";
  if (stage.status === "cache_waiting") return "cache_waiting";
  if (stage.status === "processed") return "processed";
  if (stage.status === "failed") return "failed";
  return "pending";
}

function resolveRuntimeLabel(stage: WorkflowStageState, job: ProcessingJob | null) {
  if (job) {
    if (job.status === "failed") return "失败";
    if (job.status === "processed") return "完成";
    if (job.status === "cache_waiting") return "等待缓存决策";
    if (job.status === "processing") return "运行中";
    if (job.status === "pending") return "排队中";
  }
  return stageStatusLabel(stage);
}

function resolveRuntimeStageText(stage: WorkflowStageState, job: ProcessingJob | null) {
  if (job?.stage) return stageLabel(job);
  if (stage.status === "processed" && stage.outputSummary) return "阶段完成";
  if (stage.status === "cache_waiting") return "等待缓存选择";
  return stage.stageName ?? null;
}

function resolveRuntimeProgress(stage: WorkflowStageState, job: ProcessingJob | null) {
  if (job && Number.isFinite(job.progress)) return job.progress;
  if (stage.status === "processed") return 100;
  return null;
}
