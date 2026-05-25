const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { STAGES } = require("../../Apps/Api/lib/script-segment-service");
const { expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");
const { createScriptHarness, waitForJob } = require("./script-segment-test-helpers");

test("script segment service writes artifact index entry and stage logs", { timeout: 30000 }, async () => {
  const harness = await createScriptHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_script_1", turnId: "turn_script_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_script_1",
        turnId: "turn_script_1",
        status: "completed",
        finalMessage: JSON.stringify({
          segments: [
            {
              label: "开场引题",
              roleInScript: "先抛出结果建立停留理由",
              shotRefs: ["shot_1"],
              evidence: ["展示整理前后反差"],
              transferableRule: "先亮结果再展开解释",
              confidence: 0.81,
              needReview: false,
            },
            {
              label: "卖点证明",
              roleInScript: "用连续镜头解释产品价值",
              shotRefs: ["shot_2", "shot_3"],
              evidence: ["演示收纳盒摆放和分类", "回到整洁台面并提示点击"],
              transferableRule: "中段用连续证据证明核心卖点",
              confidence: 0.79,
              needReview: false,
            },
          ],
        }),
      }),
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_script_1" });
  await waitForJob(harness.jobStore, result.processingJobId, "processed");
  const detail = await harness.artifactIndex.getItem("sample_script_1");
  const node = detail.artifactTree.find((entry) => entry.stageName === "script_segment.materialize");
  const logText = await fs.readFile(path.join(harness.store.runtimeRoot, "DebugSnapshots", `${result.traceId}.log.jsonl`), "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));

  assert.ok(node);
  assert.equal(detail.tags.includes("结构理解"), true);
  assert.equal(logs.some((line) => line.stageName === STAGES.analyzed && line.event === "stage.end"), true);
  assert.equal(logs.some((line) => line.stageName === STAGES.inputPackaged && line.event === "stage.end"), true);
  assert.equal(logs.some((line) => line.stageName === STAGES.materialized && line.event === "stage.end"), true);
});

test("script segment service cache reuse creates current artifact with lineage and history", { timeout: 30000 }, async () => {
  const harness = await createScriptHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_script_1", turnId: "turn_script_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_script_1",
        turnId: "turn_script_1",
        status: "completed",
        finalMessage: JSON.stringify({
          segments: [
            {
              label: "开场引题",
              roleInScript: "先抛出结果建立停留理由",
              shotRefs: ["shot_1"],
              evidence: ["展示整理前后反差"],
              transferableRule: "先亮结果再展开解释",
              confidence: 0.81,
              needReview: false,
            },
            {
              label: "卖点证明",
              roleInScript: "用连续镜头解释产品价值",
              shotRefs: ["shot_2", "shot_3"],
              evidence: ["演示收纳盒摆放和分类", "回到整洁台面并提示点击"],
              transferableRule: "中段用连续证据证明核心卖点",
              confidence: 0.79,
              needReview: false,
            },
          ],
        }),
      }),
    },
  });

  const first = await harness.service.enqueue({ sampleVideoId: "sample_script_1" });
  await waitForJob(harness.jobStore, first.processingJobId, "processed");

  const second = await harness.service.enqueue({ sampleVideoId: "sample_script_1" });
  const waitingJob = await waitForJob(harness.jobStore, second.processingJobId, "cache_waiting");
  assert.equal(waitingJob.cachePrompt?.cacheKind, "script_segment");
  await harness.service.resolveCacheDecision({ jobId: second.processingJobId, decision: "reuse" });
  await waitForJob(harness.jobStore, second.processingJobId, "processed");

  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_script_1"), "artifact.json"));
  assert.equal(artifact.scriptSegmentAnalysis.resultOrigin, "cache_reuse");
  assert.equal(artifact.scriptSegmentAnalysis.parentArtifactId, "artifact_shot_boundary");
  assert.equal(artifact.scriptSegmentAnalysis.sourceSampleVideoId, "sample_script_1");
  assert.equal(artifact.scriptSegmentAnalysis.sourceScriptSegmentArtifactId, artifact.scriptSegmentAnalysisHistory.at(-2).artifactId);
  assert.equal(artifact.scriptSegmentAnalysisHistory.at(-1).resultOrigin, "cache_reuse");
  assert.equal(artifact.scriptSegmentAnalysisHistory.at(-1).cacheKey, artifact.scriptSegmentAnalysis.cacheKey);
});
