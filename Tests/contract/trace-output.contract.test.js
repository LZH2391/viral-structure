const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createTraceContext } = require("../../Core/Workspace/sample-video-contracts");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger, expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");

test("stage output includes required trace fields", () => {
  const trace = createTraceContext({ runId: "run_1", traceId: "trace_1", stageId: "stage_1" });
  const output = { ...trace, artifactId: "artifact_1" };
  for (const key of ["runId", "traceId", "stageId", "artifactId"]) {
    assert.ok(output[key], `${key} is required`);
  }
});

test("stage logger writes compact logs that restore the debug trace contract", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-trace-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const traceContext = createTraceContext({ runId: "run_1", traceId: "trace_1", stageId: "stage_1" });
  const lines = [];
  for (const stageName of ["sample.upload.received", "sample.upload.validated", "sample.source.saved", "sample.metadata.probed"]) {
    lines.push(await logger.writeStageLog({ traceContext, stageName, event: "stage.start", inputSummary: { filename: "sample.mp4" } }));
    lines.push(await logger.writeStageLog({ traceContext, stageName, event: "stage.end", artifactId: "artifact_1", outputSummary: { ok: true }, durationMs: 3 }));
  }
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
  assert.deepEqual(Object.keys(lines[0]), expectedFields);

  const logPath = path.join(store.runtimeRoot, "DebugSnapshots", "trace_1.log.jsonl");
  const savedText = await fs.readFile(logPath, "utf8");
  const saved = savedText.trim().split("\n").map(JSON.parse);
  const restored = expandStageLogLines(saved);
  assert.deepEqual(Object.keys(restored[0]), expectedFields);
  assert.equal(restored[0].runId, "run_1");
  assert.equal(restored[0].traceId, "trace_1");
  assert.equal(restored[0].stageId, "stage_1");
  assert.equal(restored[1].artifactId, "artifact_1");
  assert.equal(restored[1].parentArtifactId, null);

  const fullText = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  assert.ok(savedText.length <= fullText.length * 0.6, `compact=${savedText.length} full=${fullText.length}`);
});
