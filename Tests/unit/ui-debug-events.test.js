const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");
const { ingestUiDebugEvent, normalizeUiEvent } = require("../../Apps/Api/lib/ui-debug-events");

function createTestStore(runtimeRoot) {
  return {
    runtimeRoot,
    async writeJson(filePath, value) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
    },
    runtimeUri(filePath) {
      return `/runtime/${path.relative(runtimeRoot, filePath).split(path.sep).join("/")}`;
    },
  };
}

test("ingests frontend UI events into uiTrace jsonl and debug snapshots", async () => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-ui-debug-"));
  const logger = createStageLogger(createTestStore(runtimeRoot));
  const base = {
    uiTraceId: "uiTrace_test",
    runId: "run_test",
    stageId: "stage_test",
    stageName: "audio.waveform.decode",
    artifactId: "artifact_audio",
    parentArtifactId: "artifact_parent",
  };

  await ingestUiDebugEvent(logger, { ...base, event: "stage.start", inputSummary: { source: "audio-track" } });
  const result = await ingestUiDebugEvent(logger, {
    ...base,
    event: "stage.fail",
    errorSummary: { code: "audio_decode_failed", message: "音频解码失败", retryable: true },
    debugPayload: { fallbackReason: "audio_worker_failed", rawUrl: "http://127.0.0.1/runtime/audio.m4a" },
  });

  assert.equal(result.ok, true);
  assert.match(result.debugSnapshotUri, /^\/runtime\/DebugSnapshots\/snapshot_stage_test\.json$/);
  const log = await fs.readFile(path.join(runtimeRoot, "DebugSnapshots", "uiTrace_test.log.jsonl"), "utf8");
  assert.match(log, /"trace":"uiTrace_test"/);
  assert.match(log, /"e":"f"/);
  const snapshot = JSON.parse(await fs.readFile(path.join(runtimeRoot, "DebugSnapshots", "snapshot_stage_test.json"), "utf8"));
  assert.equal(snapshot.traceId, "uiTrace_test");
  assert.equal(snapshot.debugPayload.rawUrl, "[url]");
});

test("rejects invalid UI trace ids and stage names", () => {
  assert.throws(
    () => normalizeUiEvent({ uiTraceId: "trace_backend", runId: "run_1", stageId: "stage_1", stageName: "audio.waveform.decode", event: "stage.start" }),
    /uiTraceId/,
  );
  assert.throws(
    () => normalizeUiEvent({ uiTraceId: "uiTrace_1", runId: "run_1", stageId: "stage_1", stageName: "audio-waveform", event: "stage.start" }),
    /stageName/,
  );
});
