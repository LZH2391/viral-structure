const test = require("node:test");
const assert = require("node:assert/strict");
const { createTraceContext } = require("../../Core/Workspace/sample-video-contracts");

test("stage output includes required trace fields", () => {
  const trace = createTraceContext({ runId: "run_1", traceId: "trace_1", stageId: "stage_1" });
  const output = { ...trace, artifactId: "artifact_1" };
  for (const key of ["runId", "traceId", "stageId", "artifactId"]) {
    assert.ok(output[key], `${key} is required`);
  }
});
