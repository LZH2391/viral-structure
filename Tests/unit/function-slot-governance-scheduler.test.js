const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createSemanticGovernanceScheduler } = require("../../Apps/Api/lib/function-slot-library/governance-scheduler");

test("semantic governance scheduler runs once after structure queue idle", async () => {
  const harness = await createHarness();
  harness.slotIndexContent = JSON.stringify({ sampleIds: ["sample_1"] });

  harness.scheduler.handleQueueChanged(null, { reason: "batch_advanced", batches: [processedBatch("sample_1")] });

  await waitUntil(() => harness.enqueueCalls.length === 1);
  await waitUntil(() => harness.scheduler.getState().status === "idle");
  assert.equal(harness.enqueueCalls[0].refreshEvidence, true);
  assert.equal(harness.enqueueCalls[0].triggerReason, "full_analysis_queue_idle");
  assert.equal(harness.scheduler.getState().lastEvidenceHash, harness.scheduler.getState().lastGovernedEvidenceHash);
  harness.scheduler.dispose();
});

test("semantic governance scheduler quiet window is reset by new active queue work", async () => {
  const harness = await createHarness({ quietWindowMs: 25 });
  harness.slotIndexContent = JSON.stringify({ sampleIds: ["sample_1", "sample_2"] });

  harness.scheduler.handleQueueChanged(null, { reason: "batch_advanced", batches: [processedBatch("sample_1")] });
  await sleep(5);
  harness.scheduler.handleQueueChanged(null, { reason: "batch_created", batches: [activeBatch("sample_2")] });
  await sleep(35);
  assert.equal(harness.enqueueCalls.length, 0);
  assert.equal(harness.scheduler.getState().status, "idle");

  harness.scheduler.handleQueueChanged(null, { reason: "batch_advanced", batches: [processedBatch("sample_1"), processedBatch("sample_2")] });
  await waitUntil(() => harness.enqueueCalls.length === 1);
  harness.scheduler.dispose();
});

test("semantic governance scheduler marks dirty during a running governance job and schedules a rerun", async () => {
  const harness = await createHarness({ autoCompleteJobs: false });
  harness.slotIndexContent = JSON.stringify({ sampleIds: ["sample_1"] });

  harness.scheduler.handleQueueChanged(null, { reason: "batch_advanced", batches: [processedBatch("sample_1")] });
  await waitUntil(() => harness.enqueueCalls.length === 1);
  assert.equal(harness.scheduler.getState().status, "running");

  harness.slotIndexContent = JSON.stringify({ sampleIds: ["sample_1", "sample_2"] });
  harness.scheduler.handleQueueChanged(null, { reason: "batch_advanced", batches: [processedBatch("sample_1"), processedBatch("sample_2")] });
  assert.equal(harness.scheduler.getState().status, "dirty");

  harness.completeJob("job_1");
  await waitUntil(() => harness.enqueueCalls.length === 2);
  harness.scheduler.dispose();
});

test("semantic governance scheduler skips unchanged evidence hash", async () => {
  const harness = await createHarness();
  harness.slotIndexContent = JSON.stringify({ sampleIds: ["sample_1"] });

  harness.scheduler.handleQueueChanged(null, { reason: "batch_advanced", batches: [processedBatch("sample_1")] });
  await waitUntil(() => harness.scheduler.getState().status === "idle");
  assert.equal(harness.enqueueCalls.length, 1);

  harness.scheduler.handleQueueChanged(null, { reason: "batch_advanced", batches: [processedBatch("sample_1")] });
  await waitUntil(() => harness.scheduler.getState().status === "skipped");
  assert.equal(harness.enqueueCalls.length, 1);
  assert.match(harness.scheduler.getState().message ?? "", /证据未变化/);
  harness.scheduler.dispose();
});

test("semantic governance scheduler skips terminal queue without successful atomization", async () => {
  const harness = await createHarness();
  harness.scheduler.handleQueueChanged(null, { reason: "batch_advanced", batches: [failedBatch()] });

  assert.equal(harness.scheduler.getState().status, "skipped");
  assert.equal(harness.enqueueCalls.length, 0);
  harness.scheduler.dispose();
});

async function createHarness({ quietWindowMs = 5, autoCompleteJobs = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-governance-scheduler-"));
  const jobs = new Map();
  const enqueueCalls = [];
  const harness = {
    root,
    slotIndexContent: JSON.stringify({ sampleIds: [] }),
    enqueueCalls,
    completeJob(jobId) {
      jobs.set(jobId, { status: "processed" });
    },
  };
  const builderService = {
    refresh: async () => {
      await writeJson(path.join(root, "Runtime", "Temp", "FunctionSlotLibrary", "slot_index.json"), JSON.parse(harness.slotIndexContent));
      return { ok: true };
    },
  };
  const governanceService = {
    enqueue: async (payload) => {
      enqueueCalls.push(payload);
      const jobId = `job_${enqueueCalls.length}`;
      jobs.set(jobId, { status: "running" });
      if (autoCompleteJobs) setTimeout(() => jobs.set(jobId, { status: "processed" }), 0);
      return {
        processingJobId: jobId,
        traceId: `trace_${enqueueCalls.length}`,
        status: "submitted",
      };
    },
  };
  harness.scheduler = createSemanticGovernanceScheduler({
    rootDir: root,
    runtimeRoot: path.join(root, "Runtime"),
    builderService,
    governanceService,
    jobStore: { getJob: (jobId) => jobs.get(jobId) ?? null },
    loadSampleArtifact: async ({ sampleVideoId }) => ({ sampleVideoId, functionSlotAtomizationAnalysis: { artifactId: `artifact_${sampleVideoId}` } }),
    quietWindowMs,
    pollIntervalMs: 1,
  });
  return harness;
}

function processedBatch(sampleVideoId) {
  return {
    batchRunId: `batch_${sampleVideoId}`,
    workflowKey: "full-analysis",
    status: "processed",
    items: [{
      queueItemId: `item_${sampleVideoId}`,
      sampleVideoId,
      status: "processed",
    }],
  };
}

function activeBatch(sampleVideoId) {
  return {
    batchRunId: `batch_${sampleVideoId}`,
    workflowKey: "full-analysis",
    status: "running",
    items: [{
      queueItemId: `item_${sampleVideoId}`,
      sampleVideoId,
      status: "running",
    }],
  };
}

function failedBatch() {
  return {
    batchRunId: "batch_failed",
    workflowKey: "full-analysis",
    status: "partial_failed",
    items: [{
      queueItemId: "item_failed",
      sampleVideoId: null,
      status: "failed",
    }],
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error("condition was not met before timeout");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
