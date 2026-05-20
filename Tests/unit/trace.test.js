const test = require("node:test");
const assert = require("node:assert/strict");
const { createTraceIds, nextStage } = require("../../Infrastructure/Observability/trace");

test("creates and carries trace fields", () => {
  const trace = createTraceIds();
  assert.ok(trace.runId.startsWith("run_"));
  assert.ok(trace.traceId.startsWith("trace_"));
  assert.ok(trace.stageId.startsWith("stage_"));
  const next = nextStage(trace);
  assert.equal(next.runId, trace.runId);
  assert.equal(next.traceId, trace.traceId);
  assert.notEqual(next.stageId, trace.stageId);
});
