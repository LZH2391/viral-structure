const test = require("node:test");
const assert = require("node:assert/strict");
const { createTraceResolver } = require("../../Apps/Api/lib/platform/trace-resolver");

test("trace resolver returns safe platform trace detail", async () => {
  const resolver = createTraceResolver({
    runtimeRoot: "Runtime",
    readDebugTraceDetailImpl: async (runtimeRoot, traceId) => {
      assert.equal(runtimeRoot, "Runtime");
      assert.equal(traceId, "trace_1");
      return {
        traceId,
        logUri: "/runtime/DebugSnapshots/trace_1.log.jsonl",
        updatedAt: "2026-06-01T00:00:00.000Z",
        latestEvent: "stage.fail",
        latestStageName: "script.segment.analyze",
        errorSummary: {
          code: "script_failed",
          message: "failed at C:\\secret\\input.mp4",
          stageName: "script.segment.analyze",
          retryable: true,
          debugSnapshotUri: "/runtime/DebugSnapshots/snapshot_1.json",
        },
        events: [{
          event: "stage.start",
          runId: "run_1",
          traceId,
          stageId: "stage_1",
          stageName: "script.segment.analyze",
          artifactId: "artifact_1",
          parentArtifactId: "artifact_parent",
          inputSummary: {
            sourcePath: "C:\\secret\\input.mp4",
            fullPrompt: { nested: "do not leak full object" },
            frames: [{ id: 1 }, { id: 2 }],
          },
          createdAt: "2026-06-01T00:00:00.000Z",
        }, {
          event: "stage.fail",
          runId: "run_1",
          traceId,
          stageId: "stage_1",
          stageName: "script.segment.analyze",
          artifactId: "artifact_1",
          parentArtifactId: "artifact_parent",
          errorSummary: {
            code: "script_failed",
            message: "failed at C:\\secret\\input.mp4",
            retryable: true,
            debugSnapshotUri: "/runtime/DebugSnapshots/snapshot_1.json",
          },
          createdAt: "2026-06-01T00:00:01.000Z",
        }],
      };
    },
  });

  const detail = await resolver.read({ traceId: "trace_1" });

  assert.equal(detail.schemaVersion, "platform_trace_detail.v1");
  assert.equal(detail.traceId, "trace_1");
  assert.equal(detail.status, "failed");
  assert.equal(detail.eventCount, 2);
  assert.equal(detail.errorSummary.message, "failed at [local-path]");
  assert.equal(detail.stages[0].inputSummary.sourcePath, "[local-path]");
  assert.deepEqual(detail.stages[0].inputSummary.frames, { type: "array", count: 2 });
  assert.deepEqual(detail.stages[0].inputSummary.fullPrompt, { type: "object", keys: ["nested"] });
  assert.equal(JSON.stringify(detail).includes("C:\\secret"), false);
});

test("trace resolver rejects invalid trace ids", async () => {
  const resolver = createTraceResolver({
    readDebugTraceDetailImpl: async () => {
      throw new Error("should not read invalid trace id");
    },
  });

  assert.equal(await resolver.read({ traceId: "../trace_1" }), null);
});
