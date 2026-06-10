const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkflowRunStore } = require("../../Apps/Api/lib/stores/workflow-run-store");

test("workflow run store marks running persisted runs as failed on restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-restart-"));
  const filePath = path.join(dir, "workflow-runs.json");
  fs.writeFileSync(filePath, JSON.stringify({
    runs: [
      {
        workflowRunId: "workflow_running",
        workflowKey: "full-analysis",
        workflowVersion: "full-analysis.v1",
        status: "running",
        traceId: "trace_workflow",
        runId: "run_workflow",
        sampleVideoId: "sample_1",
        currentStageKeys: ["scriptSegment"],
        stages: [
          { key: "upload", stageName: "sample.ingest", status: "processed" },
          { key: "scriptSegment", stageName: "script.segment.analyze", status: "running" },
          { key: "rhythmStructure", stageName: "rhythm.structure.analyze", status: "pending" },
        ],
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:01:00.000Z",
      },
      {
        workflowRunId: "workflow_processed",
        workflowKey: "full-analysis",
        workflowVersion: "full-analysis.v1",
        status: "processed",
        traceId: "trace_done",
        runId: "run_done",
        currentStageKeys: [],
        stages: [],
      },
    ],
  }), "utf8");

  const store = createWorkflowRunStore({ filePath });
  const running = store.getRun("workflow_running");
  const processed = store.getRun("workflow_processed");

  assert.equal(running.status, "failed");
  assert.deepEqual(running.currentStageKeys, []);
  assert.equal(running.errorSummary.code, "workflow_run_interrupted_by_restart");
  assert.equal(running.errorSummary.retryable, true);
  assert.equal(running.stages.find((stage) => stage.key === "scriptSegment").status, "failed");
  assert.equal(running.stages.find((stage) => stage.key === "rhythmStructure").status, "pending");
  assert.equal(processed.status, "processed");

  const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(persisted.schemaVersion, 2);
  assert.equal(persisted.storage.mode, "per-run-file");
  assert.equal(persisted.runRefs.find((run) => run.workflowRunId === "workflow_running").status, "failed");
  assert.equal(persisted.runRefs.some((run) => Array.isArray(run.stages)), false);

  const runFile = path.join(dir, persisted.runRefs.find((run) => run.workflowRunId === "workflow_running").file);
  const persistedRun = JSON.parse(fs.readFileSync(runFile, "utf8"));
  assert.equal(persistedRun.status, "failed");
  assert.equal(persistedRun.stages.find((stage) => stage.key === "scriptSegment").status, "failed");
});

test("workflow run store persists each run in its own file and reloads through index refs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-files-"));
  const filePath = path.join(dir, "workflow-runs.json");
  const store = createWorkflowRunStore({ filePath });
  store.createRun({
    workflowRunId: "workflow_one",
    workflowKey: "full-analysis",
    workflowVersion: "full-analysis.v1",
    status: "running",
    traceId: "trace_one",
    runId: "run_one",
    sampleVideoId: "sample_1",
    currentStageKeys: [],
    stages: [{ key: "upload", stageName: "sample.ingest", status: "processed" }],
    createdAt: "2026-05-27T00:00:00.000Z",
  });
  store.updateRun("workflow_one", { status: "processed", completedAt: "2026-05-27T00:01:00.000Z" });

  const index = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(index.runRefs.length, 1);
  assert.equal(index.runRefs[0].file, "runs/workflow_one.json");
  assert.equal(index.runRefs[0].status, "processed");
  assert.equal(index.runRefs[0].stages, undefined);

  const runPath = path.join(dir, "runs", "workflow_one.json");
  const runFile = JSON.parse(fs.readFileSync(runPath, "utf8"));
  assert.deepEqual(runFile.stages.map((stage) => stage.key), ["upload"]);

  const reloaded = createWorkflowRunStore({ filePath });
  assert.equal(reloaded.getRun("workflow_one").status, "processed");
  assert.deepEqual(reloaded.listRuns().map((run) => run.workflowRunId), ["workflow_one"]);
});

test("workflow run store rejects stale active turn updates when only attempt matches", () => {
  const store = createWorkflowRunStore();
  store.createRun({
    workflowRunId: "workflow_turn_identity",
    workflowKey: "full-analysis",
    workflowVersion: "full-analysis.v1",
    status: "running",
    traceId: "trace_turn_identity",
    runId: "run_turn_identity",
    sampleVideoId: "sample_1",
    currentStageKeys: ["scriptSegment"],
    stages: [{
      key: "scriptSegment",
      stageName: "script.segment.analyze",
      status: "running",
      activeTurn: {
        turnId: "turn_current",
        currentAttemptId: "attempt_shared",
        status: "running",
      },
    }],
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
  });

  const stale = store.updateStageTurnState("workflow_turn_identity", {
    turnId: "turn_old",
    currentAttemptId: "attempt_shared",
    status: "completed",
  });
  assert.equal(stale.status, "stale");
  assert.equal(store.getRun("workflow_turn_identity").stages[0].status, "running");
  assert.equal(store.getRun("workflow_turn_identity").stages[0].activeTurn.status, "running");

  const current = store.updateStageTurnState("workflow_turn_identity", {
    turnId: "turn_current",
    currentAttemptId: "attempt_shared",
    status: "completed",
  });
  assert.equal(current.status, "completed");
  assert.equal(store.getRun("workflow_turn_identity").stages[0].status, "completed");
});

test("workflow run store ignores out-of-root run refs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-safety-"));
  const filePath = path.join(dir, "workflow-runs.json");
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 2,
    storage: { mode: "per-run-file", runsDir: "runs" },
    runRefs: [
      { workflowRunId: "workflow_bad", file: "../outside.json" },
    ],
  }), "utf8");

  const store = createWorkflowRunStore({ filePath });
  assert.equal(store.getRun("workflow_bad"), null);
  assert.deepEqual(store.listRuns(), []);
});

test("workflow run store treats index as rebuildable cache", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-index-cache-"));
  const filePath = path.join(dir, "workflow-runs.json");
  fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 2,
    storage: { mode: "per-run-file", runsDir: "runs" },
    runRefs: [],
  }), "utf8");
  fs.writeFileSync(path.join(dir, "runs", "workflow_unindexed.json"), JSON.stringify({
    workflowRunId: "workflow_unindexed",
    workflowKey: "material-recognition",
    workflowVersion: "material-recognition.v1",
    status: "processed",
    traceId: "trace_unindexed",
    runId: "run_unindexed",
    currentStageKeys: [],
    stages: [],
  }), "utf8");

  const store = createWorkflowRunStore({ filePath });

  assert.equal(store.getRun("workflow_unindexed").status, "processed");
  assert.deepEqual(store.listRuns().map((run) => run.workflowRunId), ["workflow_unindexed"]);
});
