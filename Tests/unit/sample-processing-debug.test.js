const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger, expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");
const { createJobStore } = require("../../Apps/Api/lib/job-store");
const { createSampleProcessingService, STAGES } = require("../../Apps/Api/lib/sample-processing-service");
const { PROCESSING_ERRORS } = require("../../Core/Workspace/sample-video-contracts");

test("failed upload stage writes start, fail and a debug snapshot", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-stage-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const service = createSampleProcessingService({ store, logger, jobStore });

  const upload = await service.enqueueUpload({
    workspaceId: "workspace_1",
    file: {
      filename: "notes.txt",
      extension: ".txt",
      mimeType: "text/plain",
      size: 5,
      buffer: Buffer.from("hello"),
    },
  });
  const job = await waitForJob(jobStore, upload.processingJobId, "failed");
  assert.equal(job.errorSummary.code, PROCESSING_ERRORS.invalidFileType);
  assert.equal(job.errorSummary.stageName, STAGES.uploadValidated);
  assert.ok(job.errorSummary.debugSnapshotUri.includes("/runtime/DebugSnapshots/"));

  const logPath = path.join(store.runtimeRoot, "DebugSnapshots", `${upload.traceId}.log.jsonl`);
  const logText = await fs.readFile(logPath, "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
  assert.deepEqual(logs.map((line) => line.event), ["stage.start", "stage.end", "stage.start", "stage.fail"]);
  assert.equal(logs.at(-1).stageName, STAGES.uploadValidated);
  assert.equal(logs.at(-1).errorSummary.debugSnapshotUri, job.errorSummary.debugSnapshotUri);
  const expandedText = `${logs.map((line) => JSON.stringify(line)).join("\n")}\n`;
  assert.ok(logText.length <= expandedText.length * 0.6, `compact=${logText.length} expanded=${expandedText.length}`);

  const snapshotPath = path.join(store.runtimeRoot, "DebugSnapshots", path.basename(job.errorSummary.debugSnapshotUri));
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  assert.equal(snapshot.stageName, STAGES.uploadValidated);
  assert.equal(snapshot.reason, PROCESSING_ERRORS.invalidFileType);
  assert.ok(snapshot.debugPayload.errorSummary);
});

async function waitForJob(jobStore, jobId, status) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = jobStore.getJob(jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not reach ${status}`);
}
