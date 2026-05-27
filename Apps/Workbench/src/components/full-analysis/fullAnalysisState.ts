import type { ProcessingJob, SampleArtifact, WorkflowRun } from "../../types";

export const NON_EXECUTING_RUN_STATUS = new Set(["processed", "failed", "partial_failed", "cache_waiting"]);

export function statusLabel(run: WorkflowRun) {
  if (run.status === "cache_waiting") return "等待缓存选择";
  if (run.status === "processed") return "完整分析完成";
  if (run.status === "partial_failed") return "部分步骤失败，已保留可用结果";
  if (run.status === "failed") return run.errorSummary?.message ?? "完整分析失败";
  const active = run.currentStageKeys.map((key) => run.stages.find((stage) => stage.key === key)?.label ?? key).join(" / ");
  return active ? `运行中：${active}` : "运行中";
}

export function isRunExecuting(run: WorkflowRun | null) {
  return Boolean(run && !NON_EXECUTING_RUN_STATUS.has(run.status));
}

export function buildWorkbenchSyncSignature(run: WorkflowRun, artifact: SampleArtifact | null, childJobs: Record<string, ProcessingJob | null>) {
  return JSON.stringify({
    runId: run.workflowRunId,
    runStatus: run.status,
    runUpdatedAt: run.updatedAt,
    artifact: artifact ? sampleArtifactSignature(artifact) : null,
    jobs: Object.fromEntries(Object.entries(childJobs).map(([jobId, job]) => [jobId, job ? jobSignature(job) : null])),
  });
}

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sampleArtifactSignature(artifact: SampleArtifact) {
  return [
    artifact.sampleVideoId,
    artifact.sampleVideo.artifactId,
    artifact.status,
    artifact.shotBoundaryAnalysis?.artifactId,
    artifact.scriptSegmentAnalysis?.artifactId,
    artifact.rhythmStructureAnalysis?.artifactId,
    artifact.packagingStructureAnalysis?.artifactId,
    artifact.functionSlotAtomizationAnalysis?.artifactId,
  ].filter(Boolean).join("|");
}

function jobSignature(job: ProcessingJob) {
  return [
    job.jobId,
    job.sampleVideoId,
    job.status,
    job.stage,
    job.progress,
    job.traceId,
    job.agentRun?.threadId,
    job.agentRun?.turnId,
    job.activeThreadMessage?.text,
    job.agentActivity?.itemCount,
    job.agentActivity?.effectiveItemCount,
    job.agentActivity?.latestItemType,
    job.agentActivity?.latestMessagePreview,
  ].map((value) => value ?? "").join("|");
}
