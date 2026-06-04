const RUNTIME_STATE_SCHEMA_VERSION = "runtime_state.v1";

function createRuntimeStateResolver({ workflowRunStore = null, jobStore = null, activeTurnRuntime = null } = {}) {
  async function resolve({ resourceKind, resourceId } = {}) {
    const kind = normalizeText(resourceKind);
    const id = normalizeText(resourceId);
    if (!kind || !id) return null;
    if (kind === "workflowRun") return resolveWorkflowRun(id, workflowRunStore);
    if (kind === "job") return resolveJob(id, jobStore);
    if (kind === "activeTurn") return resolveActiveTurn(id, activeTurnRuntime);
    return null;
  }

  return {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    resolve,
  };
}

function resolveWorkflowRun(workflowRunId, workflowRunStore) {
  const run = workflowRunStore?.getRun?.(workflowRunId) ?? null;
  if (!run) return null;
  const stages = Array.isArray(run.stages) ? run.stages : [];
  return {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    resource: { resourceKind: "workflowRun", resourceId: workflowRunId },
    status: normalizeRuntimeStatus(run.status),
    rawStatus: normalizeText(run.status),
    progress: workflowProgress(stages, run.status),
    currentStages: stages
      .filter((stage) => isCurrentWorkflowStage(stage, run.currentStageKeys))
      .map(toRuntimeStage),
    retryable: retryableFromError(run.errorSummary),
    errorSummary: run.errorSummary ?? null,
    source: {
      sourceOfTruth: "Runtime/WorkflowRuns/runs/*.json",
      indexSource: "Runtime/WorkflowRuns/workflow-runs.json",
    },
  };
}

function resolveJob(jobId, jobStore) {
  const job = jobStore?.getJob?.(jobId) ?? jobStore?.getArchivedJob?.(jobId) ?? null;
  if (!job) return null;
  return {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    resource: { resourceKind: "job", resourceId: jobId },
    status: normalizeRuntimeStatus(job.status),
    rawStatus: normalizeText(job.status),
    progress: normalizeProgress(job.progress),
    currentStages: [{
      key: normalizeText(job.stage) ?? "job",
      stageName: normalizeText(job.stage),
      status: normalizeText(job.status) ?? "unknown",
      runId: normalizeText(job.runId),
      traceId: normalizeText(job.traceId),
      stageId: normalizeText(job.stageId),
      artifactId: normalizeText(job.artifactId),
      parentArtifactId: normalizeText(job.parentArtifactId),
      errorSummary: job.errorSummary ?? null,
    }],
    retryable: retryableFromError(job.errorSummary),
    errorSummary: job.errorSummary ?? null,
    source: {
      sourceOfTruth: "Runtime/Jobs/active-jobs.json / Runtime/Jobs/archive/*.jsonl",
      indexSource: "Apps/Api/lib/stores/job-store.js",
    },
  };
}

async function resolveActiveTurn(resourceId, activeTurnRuntime) {
  const binding = await activeTurnRuntime?.getByBindingId?.(resourceId)
    ?? await activeTurnRuntime?.getByTurnId?.(resourceId)
    ?? null;
  if (!binding) return null;
  return {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    resource: { resourceKind: "activeTurn", resourceId: binding.bindingId ?? resourceId },
    status: normalizeRuntimeStatus(binding.status),
    rawStatus: normalizeText(binding.status),
    progress: null,
    currentStages: [{
      key: normalizeText(binding.stageName) ?? "activeTurn",
      stageName: normalizeText(binding.stageName),
      status: normalizeText(binding.status) ?? "unknown",
      runId: normalizeText(binding.runId),
      traceId: normalizeText(binding.traceId),
      stageId: normalizeText(binding.stageId),
      artifactId: normalizeText(binding.artifactId),
      parentArtifactId: normalizeText(binding.parentArtifactId),
      errorSummary: null,
    }],
    retryable: null,
    errorSummary: null,
    source: {
      sourceOfTruth: "Runtime/ActiveTurns/active-turns.json",
      indexSource: "Apps/Api/lib/active-turns/store.js",
    },
  };
}

function isCurrentWorkflowStage(stage, currentStageKeys = []) {
  const currentKeys = new Set(Array.isArray(currentStageKeys) ? currentStageKeys : []);
  if (currentKeys.has(stage?.key)) return true;
  return ["running", "cache_waiting", "failed"].includes(String(stage?.status ?? ""));
}

function toRuntimeStage(stage) {
  return {
    key: normalizeText(stage.key) ?? "stage",
    stageName: normalizeText(stage.stageName),
    status: normalizeText(stage.status) ?? "unknown",
    runId: normalizeText(stage.runId),
    traceId: normalizeText(stage.childTraceId ?? stage.traceId),
    stageId: normalizeText(stage.stageId),
    artifactId: normalizeText(stage.artifactId),
    parentArtifactId: normalizeText(stage.parentArtifactId),
    errorSummary: stage.errorSummary ?? null,
  };
}

function workflowProgress(stages, status) {
  if (normalizeRuntimeStatus(status) === "processed") return 100;
  if (!stages.length) return null;
  const completed = stages.filter((stage) => ["processed", "failed"].includes(String(stage?.status ?? ""))).length;
  return Math.round((completed / stages.length) * 100);
}

function normalizeRuntimeStatus(status) {
  const value = String(status ?? "").trim().toLowerCase();
  if (!value) return "unknown";
  if (["created", "pending", "queued", "submitted"].includes(value)) return "queued";
  if (["running", "processing", "collecting", "in_progress", "inprogress"].includes(value)) return "running";
  if (["waiting", "cache_waiting", "blocked"].includes(value)) return value === "blocked" ? "blocked" : "waiting";
  if (["processed", "completed", "complete", "success", "succeeded"].includes(value)) return "processed";
  if (value === "partial_failed") return "partial_failed";
  if (["failed", "error", "errored"].includes(value)) return "failed";
  if (["canceled", "cancelled"].includes(value)) return "canceled";
  return value;
}

function retryableFromError(errorSummary) {
  return typeof errorSummary?.retryable === "boolean" ? errorSummary.retryable : null;
}

function normalizeProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

module.exports = {
  RUNTIME_STATE_SCHEMA_VERSION,
  createRuntimeStateResolver,
  normalizeRuntimeStatus,
};
