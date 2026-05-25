const fs = require("fs");
const path = require("path");

function createWorkflowRunStore({ filePath = null } = {}) {
  const runs = new Map(loadRuns(filePath).map((run) => [run.workflowRunId, run]));

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
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed.runs) ? parsed.runs.filter((run) => run?.workflowRunId) : [];
  } catch {
    return [];
  }
}

function persistRuns(filePath, runs) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ runs: Array.from(runs.values()) }, null, 2), "utf8");
}

module.exports = { createWorkflowRunStore };
