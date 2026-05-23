const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function loadJobPolling() {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/hooks/jobPolling.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require: () => ({}),
    setTimeout,
    clearTimeout,
    Promise,
  });
  return module.exports;
}

const { pollProcessingJob, isSameProcessingJobSnapshot } = loadJobPolling();

test("pollProcessingJob skips repeated equivalent snapshots", async () => {
  const snapshots = [
    { jobId: "job_1", sampleVideoId: "sample_1", traceId: "trace_1", stage: "shot.boundary_analyze.collect", status: "processing", progress: 10 },
    { jobId: "job_1", sampleVideoId: "sample_1", traceId: "trace_1", stage: "shot.boundary_analyze.collect", status: "processing", progress: 10 },
    { jobId: "job_1", sampleVideoId: "sample_1", traceId: "trace_1", stage: "shot.boundary_analyze.collect", status: "processed", progress: 100 },
  ];
  const updates = [];
  let index = 0;

  const result = await pollProcessingJob(
    async () => snapshots[index++] ?? snapshots.at(-1),
    {
      intervalMs: 0,
      onUpdate: (job) => updates.push(job),
    },
  );

  assert.equal(result.status, "processed");
  assert.equal(updates.length, 2);
  assert.equal(updates[0].progress, 10);
  assert.equal(updates[1].progress, 100);
});

test("pollProcessingJob updates when tracked fields change", async () => {
  const updates = [];
  let index = 0;
  const snapshots = [
    { jobId: "job_2", sampleVideoId: "sample_2", traceId: "trace_2", stage: "script_segment.input_prepare", status: "pending", progress: 0 },
    { jobId: "job_2", sampleVideoId: "sample_2", traceId: "trace_2", stage: "script_segment.analyze", status: "processing", progress: 42 },
    { jobId: "job_2", sampleVideoId: "sample_2", traceId: "trace_2", stage: "script_segment.analyze", status: "failed", progress: 42, errorSummary: { code: "analysis_failed", message: "分析失败" } },
  ];

  const result = await pollProcessingJob(
    async () => snapshots[index++] ?? snapshots.at(-1),
    {
      intervalMs: 0,
      onUpdate: (job) => updates.push(job),
    },
  );

  assert.equal(result.status, "failed");
  assert.deepEqual(updates.map((job) => `${job.status}:${job.stage}:${job.progress}`), [
    "pending:script_segment.input_prepare:0",
    "processing:script_segment.analyze:42",
    "failed:script_segment.analyze:42",
  ]);
});

test("pollProcessingJob returns cache_waiting and can stop on null", async () => {
  let cacheIndex = 0;
  const cacheSnapshots = [
    { jobId: "job_3", sampleVideoId: "sample_3", traceId: "trace_3", stage: "rhythm_structure.cache_lookup", status: "processing", progress: 20 },
    { jobId: "job_3", sampleVideoId: "sample_3", traceId: "trace_3", stage: "rhythm_structure.cache_lookup", status: "cache_waiting", progress: 28, cachePrompt: { cachedItem: { sampleVideoId: "sample_3" } } },
  ];
  const cacheResult = await pollProcessingJob(
    async () => cacheSnapshots[cacheIndex++] ?? cacheSnapshots.at(-1),
    { intervalMs: 0 },
  );
  assert.equal(cacheResult.status, "cache_waiting");

  let nullIndex = 0;
  const nullUpdates = [];
  const nullResult = await pollProcessingJob(
    async () => [null, null][nullIndex++] ?? null,
    {
      intervalMs: 0,
      stopOnNull: true,
      onUpdate: (job) => nullUpdates.push(job),
    },
  );
  assert.equal(nullResult, null);
  assert.equal(nullUpdates.length, 0);
});

test("isSameProcessingJobSnapshot compares only normalized fields", () => {
  const left = {
    jobId: "job_4",
    sampleVideoId: "sample_4",
    traceId: "trace_4",
    stage: "shot.thread_acquire",
    status: "processing",
    progress: 55,
    activeThreadMessage: { threadId: "thread_1", turnId: "turn_1", role: "assistant", text: "working", createdAt: "t1" },
  };
  const right = {
    ...left,
    activeThreadMessage: { ...left.activeThreadMessage },
  };
  const changed = {
    ...left,
    activeThreadMessage: { ...left.activeThreadMessage, text: "done" },
  };

  assert.equal(isSameProcessingJobSnapshot(left, right), true);
  assert.equal(isSameProcessingJobSnapshot(left, changed), false);
});
