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

  const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(persisted.jobs.find((job) => job.jobId === "job_processing").status, "failed");
});
