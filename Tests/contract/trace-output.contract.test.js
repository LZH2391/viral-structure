const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createTraceContext } = require("../../Core/Workspace/sample-video-contracts");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");

test("stage output includes required trace fields", () => {
  const trace = createTraceContext({ runId: "run_1", traceId: "trace_1", stageId: "stage_1" });
  const output = { ...trace, artifactId: "artifact_1" };
  for (const key of ["runId", "traceId", "stageId", "artifactId"]) {
    assert.ok(output[key], `${key} is required`);
  }
});

test("stage logger writes the normalized debug trace contract", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-trace-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const traceContext = createTraceContext({ runId: "run_1", traceId: "trace_1", stageId: "stage_1" });
  const line = await logger.writeStageLog({
    traceContext,
    stageName: "sample.upload.received",
    event: "stage.start",
    inputSummary: { filename: "sample.mp4" },
  });
  const expectedFields = [
    "event",
    "runId",
    "traceId",
    "stageId",
    "stageName",
    "artifactId",
    "parentArtifactId",
    "inputSummary",
    "outputSummary",
    "durationMs",
    "errorSummary",
    "createdAt",
  ];
  assert.deepEqual(Object.keys(line), expectedFields);
  assert.equal(line.artifactId, null);
  assert.equal(line.outputSummary, null);
  assert.equal(line.errorSummary, null);

  const logPath = path.join(store.runtimeRoot, "DebugSnapshots", "trace_1.log.jsonl");
  const [saved] = (await fs.readFile(logPath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(Object.keys(saved), expectedFields);
});
