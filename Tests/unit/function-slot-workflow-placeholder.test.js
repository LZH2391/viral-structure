const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");
const { createJobStore } = require("../../Apps/Api/lib/stores/job-store");
const { createFunctionSlotWorkflowPlaceholderService } = require("../../Apps/Api/lib/function-slot-workflow/placeholder-service");

test("function slot workflow placeholder writes traceable artifact and processed job", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-function-slot-placeholder-"));
  const store = createLocalStore(root);
  const logger = createStageLogger(store);
  const jobStore = createJobStore({ filePath: path.join(store.runtimeRoot, "Jobs", "active-jobs.json") });
  const service = createFunctionSlotWorkflowPlaceholderService({
    store,
    logger,
    jobStore,
    now: () => "2026-05-29T00:00:00.000Z",
  });

  const started = await service.enqueue({
    moduleId: "function-slot-restructure",
    sampleVideoId: "sample_placeholder",
    parentArtifactId: "artifact_parent",
    body: { brief: "占位 brief" },
  });
  await waitForJob(jobStore, started.processingJobId);

  const job = jobStore.getJob(started.processingJobId);
  const artifactPath = path.join(root, "Runtime", "Artifacts", "sample_placeholder", "function-slot-restructure", started.artifactId, "artifact.json");
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
  const logPath = path.join(root, "Runtime", "DebugSnapshots", `${started.traceId}.log.jsonl`);
  const logText = await fs.readFile(logPath, "utf8");

  assert.equal(started.status, "placeholder");
  assert.equal(job.status, "processed");
  assert.equal(job.placeholder, true);
  assert.equal(job.artifactId, started.artifactId);
  assert.equal(artifact.traceId, started.traceId);
  assert.equal(artifact.stageId, started.stageId);
  assert.equal(artifact.parentArtifactId, "artifact_parent");
  assert.equal(artifact.prompt.mode, "placeholder");
  assert.match(logText, /"e":"s"/);
  assert.match(logText, /"e":"e"/);
});

async function waitForJob(jobStore, jobId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = jobStore.getJob(jobId);
    if (job?.status === "processed" || job?.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("placeholder job did not finish");
}
