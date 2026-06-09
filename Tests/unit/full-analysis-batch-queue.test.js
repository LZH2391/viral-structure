const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFullAnalysisBatchQueue } = require("../../Apps/Api/lib/workflows/full-analysis/batch-queue");

function createFile(name) {
  return { filename: name, mimeType: "video/mp4", size: 5, buffer: Buffer.from(name) };
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was not met before timeout");
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

test("full analysis batch queue treats cache waiting as active for dispatch limit", async () => {
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

  assert.equal(runs.size, 2);
  assert.equal(current.items[0].status, "cache_waiting");
  assert.equal(current.items[2].status, "queued");
});

test("full analysis batch queue replays advance requested while dispatch is running", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-"));
  const runs = new Map();
  let releaseStart;
  const firstStartBlocked = new Promise((resolve) => {
    releaseStart = () => {
      runs.get("workflow_1").status = "processed";
      resolve();
    };
  });
  const workflowService = {
    start: async ({ file }) => {
      const workflowRunId = `workflow_${runs.size + 1}`;
      runs.set(workflowRunId, { workflowRunId, status: "running", currentStageKeys: ["upload"], stages: [{ key: "upload", label: "上传" }] });
      if (file.filename === "a.mp4") await firstStartBlocked;
      return runs.get(workflowRunId);
    },
    get: (workflowRunId) => runs.get(workflowRunId) ?? null,
    advance: async () => undefined,
  };
  const queue = createFullAnalysisBatchQueue({ workflowService, runtimeRoot: root, defaultMaxConcurrentRuns: 1 });
  const batch = queue.createBatch({
    workspaceId: "default-workspace",
    files: [createFile("a.mp4"), createFile("b.mp4")],
    fields: {},
  });
  const firstAdvance = queue.advance(batch.batchRunId);
  await waitUntil(() => runs.has("workflow_1"));
  const replayedAdvance = queue.advance(batch.batchRunId);

  releaseStart();
  await firstAdvance;
  await replayedAdvance;
  const current = queue.getBatch(batch.batchRunId);

  assert.equal(runs.size, 2);
  assert.equal(current.items[0].status, "processed");
  assert.equal(current.items[1].status, "running");
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

test("full analysis batch queue fails item when workflow start returns no run id", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-"));
  const started = [];
  const workflowService = {
    start: async ({ file }) => {
      started.push(file.filename);
      return { ok: true, status: "running", currentStageKeys: ["upload"], stages: [{ key: "upload", label: "上传" }] };
    },
    get: () => null,
    advance: async () => undefined,
  };
  const queue = createFullAnalysisBatchQueue({ workflowService, runtimeRoot: root, defaultMaxConcurrentRuns: 1 });
  const batch = queue.createBatch({
    workspaceId: "default-workspace",
    files: [createFile("a.mp4"), createFile("b.mp4")],
    fields: {},
  });

  await queue.advance(batch.batchRunId);
  const current = queue.getBatch(batch.batchRunId);

  assert.equal(started.length, 2);
  assert.equal(current.items[0].status, "failed");
  assert.equal(current.items[0].workflowRunId, null);
  assert.equal(current.items[0].errorSummary.code, "full_analysis_batch_workflow_start_invalid");
  assert.equal(current.items[0].retryable, true);
  assert.equal(current.items[1].status, "failed");
});

test("workflow batch queue can dispatch material recognition batches", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-recognition-batch-"));
  const started = [];
  const workflowService = {
    start: async ({ file, fields }) => {
      started.push({ filename: file.filename, enableFunctionSlotAtomization: fields.enableFunctionSlotAtomization ?? null });
      return { workflowRunId: `workflow_${started.length}`, status: "running", currentStageKeys: ["upload"], stages: [{ key: "upload", label: "上传" }] };
    },
    get: () => null,
    advance: async () => undefined,
  };
  const queue = createFullAnalysisBatchQueue({
    workflowService,
    runtimeRoot: root,
    filePath: path.join(root, "WorkflowRuns", "material-recognition-queue.json"),
    uploadRoot: path.join(root, "WorkflowRuns", "material-recognition-batch-uploads"),
    workflowKey: "material-recognition",
    workflowLabel: "素材识别",
    errorCode: "material_recognition_batch_item_failed",
    stageName: "workflow.material_recognition.batch.dispatch",
    buildOptions: () => ({}),
  });

  const batch = queue.createBatch({
    workspaceId: "default-workspace",
    files: [createFile("a.mp4"), createFile("b.mp4")],
    fields: {},
  });
  await queue.advance(batch.batchRunId);
  const current = queue.getBatch(batch.batchRunId);

  assert.equal(current.workflowKey, "material-recognition");
  assert.deepEqual(started, [
    { filename: "a.mp4", enableFunctionSlotAtomization: null },
    { filename: "b.mp4", enableFunctionSlotAtomization: null },
  ]);
});
