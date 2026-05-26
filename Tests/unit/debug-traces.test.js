const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { readDebugTraces, readDebugTraceDetail } = require("../../Apps/Api/lib/observability/debug-traces");

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
  await fs.writeFile(
    path.join(dir, "uiTrace_frontend.log.jsonl"),
    [
      JSON.stringify({ event: "stage.start", stageName: "audio.waveform.decode", createdAt: "2026-05-20T00:01:00.000Z" }),
      JSON.stringify({ event: "stage.end", stageName: "audio.waveform.decode", outputSummary: { peakCount: 10 } }),
    ].join("\n"),
    "utf8",
  );

  const result = await readDebugTraces(root);
  assert.equal(result.traces.length, 2);
  const backend = result.traces.find((trace) => trace.traceId === "trace_abc");
  const frontend = result.traces.find((trace) => trace.traceId === "uiTrace_frontend");
  assert.equal(backend.latestEvent, "stage.fail");
  assert.equal(backend.latestStageName, "sample.metadata.probed");
  assert.equal(backend.errorSummary.code, "metadata_probe_failed");
  assert.equal(frontend.latestEvent, "stage.end");
  assert.equal(frontend.latestStageName, "audio.waveform.decode");
  assert.equal(result.traces[0].events, undefined);

  const detail = await readDebugTraceDetail(root, "trace_abc");
  assert.equal(detail.events.length, 2);
  assert.equal(detail.events[1].event, "stage.fail");
  const uiDetail = await readDebugTraceDetail(root, "uiTrace_frontend");
  assert.equal(uiDetail.events[1].event, "stage.end");
});

test("debug page crops long summaries with expandable full payload", () => {
  const root = path.resolve(__dirname, "../..");
  const page = require("fs").readFileSync(path.join(root, "Apps/Workbench/src/components/DebugApp.tsx"), "utf8");
  const css = require("fs").readFileSync(path.join(root, "Apps/Workbench/styles/debug.css"), "utf8");

  assert.match(page, /const SUMMARY_LIMIT = 420/);
  assert.match(page, /function cropText\(text/);
  assert.match(page, /<details>/);
  assert.match(page, /展开完整/);
  assert.match(page, /已裁切/);
  assert.match(css, /\.debug-event-item pre[\s\S]+max-height: 180px/);
  assert.match(css, /\.debug-summary-block details pre[\s\S]+max-height: 320px/);
});

test("debug page crops recent trace list count", () => {
  const root = path.resolve(__dirname, "../..");
  const page = require("fs").readFileSync(path.join(root, "Apps/Workbench/src/components/DebugApp.tsx"), "utf8");
  const css = require("fs").readFileSync(path.join(root, "Apps/Workbench/styles/debug.css"), "utf8");

  assert.match(page, /const TRACE_LIST_LIMIT = 20/);
  assert.match(page, /traces\.slice\(0, TRACE_LIST_LIMIT\)/);
  assert.match(page, /已隐藏更早的/);
  assert.match(page, /\$\{visibleTraces\.length\}\/\$\{traces\.length\} traces/);
  assert.match(css, /\.debug-trace-crop/);
});
