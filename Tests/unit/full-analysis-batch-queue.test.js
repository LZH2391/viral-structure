const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFullAnalysisBatchQueue } = require("../../Apps/Api/lib/workflows/full-analysis/batch-queue");

function createFile(name) {
  return { filename: name, mimeType: "video/mp4", size: 5, buffer: Buffer.from(name) };
}

test("full analysis batch queue starts at most two workflow runs by default", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-"));
  const runs = new Map();
  const started = [];
  const workflowService = {
    start: async ({ file }) => {
      const workflowRunId = `workflow_${started.length + 1}`;
      started.push(file.filename);
      runs.set(workflowRunId, { workflowRunId, status: "running", currentStageKeys: ["upload"], stages: [{ key: "upload", label: "上传" }] });
      return runs.get(workflowRunId);
    },
    get: (workflowRunId) => runs.get(workflowRunId) ?? null,
    advance: async () => undefined,
  };
  const queue = createFullAnalysisBatchQueue({ workflowService, runtimeRoot: root });

  const batch = queue.createBatch({
    workspaceId: "default-workspace",
    files: [createFile("a.mp4"), createFile("b.mp4"), createFile("c.mp4"), createFile("d.mp4"), createFile("e.mp4")],
    fields: {},
  });
  await queue.advance(batch.batchRunId);
  const current = queue.getBatch(batch.batchRunId);

  assert.equal(started.length, 2);
  assert.equal(current.items.filter((item) => item.status === "running").length, 2);
  assert.equal(current.items.filter((item) => item.status === "queued").length, 3);
});

test("full analysis batch queue dispatches next item when one run completes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-"));
  const runs = new Map();
  const workflowService = {
    start: async ({ file }) => {
      const workflowRunId = `workflow_${runs.size + 1}`;
      runs.set(workflowRunId, { workflowRunId, status: "running", currentStageKeys: ["upload"], stages: [{ key: "upload", label: "上传" }] });
      return runs.get(workflowRunId);
    },
    get: (workflowRunId) => runs.get(workflowRunId) ?? null,
    advance: async () => undefined,
  };
  const queue = createFullAnalysisBatchQueue({ workflowService, runtimeRoot: root });
  const batch = queue.createBatch({
    workspaceId: "default-workspace",
    files: [createFile("a.mp4"), createFile("b.mp4"), createFile("c.mp4")],
    fields: {},
  });
  await queue.advance(batch.batchRunId);
  runs.get("workflow_1").status = "processed";

  await queue.advance(batch.batchRunId);
  const current = queue.getBatch(batch.batchRunId);

  assert.equal(runs.size, 3);
  assert.equal(current.items[0].status, "processed");
  assert.equal(current.items[2].status, "running");
});

test("full analysis batch queue treats cache waiting as non-active for dispatch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-"));
  const runs = new Map();
  const workflowService = {
    start: async () => {
      const workflowRunId = `workflow_${runs.size + 1}`;
      runs.set(workflowRunId, { workflowRunId, status: "running", currentStageKeys: ["shotBoundary"], stages: [{ key: "shotBoundary", label: "切镜" }] });
      return runs.get(workflowRunId);
    },
    get: (workflowRunId) => runs.get(workflowRunId) ?? null,
    advance: async () => undefined,
  };
  const queue = createFullAnalysisBatchQueue({ workflowService, runtimeRoot: root });
  const batch = queue.createBatch({
    workspaceId: "default-workspace",
    files: [createFile("a.mp4"), createFile("b.mp4"), createFile("c.mp4")],
    fields: {},
  });
  await queue.advance(batch.batchRunId);
  runs.get("workflow_1").status = "cache_waiting";

  await queue.advance(batch.batchRunId);
  const current = queue.getBatch(batch.batchRunId);

  assert.equal(runs.size, 3);
  assert.equal(current.items[0].status, "cache_waiting");
  assert.equal(current.items[2].status, "running");
});
