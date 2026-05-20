const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { readDebugTraces, readDebugTraceDetail } = require("../../Apps/Api/lib/debug-traces");

test("reads trace jsonl files for the debug page", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-debug-"));
  const dir = path.join(root, "DebugSnapshots");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "trace_abc.log.jsonl"),
    [
      JSON.stringify({ event: "stage.start", stageName: "sample.upload.received", createdAt: "2026-05-20T00:00:00.000Z" }),
      JSON.stringify({ event: "stage.fail", stageName: "sample.metadata.probed", errorSummary: { code: "metadata_probe_failed" } }),
    ].join("\n"),
    "utf8",
  );

  const result = await readDebugTraces(root);
  assert.equal(result.traces.length, 1);
  assert.equal(result.traces[0].traceId, "trace_abc");
  assert.equal(result.traces[0].latestEvent, "stage.fail");
  assert.equal(result.traces[0].latestStageName, "sample.metadata.probed");
  assert.equal(result.traces[0].errorSummary.code, "metadata_probe_failed");
  assert.equal(result.traces[0].events, undefined);

  const detail = await readDebugTraceDetail(root, "trace_abc");
  assert.equal(detail.events.length, 2);
  assert.equal(detail.events[1].event, "stage.fail");
});
