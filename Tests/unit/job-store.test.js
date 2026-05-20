const test = require("node:test");
const assert = require("node:assert/strict");
const { createJobStore } = require("../../Apps/Api/lib/job-store");

test("processing job flows through statuses", () => {
  const store = createJobStore();
  const job = store.createJob({ sampleVideoId: "sample_1", traceId: "trace_1" });
  assert.equal(job.status, "pending");
  const processing = store.updateJob(job.jobId, { status: "processing", stage: "ffprobe", progress: 40 });
  assert.equal(processing.stage, "ffprobe");
  const processed = store.updateJob(job.jobId, { status: "processed", progress: 100 });
  assert.equal(processed.progress, 100);
});
