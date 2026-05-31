const fs = require("fs");
const path = require("path");

function createWorkflowRunStore({ filePath = null } = {}) {
  const { runs: loadedRuns, changed } = loadRuns(filePath);
  const runs = new Map(loadedRuns.map((run) => [run.workflowRunId, run]));
  if (changed) persistRuns(filePath, runs);

  function createRun(run) {
    runs.set(run.workflowRunId, run);
    persistRun(filePath, run);
    persistRunIndex(filePath, runs);
    return run;
  }

  function updateRun(workflowRunId, updater) {
    const current = runs.get(workflowRunId);
    if (!current) return null;
    const patch = typeof updater === "function" ? updater(current) : updater;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    runs.set(workflowRunId, next);
    persistRun(filePath, next);
    persistRunIndex(filePath, runs);
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
  if (!filePath) return { runs: [], changed: false };
  if (!fs.existsSync(filePath)) return loadRunsFromDirectory(filePath);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Array.isArray(parsed.runRefs)) return loadRunsFromIndex(filePath, parsed.runRefs);
    if (!Array.isArray(parsed.runs)) return loadRunsFromDirectory(filePath);
    let changed = true;
    const runs = parsed.runs.filter((run) => run?.workflowRunId).map((run) => normalizeLoadedRun(run));
    return { runs, changed };
  } catch {
    return loadRunsFromDirectory(filePath);
  }
}

function loadRunsFromIndex(filePath, runRefs) {
  let changed = false;
  const runs = runRefs
    .filter((ref) => ref?.workflowRunId)
    .map((ref) => {
      const run = readRunFile(filePath, ref);
      if (!run?.workflowRunId) {
        changed = true;
        return null;
      }
      const next = normalizeLoadedRun(run);
      if (next !== run) changed = true;
      return next;
    })
    .filter(Boolean);
  return { runs, changed };
}

function loadRunsFromDirectory(filePath) {
  const runsDir = workflowRunFilesDir(filePath);
  if (!runsDir || !fs.existsSync(runsDir)) return { runs: [], changed: false };
  const runs = fs.readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      try {
        const run = JSON.parse(fs.readFileSync(path.join(runsDir, entry.name), "utf8"));
        return run?.workflowRunId ? normalizeLoadedRun(run) : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { runs, changed: true };
}

function readRunFile(filePath, ref) {
  const rootDir = path.dirname(filePath);
  const runPath = path.resolve(rootDir, ref.file ?? path.join("runs", `${safeWorkflowRunFileName(ref.workflowRunId)}.json`));
  if (!isPathInside(runPath, rootDir)) return null;
  try {
    return JSON.parse(fs.readFileSync(runPath, "utf8"));
  } catch {
    return null;
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
  for (const run of runs.values()) persistRun(filePath, run);
  persistRunIndex(filePath, runs);
}

function persistRun(filePath, run) {
  if (!filePath || !run?.workflowRunId) return;
  const runPath = workflowRunFilePath(filePath, run.workflowRunId);
  fs.mkdirSync(path.dirname(runPath), { recursive: true });
  fs.writeFileSync(runPath, JSON.stringify(run, null, 2), "utf8");
}

function persistRunIndex(filePath, runs) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 2,
    storage: {
      mode: "per-run-file",
      runsDir: "runs",
    },
    runRefs: Array.from(runs.values()).map((run) => ({
      workflowRunId: run.workflowRunId,
      workflowKey: run.workflowKey ?? null,
      workflowVersion: run.workflowVersion ?? null,
      status: run.status ?? null,
      traceId: run.traceId ?? null,
      runId: run.runId ?? null,
      sampleVideoId: run.sampleVideoId ?? null,
      createdAt: run.createdAt ?? null,
      updatedAt: run.updatedAt ?? null,
      completedAt: run.completedAt ?? null,
      file: path.join("runs", `${safeWorkflowRunFileName(run.workflowRunId)}.json`).replace(/\\/g, "/"),
    })),
  }, null, 2), "utf8");
}

function workflowRunFilesDir(filePath) {
  return filePath ? path.join(path.dirname(filePath), "runs") : null;
}

function workflowRunFilePath(filePath, workflowRunId) {
  return path.join(workflowRunFilesDir(filePath), `${safeWorkflowRunFileName(workflowRunId)}.json`);
}

function safeWorkflowRunFileName(workflowRunId) {
  return String(workflowRunId).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isPathInside(targetPath, rootDir) {
  const relative = path.relative(rootDir, targetPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

module.exports = { createWorkflowRunStore };
