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

test("full analysis batch queue syncs cache-completed workflow during dispatch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-"));
  const runs = new Map();
  const workflowService = {
    start: async () => {
      const run = { workflowRunId: "workflow_cache", status: "running", sampleVideoId: "sample_cached", currentStageKeys: ["upload"], stages: [{ key: "upload", label: "上传", status: "processed" }] };
      runs.set(run.workflowRunId, run);
      return run;
    },
    advance: async (workflowRunId) => {
      const run = runs.get(workflowRunId);
      runs.set(workflowRunId, { ...run, status: "processed", currentStageKeys: [], stages: [{ key: "upload", label: "上传", status: "processed" }] });
    },
    get: (workflowRunId) => runs.get(workflowRunId) ?? null,
  };
  const queue = createFullAnalysisBatchQueue({ workflowService, runtimeRoot: root });
  const batch = queue.createBatch({
    workspaceId: "default-workspace",
    files: [createFile("cached.mp4")],
    fields: {},
  });

  await queue.advance(batch.batchRunId);
  const current = queue.getBatch(batch.batchRunId);

  assert.equal(current.items[0].status, "processed");
  assert.equal(current.items[0].sampleVideoId, "sample_cached");
  assert.equal(current.items[0].currentStageLabel, null);
  assert.equal(current.status, "processed");
});

test("full analysis batch queue hides terminal batches from active queue after grace window", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-"));
  const workflowService = {
    start: async () => ({ workflowRunId: "workflow_done", status: "processed", sampleVideoId: "sample_done", currentStageKeys: [], stages: [] }),
    advance: async () => undefined,
    get: () => ({ workflowRunId: "workflow_done", status: "processed", sampleVideoId: "sample_done", currentStageKeys: [], stages: [] }),
  };
  const queue = createFullAnalysisBatchQueue({
    workflowService,
    runtimeRoot: root,
    terminalActiveGraceMs: 0,
  });
  const batch = queue.createBatch({
    workspaceId: "default-workspace",
    files: [createFile("done.mp4")],
    fields: {},
  });
  await queue.advance(batch.batchRunId);

  assert.equal(queue.getBatch(batch.batchRunId).status, "processed");
  assert.equal(queue.getLatestActiveBatch(), null);
});

test("full analysis batch queue prunes old terminal batches from persisted queue", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-"));
  let startCount = 0;
  const workflowService = {
    start: async () => {
      startCount += 1;
      return { workflowRunId: `workflow_${startCount}`, status: "processed", sampleVideoId: `sample_${startCount}`, currentStageKeys: [], stages: [] };
    },
    advance: async () => undefined,
    get: (workflowRunId) => ({ workflowRunId, status: "processed", sampleVideoId: workflowRunId.replace("workflow_", "sample_"), currentStageKeys: [], stages: [] }),
  };
  const queueFile = path.join(root, "WorkflowRuns", "full-analysis-queue.json");
  const queue = createFullAnalysisBatchQueue({
    workflowService,
    runtimeRoot: root,
    filePath: queueFile,
    terminalRetentionLimit: 1,
  });
  const first = queue.createBatch({ workspaceId: "default-workspace", files: [createFile("a.mp4")], fields: {} });
  await queue.advance(first.batchRunId);
  const second = queue.createBatch({ workspaceId: "default-workspace", files: [createFile("b.mp4")], fields: {} });
  await queue.advance(second.batchRunId);

  const raw = JSON.parse(fs.readFileSync(queueFile, "utf8"));
  assert.equal(raw.batches.length, 1);
  assert.equal(raw.batches[0].batchRunId, second.batchRunId);
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

test("full analysis batch queue notifies queue changes for terminal and retry transitions", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-callback-"));
  const notifications = [];
  const runs = new Map();
  const workflowService = {
    start: async () => {
      const workflowRunId = `workflow_${runs.size + 1}`;
      runs.set(workflowRunId, { workflowRunId, status: "running", currentStageKeys: ["upload"], stages: [{ key: "upload", label: "上传" }] });
      return runs.get(workflowRunId);
    },
    get: (workflowRunId) => runs.get(workflowRunId) ?? null,
    cancelRun: async ({ workflowRunId }) => {
      const run = { ...runs.get(workflowRunId), status: "canceled", currentStageKeys: [] };
      runs.set(workflowRunId, run);
      return run;
    },
    advance: async () => undefined,
  };
  const queue = createFullAnalysisBatchQueue({
    workflowService,
    runtimeRoot: root,
    onQueueChanged: (batch, context) => notifications.push({ reason: context.reason, status: batch.status, hasActiveBatches: context.hasActiveBatches }),
  });
  const batch = queue.createBatch({ workspaceId: "default-workspace", files: [createFile("a.mp4")], fields: {} });
  await queue.advance(batch.batchRunId);
  const canceled = await queue.cancelItem(batch.batchRunId, batch.items[0].queueItemId);
  const retried = queue.retryItem(batch.batchRunId, batch.items[0].queueItemId);

  assert.equal(canceled.status, "canceled");
  assert.equal(retried.status, "queued");
  assert.ok(notifications.some((entry) => entry.reason === "item_canceled" && entry.hasActiveBatches === false));
  assert.ok(notifications.some((entry) => entry.reason === "item_retried" && entry.hasActiveBatches === true));
});

