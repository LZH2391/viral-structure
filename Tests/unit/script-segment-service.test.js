const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { createJobStore } = require("../../Apps/Api/lib/job-store");
const { isNonTerminalTurnStatus } = require("../../Apps/Api/lib/appserver-bridge");
const { createScriptSegmentService, STAGES, prepareInput } = require("../../Apps/Api/lib/script-segment-service");
const {
  prepareInputPackage,
  renderAnalyzeTurnInputs,
  frameBelongsToShot,
} = require("../../Apps/Api/lib/script-segment-analysis/input");
const { createArtifactCacheParamBuilders } = require("../../Apps/Api/lib/artifact-cache-param-builders");
const { loadRoleProfileByRole } = require("../../Apps/Api/lib/role-profile-loader");
const { createArtifactIndex, hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger, expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");

test("prepareInput requires processed shot boundary shots", () => {
  assert.throws(() => prepareInput(createArtifact({ shotBoundaryAnalysis: null })), /可分析的切镜结果/);
});

test("script segment analyze turn uses file paths plus localImage inputs", async () => {
  const artifact = createArtifact();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-script-segment-input-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  await store.ensureSampleDirs(artifact.sampleVideoId);
  await seedFrameFiles(store, artifact);
  const prepared = prepareInput(artifact, { runtimeRoot: store.runtimeRoot });
  const inputPackage = await prepareInputPackage({
    input: prepared,
    sampleDir: store.sampleDir(artifact.sampleVideoId),
    store,
  });
  const roleProfile = await loadRoleProfileByRole("script-segment-analyzer");
  const turnInputs = renderAnalyzeTurnInputs({ input: prepared, inputPackage, roleProfile });
  const promptText = turnInputs.inputs[0].text;
  const imageItems = turnInputs.inputs.filter((item) => item.type === "localImage");

  assert.match(promptText, /manifestPath/);
  assert.match(promptText, /outputContractPath/);
  assert.match(promptText, /visualManifestPath/);
  assert.match(promptText, /本次包含 3 个镜头/);
  assert.match(promptText, /subtitleContextText/);
  assert.doesNotMatch(promptText, /"shots":\[/);
  assert.doesNotMatch(promptText, /"segments":\[/);
  assert.equal(imageItems.length, inputPackage.visualManifest.sheetCount);
  assert.equal("sampleVideoId" in inputPackage.manifest, false);
  assert.equal("parentArtifactId" in inputPackage.manifest, false);
  assert.equal("sampleVideoId" in inputPackage.lineage, true);
  assert.equal("parentArtifactId" in inputPackage.lineage, true);
  assert.match(JSON.stringify(inputPackage.outputContract), /模型无需返回这些字段/);
});

test("prepareInput aligns shot subtitles by words while preserving segment punctuation", () => {
  const artifact = createArtifact({
    subtitles: {
      artifactId: "artifact_subtitle",
      parentArtifactId: "artifact_audio",
      type: "subtitle-track",
      status: "processed",
      segments: [
        { id: "subtitle_1", start: 0.98, end: 3, text: "一整句跨镜头，", confidence: null },
      ],
      utterances: [
        {
          start: 0.98,
          end: 3,
          text: "一整句跨镜头字幕。",
          definite: true,
          words: [
            { start: 0.98, end: 1.02, text: "一" },
            { start: 1.02, end: 1.2, text: "整" },
            { start: 1.2, end: 1.5, text: "句" },
            { start: 1.5, end: 2.1, text: "跨" },
            { start: 2.1, end: 2.6, text: "镜" },
            { start: 2.6, end: 3, text: "头" },
          ],
        },
      ],
      words: [
        { start: 0.98, end: 1.02, text: "一" },
        { start: 1.02, end: 1.2, text: "整" },
        { start: 1.2, end: 1.5, text: "句" },
        { start: 1.5, end: 2.1, text: "跨" },
        { start: 2.1, end: 2.6, text: "镜" },
        { start: 2.6, end: 3, text: "头" },
      ],
    },
    shotBoundaryAnalysis: {
      artifactId: "artifact_shot_boundary",
      parentArtifactId: "artifact_sample",
      type: "shot-boundary-analysis",
      status: "processed",
      shots: [
        { id: "shot_1", shotNo: "S001", start: 0, end: 1, reason: "开场", summary: "开场镜头" },
        { id: "shot_2", shotNo: "S002", start: 1, end: 3, reason: "主体", summary: "主体镜头" },
      ],
      commerceBrief: null,
    },
  });

  const prepared = prepareInput(artifact);

  assert.equal(prepared.shots[0].subtitleText, "一");
  assert.equal(prepared.shots[1].subtitleText, "整句跨镜头，");
  assert.equal(prepared.shots[0].subtitleContextText, "一整句跨镜头字幕。");
  assert.equal(prepared.shots[1].subtitleContextText, "一整句跨镜头字幕。");
});

test("prepareInput falls back to word text when segment text cannot align", () => {
  const artifact = createArtifact({
    subtitles: {
      artifactId: "artifact_subtitle",
      parentArtifactId: "artifact_audio",
      type: "subtitle-track",
      status: "processed",
      segments: [
        { id: "subtitle_1", start: 0, end: 2, text: "完全不匹配，", confidence: null },
      ],
      utterances: [],
      words: [
        { start: 0, end: 0.6, text: "原" },
        { start: 1.05, end: 1.4, text: "词" },
      ],
    },
    shotBoundaryAnalysis: {
      artifactId: "artifact_shot_boundary",
      parentArtifactId: "artifact_sample",
      type: "shot-boundary-analysis",
      status: "processed",
      shots: [
        { id: "shot_1", shotNo: "S001", start: 0, end: 1, reason: "开场", summary: "开场镜头" },
        { id: "shot_2", shotNo: "S002", start: 1, end: 2, reason: "主体", summary: "主体镜头" },
      ],
      commerceBrief: null,
    },
  });

  const prepared = prepareInput(artifact);

  assert.equal(prepared.shots[0].subtitleText, "原");
  assert.equal(prepared.shots[1].subtitleText, "词");
});

test("prepareInput copies source subtitle punctuation without punctuation allowlist", () => {
  const artifact = createArtifact({
    subtitles: {
      artifactId: "artifact_subtitle",
      parentArtifactId: "artifact_audio",
      type: "subtitle-track",
      status: "processed",
      segments: [
        { id: "subtitle_1", start: 0, end: 2, text: "“真的吗？好！”", confidence: null },
      ],
      utterances: [],
      words: [
        { start: 0, end: 0.9, text: "真的吗" },
        { start: 1.05, end: 1.6, text: "好" },
      ],
    },
    shotBoundaryAnalysis: {
      artifactId: "artifact_shot_boundary",
      parentArtifactId: "artifact_sample",
      type: "shot-boundary-analysis",
      status: "processed",
      shots: [
        { id: "shot_1", shotNo: "S001", start: 0, end: 1, reason: "开场", summary: "开场镜头" },
        { id: "shot_2", shotNo: "S002", start: 1, end: 2, reason: "主体", summary: "主体镜头" },
      ],
      commerceBrief: null,
    },
  });

  const prepared = prepareInput(artifact);

  assert.equal(prepared.shots[0].subtitleText, "“真的吗？");
  assert.equal(prepared.shots[1].subtitleText, "好！”");
});

test("script segment frame ownership keeps half-open ranges and last shot closed", () => {
  const shot1 = { shotId: "shot_1", start: 0, end: 1.2 };
  const shot2 = { shotId: "shot_2", start: 1.2, end: 3.8 };
  const shot3 = { shotId: "shot_3", start: 3.8, end: 6 };

  assert.equal(frameBelongsToShot({ timestamp: 1.2 }, shot1, false), false);
  assert.equal(frameBelongsToShot({ timestamp: 1.2 }, shot2, false), true);
  assert.equal(frameBelongsToShot({ timestamp: 3.8 }, shot2, false), false);
  assert.equal(frameBelongsToShot({ timestamp: 3.8 }, shot3, true), true);
  assert.equal(frameBelongsToShot({ timestamp: 6 }, shot3, true), true);
});

test("script segment input package records empty shots without failing", async () => {
  const artifact = createArtifact();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-script-segment-empty-shot-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  await store.ensureSampleDirs(artifact.sampleVideoId);
  artifact.frames = [
    { frameId: "frame_1", artifactId: "artifact_frame_1", parentArtifactId: "artifact_sample", timestamp: 0, imageUri: "/runtime/Artifacts/sample_script_1/frames/frame-1.jpg" },
  ];
  await seedFrameFiles(store, artifact);
  const prepared = prepareInput(artifact, { runtimeRoot: store.runtimeRoot });
  const inputPackage = await prepareInputPackage({
    input: prepared,
    sampleDir: store.sampleDir(artifact.sampleVideoId),
    store,
  });

  assert.equal(inputPackage.emptyShotCount, 2);
  assert.equal(inputPackage.visualManifest.shots.filter((shot) => shot.empty).length, 2);
  assert.equal(inputPackage.visualManifest.sheetCount, 1);
});

test("script segment service submits script-segment-analyzer turn through appserver and threadpool", async () => {
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

test("script segment service keeps collecting submitted turn until completed", async () => {
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

test("script segment service surfaces latest running thread message and clears it on completion", async () => {
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

test("script segment collect window waits three minutes worth of attempts", async () => {
  const harness = await createScriptHarness({
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

  assert.equal(harness.calls.collected.length, 120);
  assert.equal(job.errorSummary.code, "appserver_turn_collect_timeout");
  assert.equal(artifact.scriptSegmentAnalysis.validation.validatorCode, "appserver_turn_collect_timeout");
});

test("appserver bridge treats queued submitted and created as non-terminal statuses", () => {
  assert.equal(isNonTerminalTurnStatus("created"), true);
  assert.equal(isNonTerminalTurnStatus("queued"), true);
  assert.equal(isNonTerminalTurnStatus("submitted"), true);
  assert.equal(isNonTerminalTurnStatus("failed"), false);
});

test("script segment enqueue rejects stale expected shot boundary artifact", async () => {
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

test("script segment service repairs invalid output and preserves same thread", async () => {
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

test("script segment service writes artifact index entry and stage logs", async () => {
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

test("script segment service cache reuse creates current artifact with lineage and history", async () => {
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

async function createScriptHarness({ appServer = {} } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-script-segment-agent-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1", cacheParamBuilders: createArtifactCacheParamBuilders() });
  const artifact = createArtifact();
  await store.ensureSampleDirs(artifact.sampleVideoId);
  await seedFrameFiles(store, artifact);
  await store.writeJson(path.join(store.sampleDir(artifact.sampleVideoId), "artifact.json"), artifact);
  await artifactIndex.registerSampleArtifact({ artifact, fileHash: hashBuffer(Buffer.from("script-segment-video")), traceId: "trace_source" });

  const calls = { acquire: [], started: [], collected: [], release: [] };
  const threadPool = {
    ensureRoleReady: async (role) => ({ ok: true, role, status: { role, canAcquire: true, readyForLeases: true, warming: false, warmupError: null, startupError: null } }),
    acquireLease: async (payload) => {
      calls.acquire.push(payload);
      return { lease_id: "lease_script_1", thread_id: "thread_script_1" };
    },
    releaseLease: async (payload) => {
      calls.release.push(payload);
      return { ok: true };
    },
    discardThread: async () => ({ ok: true }),
    releaseOwnerLeases: async () => ({ ok: true }),
  };
  const bridge = {
    startTurnWithInputs: async (...args) => appServer.startTurnWithInputs(...args),
    collectTurnResult: async (...args) => appServer.collectTurnResult(...args),
  };

  const service = createScriptSegmentService({
    rootDir: tempRoot,
    store,
    logger,
    jobStore,
    artifactIndex,
    threadPool,
    appServer: bridge,
    pollIntervalMs: 1,
  });
  return { store, logger, jobStore, artifactIndex, service, calls };
}

async function seedFrameFiles(store, artifact) {
  const framesDir = path.join(store.sampleDir(artifact.sampleVideoId), "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const pixel = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: "#ffffff",
    },
  }).jpeg().toBuffer();
  for (let index = 0; index < (artifact.frames?.length ?? 0); index += 1) {
    const filePath = path.join(framesDir, `frame-${index + 1}.jpg`);
    await fs.writeFile(filePath, pixel);
    artifact.frames[index].imageUri = store.runtimeUri(filePath);
  }
}

function createArtifact(overrides = {}) {
  return {
    sampleVideoId: "sample_script_1",
    workspaceId: "workspace_1",
    status: "processed",
    trace: { runId: "run_source", traceId: "trace_source", stageId: "stage_source" },
    processingOptions: { frameSampleRateFps: 3 },
    sampleVideo: {
      artifactId: "artifact_sample",
      parentArtifactId: null,
      original: { artifactId: "artifact_original", parentArtifactId: null, type: "original-video", uri: "/runtime/source.mp4", summary: "sample.mp4" },
      normalized: { artifactId: "artifact_normalized", parentArtifactId: "artifact_sample", type: "normalized-video", uri: "/runtime/source.mp4", summary: "标准化视频" },
    },
    cover: { artifactId: "artifact_cover", parentArtifactId: "artifact_sample", type: "cover-frame", uri: "/runtime/cover.jpg", summary: "封面帧" },
    frames: [
      { frameId: "frame_1", artifactId: "artifact_frame_1", parentArtifactId: "artifact_sample", timestamp: 0, imageUri: "/runtime/frame-1.jpg" },
      { frameId: "frame_2", artifactId: "artifact_frame_2", parentArtifactId: "artifact_sample", timestamp: 1.2, imageUri: "/runtime/frame-2.jpg" },
      { frameId: "frame_3", artifactId: "artifact_frame_3", parentArtifactId: "artifact_sample", timestamp: 3.8, imageUri: "/runtime/frame-3.jpg" },
    ],
    audio: { artifactId: "artifact_audio", parentArtifactId: "artifact_sample", type: "audio-track", uri: "/runtime/audio.m4a", summary: "音频轨" },
    subtitles: overrides.subtitles === undefined ? null : overrides.subtitles,
    shotBoundaryAnalysis: overrides.shotBoundaryAnalysis === undefined ? {
      artifactId: "artifact_shot_boundary",
      parentArtifactId: "artifact_sample",
      type: "shot-boundary-analysis",
      status: "processed",
      resultOrigin: "new_turn",
      sourceFrameArtifactIds: ["artifact_frame_1", "artifact_frame_2", "artifact_frame_3"],
      extractSampling: {
        requestedFps: 3,
        targetFrameCount: 18,
        actualFrameCount: 18,
        maxFrames: 6000,
        samplingPolicy: "fixed_interval_from_zero",
        cappedByMaxFrames: false,
      },
      analysisSampling: {
        fps: 1,
        requestedFps: 1,
        targetFrameCount: 6,
        selectedFrameCount: 6,
        effectiveFps: 1,
        selectionPolicy: "target_grid_nearest_unique",
        duplicatePolicy: "nearest_unselected_tie_later",
        roundingPolicy: "target_grid_nearest_unique",
      },
      commerceBrief: {
        sellingObject: "厨房收纳好物",
        proofApproach: "实拍对比和使用演示",
        promisedOutcome: "减少台面杂乱",
        persuasionTarget: "想快速整理厨房的人",
        conversionAction: "点开橱窗了解",
        uncertainties: ["品牌信息未完全确认"],
      },
      validation: {
        status: "passed",
        rawBoundaryCount: 2,
        normalizedBoundaryCount: 2,
        repairAttemptCount: 0,
        validatorCode: null,
      },
      agent: {
        provider: "codex-appserver",
        role: "shot-boundary-raw-analyze-legacy",
        skillPath: "C:/ByteDanceFullStack/.agents/skills/shot-boundary-raw-analyze-legacy/SKILL.md",
        skillHash: "skill_hash_shot",
        threadId: "thread_shot_1",
        leaseId: "lease_shot_1",
        turnId: "turn_shot_1",
      },
      shots: [
        { id: "shot_1", index: 0, shotNo: "S001", start: 0, end: 1.2, representativeFrameId: "frame_1", confidence: 0.83, reason: "开场结果", summary: "展示整理前后反差", endBoundaryReason: "cut" },
        { id: "shot_2", index: 1, shotNo: "S002", start: 1.2, end: 3.8, representativeFrameId: "frame_2", confidence: 0.79, reason: "使用演示", summary: "演示收纳盒摆放和分类", endBoundaryReason: "cut" },
        { id: "shot_3", index: 2, shotNo: "S003", start: 3.8, end: 6, representativeFrameId: "frame_3", confidence: 0.77, reason: "收束转化", summary: "回到整洁台面并提示点击", endBoundaryReason: null },
      ],
      createdAt: new Date().toISOString(),
    } : overrides.shotBoundaryAnalysis,
    metadata: { durationSeconds: 6, width: 720, height: 1280 },
  };
}

async function waitForJob(jobStore, jobId, status) {
  let lastJob = null;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const job = jobStore.getJob(jobId);
    lastJob = job;
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not reach ${status}: ${JSON.stringify(lastJob)}`);
}

async function waitForJobField(jobStore, jobId, predicate) {
  let lastJob = null;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const job = jobStore.getJob(jobId);
    lastJob = job;
    if (job && predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not match predicate: ${JSON.stringify(lastJob)}`);
}
