const fs = require("fs");
const path = require("path");

function createWorkflowRunStore({ filePath = null } = {}) {
  const { runs: loadedRuns, changed } = loadRuns(filePath);
  const runs = new Map(loadedRuns.map((run) => [run.workflowRunId, run]));
  if (changed) persistRuns(filePath, runs);

  function createRun(run) {
    runs.set(run.workflowRunId, run);
    persistRuns(filePath, runs);
    return run;
  }

  function updateRun(workflowRunId, updater) {
    const current = runs.get(workflowRunId);
    if (!current) return null;
    const patch = typeof updater === "function" ? updater(current) : updater;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    runs.set(workflowRunId, next);
    persistRuns(filePath, runs);
    return next;
  }

  function getRun(workflowRunId) {
    return runs.get(workflowRunId) ?? null;
  }

  function listRuns() {
    return Array.from(runs.values());
  }

  return { createRun, updateRun, getRun, listRuns };
}

function loadRuns(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { runs: [], changed: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed.runs)) return { runs: [], changed: false };
    let changed = false;
    const runs = parsed.runs.filter((run) => run?.workflowRunId).map((run) => {
      const next = normalizeLoadedRun(run);
      if (next !== run) changed = true;
      return next;
    });
    return { runs, changed };
  } catch {
    return { runs: [], changed: false };
  }
}

function normalizeLoadedRun(run) {
  if (run.status !== "running") return run;
  const now = new Date().toISOString();
  const errorSummary = {
    code: "workflow_run_interrupted_by_restart",
    message: "服务重启后，之前未完成的完整分析已中断，请重新运行完整分析或重跑具体步骤。",
    stageName: "workflow.run",
    retryable: true,
    debugSnapshotUri: null,
  };
  return {
    ...run,
    status: "failed",
    currentStageKeys: [],
    completedAt: now,
    errorSummary,
    stages: Array.isArray(run.stages)
      ? run.stages.map((stage) => normalizeLoadedStage(stage, now, errorSummary))
      : run.stages,
    interruptedAt: now,
    interruptedReason: "server_restart",
  };
}

function normalizeLoadedStage(stage, completedAt, runErrorSummary) {
  if (!stage || stage.status !== "running") return stage;
  return {
    ...stage,
    status: "failed",
    completedAt,
    errorSummary: {
      ...runErrorSummary,
      stageName: stage.stageName ?? stage.key ?? runErrorSummary.stageName,
    },
  };
}

function persistRuns(filePath, runs) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ runs: Array.from(runs.values()) }, null, 2), "utf8");
}

module.exports = { createWorkflowRunStore };