test("full analysis batch queue reports cache waiting as active in queue callback", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-cache-callback-"));
  const notifications = [];
  const workflowService = {
    start: async () => ({ workflowRunId: "workflow_cache_wait", status: "cache_waiting", currentStageKeys: ["shotBoundary"], stages: [{ key: "shotBoundary", label: "切镜" }] }),
    get: () => ({ workflowRunId: "workflow_cache_wait", status: "cache_waiting", currentStageKeys: ["shotBoundary"], stages: [{ key: "shotBoundary", label: "切镜" }] }),
    advance: async () => undefined,
  };
  const queue = createFullAnalysisBatchQueue({
    workflowService,
    runtimeRoot: root,
    onQueueChanged: (batch, context) => notifications.push({ reason: context.reason, status: batch.status, hasActiveBatches: context.hasActiveBatches }),
  });
  const batch = queue.createBatch({ workspaceId: "default-workspace", files: [createFile("a.mp4")], fields: {} });

  await queue.advance(batch.batchRunId);

  assert.ok(notifications.some((entry) => entry.status === "cache_waiting" && entry.hasActiveBatches === true));
});

test("material recognition batch queue closes stale cache waiting item when material pack exists", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-recognition-batch-"));
  const runs = new Map();
  const workflowService = {
    start: async () => {
      const run = {
        workflowRunId: "workflow_stale",
        status: "cache_waiting",
        sampleVideoId: "sample_done",
        currentStageKeys: ["shotBoundary"],
        stages: [{ key: "shotBoundary", label: "切镜", status: "cache_waiting" }],
      };
      runs.set(run.workflowRunId, run);
      return run;
    },
    get: (workflowRunId) => runs.get(workflowRunId) ?? null,
    advance: async () => undefined,
  };
  const queue = createFullAnalysisBatchQueue({
    workflowService,
    runtimeRoot: root,
    workflowKey: "material-recognition",
    terminalActiveGraceMs: 0,
    loadSampleArtifact: async ({ sampleVideoId }) => sampleVideoId === "sample_done" ? { userMaterialPack: { artifactId: "artifact_material" } } : null,
  });
  const batch = queue.createBatch({
    workspaceId: "default-workspace",
    files: [createFile("done.mp4")],
    fields: {},
  });

  await queue.advance(batch.batchRunId);
  const current = queue.getBatch(batch.batchRunId);

  assert.equal(current.items[0].status, "processed");
  assert.equal(current.items[0].currentStageLabel, null);
  assert.equal(current.status, "processed");
  assert.equal(queue.getLatestActiveBatch(), null);
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

test("full analysis batch queue cancels active item and allows retry from persisted upload", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-analysis-batch-"));
  const canceled = [];
  const runs = new Map();
  const workflowService = {
    start: async ({ file }) => {
      const workflowRunId = `workflow_${runs.size + 1}`;
      runs.set(workflowRunId, { workflowRunId, status: "running", currentStageKeys: ["shotBoundary"], stages: [{ key: "shotBoundary", label: "切镜" }] });
      return runs.get(workflowRunId);
    },
    get: (workflowRunId) => runs.get(workflowRunId) ?? null,
    cancelRun: async ({ workflowRunId, reason }) => {
      canceled.push({ workflowRunId, reason });
      const run = { ...runs.get(workflowRunId), status: "canceled", currentStageKeys: [], errorSummary: { code: "workflow_canceled" } };
      runs.set(workflowRunId, run);
      return run;
    },
    advance: async () => undefined,
  };
  const queue = createFullAnalysisBatchQueue({ workflowService, runtimeRoot: root });
  const batch = queue.createBatch({
    workspaceId: "default-workspace",
    files: [createFile("a.mp4")],
    fields: {},
  });
  await queue.advance(batch.batchRunId);

  const canceledBatch = await queue.cancelItem(batch.batchRunId, batch.items[0].queueItemId, "user_requested");
  assert.deepEqual(canceled, [{ workflowRunId: "workflow_1", reason: "user_requested" }]);
  assert.equal(canceledBatch.items[0].status, "canceled");
  assert.equal(canceledBatch.items[0].retryable, true);

  const retried = queue.retryItem(batch.batchRunId, batch.items[0].queueItemId);
  assert.equal(retried.items[0].status, "queued");
  assert.equal(retried.items[0].workflowRunId, null);
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
