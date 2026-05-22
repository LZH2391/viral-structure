const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createJobStore } = require("../../Apps/Api/lib/job-store");
const { createScriptSegmentService, STAGES, prepareInput } = require("../../Apps/Api/lib/script-segment-service");
const { createArtifactIndex, hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger, expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");

test("prepareInput requires processed shot boundary shots", () => {
  assert.throws(() => prepareInput(createArtifact({ shotBoundaryAnalysis: null })), /可分析的切镜结果/);
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
  assert.equal(artifact.scriptSegmentAnalysis.agent.promptTemplateVersion, "analyze.v1");
  assert.equal(artifact.scriptSegmentAnalysis.agent.role, "script-segment-analyzer");
  assert.equal(artifact.scriptSegmentAnalysis.segments.length, 2);
  assert.equal(harness.calls.release.length, 1);
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
  assert.equal(artifact.scriptSegmentAnalysis.agent.promptTemplateVersion, "repair.v1");
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
  assert.equal(logs.some((line) => line.stageName === STAGES.materialized && line.event === "stage.end"), true);
});

async function createScriptHarness({ appServer = {} } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-script-segment-agent-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1" });
  const artifact = createArtifact();
  await store.ensureSampleDirs(artifact.sampleVideoId);
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
    subtitles: null,
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
        stride: null,
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
        role: "shot-boundary-analyzer",
        skillPath: "C:/ByteDanceFullStack/.agents/skills/shot-boundary-analyzer/SKILL.md",
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = jobStore.getJob(jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${jobId} did not reach ${status}`);
}
