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

test("full analysis batch queue restores failed items and retries from persisted upload", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-"));
  let failFirst = true;
  const started = [];
  const workflowService = {
    start: async ({ file }) => {
      started.push(file.filename);
      if (failFirst) {
        failFirst = false;
        throw new Error("temporary dispatch failure");
      }
      return { workflowRunId: "workflow_retry", status: "running", currentStageKeys: ["upload"], stages: [{ key: "upload", label: "上传" }] };
    },
    get: () => null,
    advance: async () => undefined,
  };
  const queue = createFullAnalysisBatchQueue({ workflowService, runtimeRoot: root });
  const batch = queue.createBatch({
    workspaceId: "default-workspace",
    files: [createFile("a.mp4")],
    fields: {},
  });
  await queue.advance(batch.batchRunId);
  const failed = queue.getBatch(batch.batchRunId);
  assert.equal(failed.items[0].status, "failed");
  assert.equal(failed.items[0].retryable, true);
  assert.equal(failed.items[0].sourceFileAvailable, true);

  const restoredQueue = createFullAnalysisBatchQueue({ workflowService, runtimeRoot: root });
  const restored = restoredQueue.getLatestBatch();
  assert.equal(restored.batchRunId, batch.batchRunId);
  assert.equal(restored.items[0].retryable, true);

  const retried = restoredQueue.retryItem(batch.batchRunId, failed.items[0].queueItemId);
  assert.equal(retried.items[0].status, "queued");
  await restoredQueue.advance(batch.batchRunId);
  const current = restoredQueue.getBatch(batch.batchRunId);
  assert.equal(started.length, 2);
  assert.equal(current.items[0].status, "running");
  assert.equal(current.items[0].workflowRunId, "workflow_retry");
});
