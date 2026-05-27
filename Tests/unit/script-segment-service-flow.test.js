const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { isNonTerminalTurnStatus } = require("../../Apps/Api/lib/gateways/appserver/bridge");
const { createScriptHarness, waitForJob, waitForJobField } = require("./script-segment-test-helpers");

test("script segment service submits script-segment-analyzer turn through appserver and threadpool", { timeout: 30000 }, async () => {
  const harness = await createScriptHarness({
    appServer: {
      startTurnWithInputs: async (payload) => {
        harness.calls.started.push(payload);
        return { ok: true, threadId: "thread_script_1", turnId: "turn_script_1", status: "submitted" };
      },
      collectTurnResult: async (payload) => {
        harness.calls.collected.push(payload);
        return {
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
        };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_script_1" });
  const job = await waitForJob(harness.jobStore, result.processingJobId, "processed");
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_script_1"), "artifact.json"));

  assert.equal(job.status, "processed");
  assert.equal(harness.calls.acquire.length, 1);
  assert.equal(harness.calls.acquire[0].role, "script-segment-analyzer");
  assert.equal(harness.calls.started.length, 1);
  assert.equal(harness.calls.collected.length, 1);
  assert.equal(artifact.scriptSegmentAnalysis.agent.provider, "codex-appserver");
  assert.equal(artifact.scriptSegmentAnalysis.agent.threadId, "thread_script_1");
  assert.equal(artifact.scriptSegmentAnalysis.agent.leaseId, "lease_script_1");
  assert.equal(artifact.scriptSegmentAnalysis.agent.turnId, "turn_script_1");
  assert.equal(artifact.scriptSegmentAnalysis.agent.promptTemplateVersion, "analyze.v2");
  assert.equal(artifact.scriptSegmentAnalysis.agent.role, "script-segment-analyzer");
  assert.equal(artifact.scriptSegmentAnalysis.segments.length, 2);
  assert.ok(artifact.scriptSegmentAnalysis.inputPackage);
  assert.equal(artifact.scriptSegmentAnalysis.inputPackage.sheetCount, 3);
  assert.equal(artifact.scriptSegmentAnalysis.segments[0].segmentId, "segment_1");
  assert.equal(artifact.scriptSegmentAnalysis.segments[0].start, 0);
  assert.equal(artifact.scriptSegmentAnalysis.segments[0].end, 1.2);
  assert.equal(harness.calls.release.length, 1);
});

test("script segment service keeps collecting submitted turn until completed", { timeout: 30000 }, async () => {
  const harness = await createScriptHarness({
    appServer: {
      startTurnWithInputs: async (payload) => {
        harness.calls.started.push(payload);
        return { ok: true, threadId: "thread_script_1", turnId: "turn_script_1", status: "submitted" };
      },
      collectTurnResult: async (payload) => {
        harness.calls.collected.push(payload);
        if (harness.calls.collected.length === 1) {
          return { ok: false, threadId: "thread_script_1", turnId: "turn_script_1", status: "submitted", finalMessage: "" };
        }
        return {
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
        };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_script_1" });
  const job = await waitForJob(harness.jobStore, result.processingJobId, "processed");
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_script_1"), "artifact.json"));

  assert.equal(job.status, "processed");
  assert.equal(harness.calls.collected.length, 2);
  assert.equal(artifact.scriptSegmentAnalysis.status, "processed");
  assert.equal(artifact.scriptSegmentAnalysis.segments.length, 2);
});

test("script segment service surfaces latest running thread message and clears it on completion", { timeout: 30000 }, async () => {
  let releaseCompletion;
  const completionGate = new Promise((resolve) => {
    releaseCompletion = resolve;
  });
  const harness = await createScriptHarness({
    appServer: {
      startTurnWithInputs: async (payload) => {
        harness.calls.started.push(payload);
        return { ok: true, threadId: "thread_script_1", turnId: "turn_script_1", status: "submitted" };
      },
      collectTurnResult: async (payload) => {
        harness.calls.collected.push(payload);
        if (harness.calls.collected.length === 1) {
          return {
            ok: false,
            threadId: "thread_script_1",
            turnId: "turn_script_1",
            status: "running",
            finalMessage: "",
            activeThreadMessage: "正在整理脚本段落证据",
          };
        }
        await completionGate;
        return {
          ok: true,
          threadId: "thread_script_1",
          turnId: "turn_script_1",
          status: "completed",
          activeThreadMessage: null,
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
                shotRefs: ["shot_2"],
                evidence: ["演示收纳盒摆放和分类"],
                transferableRule: "中段用连续证据证明核心卖点",
                confidence: 0.79,
                needReview: false,
              },
              {
                label: "收束转化",
                roleInScript: "收束结果并提示行动",
                shotRefs: ["shot_3"],
                evidence: ["回到整洁台面并提示点击"],
                transferableRule: "结尾回到结果并给出行动提示",
                confidence: 0.78,
                needReview: false,
              },
            ],
          }),
        };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_script_1" });
  const runningJob = await waitForJobField(harness.jobStore, result.processingJobId, (job) => job.activeThreadMessage?.text === "正在整理脚本段落证据");
  assert.equal(runningJob.agentRun?.threadId, "thread_script_1");
  assert.equal(runningJob.agentRun?.turnId, "turn_script_1");
  assert.equal(runningJob.agentRun?.status, "turn_submitted");
  assert.equal(runningJob.activeThreadMessage?.threadId, runningJob.agentRun?.threadId);
  assert.equal(runningJob.activeThreadMessage?.turnId, runningJob.agentRun?.turnId);
  releaseCompletion();
  const job = await waitForJob(harness.jobStore, result.processingJobId, "processed");

  assert.equal(job.activeThreadMessage, null);
  assert.equal(harness.calls.collected.length, 2);
});

test("script segment collect window fails after idle timeout without progress", { timeout: 30000 }, async () => {
  const harness = await createScriptHarness({
    serviceOptions: { collectIdleTimeoutMs: 20, collectHardTimeoutMs: 1000 },
    appServer: {
      startTurnWithInputs: async (payload) => {
        harness.calls.started.push(payload);
        return { ok: true, threadId: "thread_script_1", turnId: "turn_script_1", status: "submitted" };
      },
      collectTurnResult: async (payload) => {
        harness.calls.collected.push(payload);
        return { ok: false, threadId: "thread_script_1", turnId: "turn_script_1", status: "submitted", finalMessage: "" };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_script_1" });
  const job = await waitForJob(harness.jobStore, result.processingJobId, "failed");
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_script_1"), "artifact.json"));
  const snapshotName = path.basename(job.errorSummary.debugSnapshotUri);
  const snapshot = await harness.store.readJson(path.join(harness.store.runtimeRoot, "DebugSnapshots", snapshotName));

  assert.ok(harness.calls.collected.length >= 2);
  assert.equal(job.errorSummary.code, "appserver_turn_collect_timeout");
  assert.equal(artifact.scriptSegmentAnalysis.validation.validatorCode, "appserver_turn_collect_timeout");
  assert.equal(snapshot.debugPayload.timeoutReason, "idle_timeout");
  assert.equal(snapshot.debugPayload.idleTimeoutMs, 20);
});

test("script segment collect timeout resets when appserver reports progress", { timeout: 30000 }, async () => {
  const harness = await createScriptHarness({
    serviceOptions: { collectIdleTimeoutMs: 20, collectHardTimeoutMs: 1000 },
    appServer: {
      startTurnWithInputs: async (payload) => {
        harness.calls.started.push(payload);
        return { ok: true, threadId: "thread_script_1", turnId: "turn_script_1", status: "submitted" };
      },
      collectTurnResult: async (payload) => {
        harness.calls.collected.push(payload);
        if (harness.calls.collected.length <= 3) {
          return {
            ok: false,
            threadId: "thread_script_1",
            turnId: "turn_script_1",
            status: "running",
            finalMessage: "",
            turnActivity: {
              itemCount: harness.calls.collected.length,
              effectiveItemCount: harness.calls.collected.length,
              latestItemType: "reasoning",
              latestMessagePreview: `progress ${harness.calls.collected.length}`,
            },
          };
        }
        return {
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
        };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_script_1" });
  const job = await waitForJob(harness.jobStore, result.processingJobId, "processed");

  assert.equal(job.status, "processed");
  assert.equal(harness.calls.collected.length, 4);
});

test("appserver bridge treats queued submitted and created as non-terminal statuses", () => {
  assert.equal(isNonTerminalTurnStatus("created"), true);
  assert.equal(isNonTerminalTurnStatus("queued"), true);
  assert.equal(isNonTerminalTurnStatus("submitted"), true);
  assert.equal(isNonTerminalTurnStatus("failed"), false);
});

test("script segment enqueue rejects stale expected shot boundary artifact", { timeout: 30000 }, async () => {
  const harness = await createScriptHarness();

  await assert.rejects(
    harness.service.enqueue({
      sampleVideoId: "sample_script_1",
      expectedShotBoundaryArtifactId: "artifact_previous_shot_boundary",
    }),
    (error) => {
      assert.equal(error.code, "script_segment_shot_boundary_stale");
      assert.equal(error.statusCode, 409);
      return true;
    },
  );
});

test("script segment service repairs invalid output and preserves same thread", { timeout: 30000 }, async () => {
  const harness = await createScriptHarness({
    appServer: {
      startTurnWithInputs: async (payload) => {
        harness.calls.started.push(payload);
        return { ok: true, threadId: "thread_script_1", turnId: `turn_script_${harness.calls.started.length}`, status: "submitted" };
      },
      collectTurnResult: async () => {
        if (harness.calls.collected.length === 0) {
          harness.calls.collected.push({ turnId: "turn_script_1" });
          return {
            ok: true,
            threadId: "thread_script_1",
            turnId: "turn_script_1",
            status: "completed",
            finalMessage: JSON.stringify({
              segments: [
                {
                  label: "错误段落",
                  roleInScript: "未覆盖完整镜头",
                  shotRefs: ["shot_2"],
                  evidence: ["演示收纳盒摆放和分类"],
                  transferableRule: "错误示例",
                  confidence: 0.5,
                  needReview: true,
                },
              ],
            }),
          };
        }
        harness.calls.collected.push({ turnId: "turn_script_2" });
        return {
          ok: true,
          threadId: "thread_script_1",
          turnId: "turn_script_2",
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
        };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_script_1" });
  await waitForJob(harness.jobStore, result.processingJobId, "processed");
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_script_1"), "artifact.json"));

  assert.equal(harness.calls.started.length, 2);
  assert.equal(artifact.scriptSegmentAnalysis.validation.repairAttemptCount, 1);
  assert.equal(artifact.scriptSegmentAnalysis.agent.threadId, "thread_script_1");
  assert.equal(artifact.scriptSegmentAnalysis.agent.turnId, "turn_script_2");
  assert.equal(artifact.scriptSegmentAnalysis.agent.promptTemplateVersion, "repair.v2");
});
