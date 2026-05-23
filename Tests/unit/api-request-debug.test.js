const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger, expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");
const { recordApiRequestFailure } = require("../../Apps/Api/lib/api-request-debug");

test("records top-level API request failures as request trace", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-api-request-"));
  const store = createLocalStore(tempRoot);
  const logger = createStageLogger(store);
  const error = new Error("请求体不是有效 JSON");
  error.statusCode = 400;
  error.code = "invalid_json";

  const result = await recordApiRequestFailure(logger, { method: "POST", url: "/api/debug/ui-events?token=secret" }, error);
  const logPath = path.join(store.runtimeRoot, "DebugSnapshots", `${result.traceContext.traceId}.log.jsonl`);
  const logText = await fs.readFile(logPath, "utf8");
  const events = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));

  assert.deepEqual(events.map((event) => event.event), ["stage.start", "stage.fail"]);
  assert.equal(events[0].stageName, "api.request.handle");
  assert.equal(events[0].inputSummary.pathname, "/api/debug/ui-events");
  assert.equal(events[1].errorSummary.code, "invalid_json");
  assert.equal(events[1].errorSummary.retryable, false);
  assert.ok(events[1].errorSummary.debugSnapshotUri);
  assert.equal(result.errorSummary.code, "invalid_json");
  assert.equal(result.errorSummary.stageName, "api.request.handle");
  assert.equal(result.errorSummary.debugSnapshotUri, result.snapshot.uri);

  const snapshot = JSON.parse(await fs.readFile(path.join(store.runtimeRoot, "DebugSnapshots", path.basename(result.snapshot.uri)), "utf8"));
  assert.equal(snapshot.stageName, "api.request.handle");
  assert.equal(snapshot.debugPayload.statusCode, 400);
  assert.equal(snapshot.debugPayload.pathname, "/api/debug/ui-events");
  assert.equal(snapshot.debugPayload.retryable, false);
});
