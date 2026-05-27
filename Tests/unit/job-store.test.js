const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJobStore } = require("../../Apps/Api/lib/stores/job-store");

test("processing job flows through statuses", () => {
  const store = createJobStore();
  const job = store.createJob({ sampleVideoId: "sample_1", traceId: "trace_1" });
  assert.equal(job.status, "pending");
  const processing = store.updateJob(job.jobId, { status: "processing", stage: "ffprobe", progress: 40 });
  assert.equal(processing.stage, "ffprobe");
  const processed = store.updateJob(job.jobId, { status: "processed", progress: 100 });
  assert.equal(processed.progress, 100);
});

test("job store marks interrupted persisted jobs as failed on restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-store-restart-"));
  const filePath = path.join(dir, "processing-jobs.json");
  fs.writeFileSync(filePath, JSON.stringify({
    jobs: [
      { jobId: "job_processing", sampleVideoId: "sample_1", traceId: "trace_1", stage: "function_slot_atomization.analyze", status: "processing", progress: 58 },
      { jobId: "job_pending", sampleVideoId: "sample_2", traceId: "trace_2", stage: "uploaded", status: "pending", progress: 0 },
      { jobId: "job_waiting", sampleVideoId: "sample_3", traceId: "trace_3", stage: "cache.lookup", status: "cache_waiting", progress: 28 },
      { jobId: "job_done", sampleVideoId: "sample_4", traceId: "trace_4", stage: "processed", status: "processed", progress: 100 },
    ],
  }), "utf8");

  const store = createJobStore({ filePath });
  const processing = store.getJob("job_processing");
  const pending = store.getJob("job_pending");
  const waiting = store.getJob("job_waiting");
  const done = store.getJob("job_done");

  assert.equal(processing.status, "failed");
  assert.equal(processing.errorSummary.code, "processing_job_interrupted_by_restart");
  assert.equal(processing.errorSummary.retryable, true);
  assert.equal(pending.status, "failed");
  assert.equal(waiting.status, "cache_waiting");
  assert.equal(done.status, "processed");

  assert.equal(fs.existsSync(filePath), false);
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, "active-jobs.json"), "utf8"));
  assert.equal(persisted.jobs.find((job) => job.jobId === "job_processing").status, "failed");
});

test("job store keeps active jobs and archives older terminal jobs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-store-archive-"));
  const filePath = path.join(dir, "active-jobs.json");
  fs.writeFileSync(filePath, JSON.stringify({
    jobs: [
      { jobId: "job_old_done", sampleVideoId: "sample_1", traceId: "trace_1", stage: "processed", status: "processed", progress: 100, updatedAt: "2026-05-01T00:00:00.000Z" },
      { jobId: "job_new_done", sampleVideoId: "sample_2", traceId: "trace_2", stage: "processed", status: "processed", progress: 100, updatedAt: "2026-05-02T00:00:00.000Z" },
      { jobId: "job_active", sampleVideoId: "sample_3", traceId: "trace_3", stage: "function_slot_atomization.analyze", status: "processing", progress: 58 },
    ],
  }), "utf8");

  const store = createJobStore({ filePath, terminalRetention: 1 });

  assert.equal(store.getJob("job_old_done"), null);
  assert.equal(store.getJob("job_new_done").status, "processed");
  assert.equal(store.getJob("job_active").status, "failed");

  const active = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.deepEqual(active.jobs.map((job) => job.jobId).sort(), ["job_active", "job_new_done"]);

  const archivePath = path.join(dir, "archive", "2026--05--01.jsonl");
  const archived = fs.readFileSync(archivePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(archived.map((job) => job.jobId), ["job_old_done"]);
});

test("job store archives terminal jobs after retention is exceeded by updates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-store-update-archive-"));
  const filePath = path.join(dir, "active-jobs.json");
  const store = createJobStore({ filePath, terminalRetention: 1 });
  const first = store.createJob({ sampleVideoId: "sample_1", traceId: "trace_1" });
  const second = store.createJob({ sampleVideoId: "sample_2", traceId: "trace_2" });

  store.updateJob(first.jobId, { status: "processed", stage: "processed", progress: 100, updatedAt: "2026-05-01T00:00:00.000Z" });
  store.updateJob(second.jobId, { status: "processed", stage: "processed", progress: 100, updatedAt: "2026-05-02T00:00:00.000Z" });

  assert.equal(store.getJob(first.jobId), null);
  assert.equal(store.getJob(second.jobId).status, "processed");
  const active = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.deepEqual(active.jobs.map((job) => job.jobId), [second.jobId]);
  const archiveText = fs.readFileSync(path.join(dir, "archive", "2026--05--01.jsonl"), "utf8");
  assert.match(archiveText, new RegExp(first.jobId));
});
