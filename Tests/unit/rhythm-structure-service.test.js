const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createJobStore } = require("../../Apps/Api/lib/job-store");
const contactSheetGenerator = require("../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { createRhythmStructureService, STAGES, prepareInput } = require("../../Apps/Api/lib/rhythm-structure-service");
const { prepareInputPackage, renderAnalyzeTurnInputs } = require("../../Apps/Api/lib/rhythm-structure-analysis/input");
const { createArtifactCacheParamBuilders } = require("../../Apps/Api/lib/artifact-cache-param-builders");
const { loadRoleProfileByRole } = require("../../Apps/Api/lib/role-profile-loader");
const { createArtifactIndex, hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger, expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");

contactSheetGenerator.generateContactSheets = async ({ frames, sampleDir, parentArtifactId, sheetPurpose, buildSheetId }) => {
  if (!frames.length) return [];
  return [{
    artifactId: `artifact_${sheetPurpose}_${buildSheetId({ sheetIndex: 0 })}`,
    parentArtifactId,
    type: "contact_sheet",
    artifactType: "contact_sheet",
    status: "processed",
    sheetPurpose,
    sheetId: buildSheetId({ sheetIndex: 0 }),
    sheetIndex: 0,
    frameCount: frames.length,
    localImagePath: path.join(sampleDir, "sheets", `${buildSheetId({ sheetIndex: 0 })}.jpg`),
    uri: `/runtime/${buildSheetId({ sheetIndex: 0 })}.jpg`,
    gridItems: frames.map((frame, index) => ({
      frameId: frame.frameId,
      artifactId: frame.artifactId,
      parentArtifactId: frame.parentArtifactId,
      timestamp: frame.timestamp,
      row: 0,
      col: index,
      displayFrameLabel: `${frame.shotNo} ${Number(frame.timestamp ?? 0).toFixed(3)}s`,
    })),
  }];
};

test("rhythm input uses shots, subtitles and localImage sheets without script or audio fields", async () => {
  const artifact = createArtifact();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-rhythm-input-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  await store.ensureSampleDirs(artifact.sampleVideoId);

  const input = prepareInput(artifact, { runtimeRoot: store.runtimeRoot });
  const inputPackage = await prepareInputPackage({
    input,
    sampleDir: store.sampleDir(artifact.sampleVideoId),
    store,
  });
  const roleProfile = await loadRoleProfileByRole("rhythm-structure-analyzer");
  const turnInputs = renderAnalyzeTurnInputs({ input, inputPackage, roleProfile });
  const promptText = turnInputs.inputs[0].text;
  const manifestText = JSON.stringify(inputPackage.manifest);

  assert.equal(Object.hasOwn(input, "scriptSegments"), false);
  assert.equal(Object.hasOwn(inputPackage.manifest, "scriptSegmentCount"), false);
  assert.equal(turnInputs.inputs.filter((item) => item.type === "localImage").length, inputPackage.visualManifest.sheetCount);
  assert.equal(inputPackage.visualAttachments.length, inputPackage.visualManifest.sheetCount);
  assert.equal("localImagePath" in inputPackage.visualManifest.sheets[0], false);
  assert.equal("uri" in inputPackage.visualManifest.sheets[0], false);
  assert.equal("displayLabel" in inputPackage.visualManifest.sheets[0].cells[0], false);
  assert.equal("frameId" in inputPackage.visualManifest.sheets[0].cells[0], false);
  assert.equal("pageCount" in inputPackage.visualManifest.sheets[0], false);
  assert.equal("frameCount" in inputPackage.visualManifest.sheets[0], false);
  assert.equal(inputPackage.visualManifest.sheets[0].attachmentIndex, 0);
  assert.equal(typeof inputPackage.visualManifest.sheets[0].timeRange.start, "number");
  assert.equal(Array.isArray(inputPackage.visualManifest.shotSheets), true);
  assert.equal("shots" in inputPackage.visualManifest, false);
  assert.match(promptText, /manifestPath/);
  assert.match(promptText, /visualManifestPath/);
  assert.match(promptText, /outputContractPath/);
  assert.doesNotMatch(promptText, /脚本段落背景/);
  assert.match(manifestText, /subtitleText/);
  assert.match(manifestText, /endBoundaryReason/);
  assert.doesNotMatch(manifestText, /scriptSegments/);
  assert.doesNotMatch(promptText, /audioFeatures/);
  assert.doesNotMatch(manifestText, /audioFeatures/);
  assert.doesNotMatch(manifestText, /commerceBrief/);
});

test("rhythm service writes overview sections, artifact history, cache entry and trace logs", async () => {
  const harness = await createRhythmHarness({
    appServer: {
      startTurnWithInputs: async (payload) => {
        harness.calls.started.push(payload);
        return { ok: true, threadId: "thread_rhythm_1", turnId: "turn_rhythm_1", status: "submitted" };
      },
      collectTurnResult: async (payload) => {
        harness.calls.collected.push(payload);
        return {
          ok: true,
          threadId: "thread_rhythm_1",
          turnId: "turn_rhythm_1",
          status: "completed",
          finalMessage: JSON.stringify(createRhythmOutput()),
        };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_rhythm_1" });
  const job = await waitForJob(harness.jobStore, result.processingJobId, "processed");
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_rhythm_1"), "artifact.json"));
  const detail = await harness.artifactIndex.getItem("sample_rhythm_1");
  const node = detail.artifactTree.find((entry) => entry.stageName === "rhythm_structure.materialize");
  const logText = await fs.readFile(path.join(harness.store.runtimeRoot, "DebugSnapshots", `${result.traceId}.log.jsonl`), "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));

  assert.equal(job.status, "processed");
  assert.equal(harness.calls.acquire[0].role, "rhythm-structure-analyzer");
  assert.equal(artifact.rhythmStructureAnalysis.agent.role, "rhythm-structure-analyzer");
  assert.equal(artifact.rhythmStructureAnalysis.agent.threadId, "thread_rhythm_1");
  assert.equal(artifact.rhythmStructureAnalysis.agent.turnId, "turn_rhythm_1");
  assert.equal(artifact.rhythmStructureAnalysis.agent.promptTemplateVersion, "analyze.v1");
  assert.equal(artifact.rhythmStructureAnalysis.overview.summary, "开头压缩信息快速抓眼，中段连续推进，末尾回落收束。");
  assert.equal(artifact.rhythmStructureAnalysis.sections.length, 2);
  assert.equal(artifact.rhythmStructureAnalysis.sections[0].sectionId, "rhythm_section_1");
  assert.equal(artifact.rhythmStructureAnalysis.sections[0].fields[0].label, "节奏观察");
  assert.equal(artifact.rhythmStructureAnalysis.sections[0].start, 0);
  assert.equal(artifact.rhythmStructureAnalysis.sections[0].end, 1.2);
  assert.equal(artifact.rhythmStructureAnalysis.validation.sectionCount, 2);
  assert.equal(artifact.rhythmStructureAnalysisHistory.at(-1).sectionCount, 2);
  assert.ok(artifact.rhythmStructureAnalysis.inputPackage);
  assert.ok(node);
  assert.equal(detail.tags.includes("节奏结构"), true);
  assert.equal(logs.some((line) => line.stageName === STAGES.analyzed && line.event === "stage.end"), true);
  assert.equal(logs.some((line) => line.stageName === STAGES.materialized && line.event === "stage.end"), true);
});

test("rhythm service cache reuse creates current artifact with lineage", async () => {
  const harness = await createRhythmHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_rhythm_1", turnId: "turn_rhythm_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: true, threadId: "thread_rhythm_1", turnId: "turn_rhythm_1", status: "completed", finalMessage: JSON.stringify(createRhythmOutput()) }),
    },
  });

  const first = await harness.service.enqueue({ sampleVideoId: "sample_rhythm_1" });
  await waitForJob(harness.jobStore, first.processingJobId, "processed");

  const second = await harness.service.enqueue({ sampleVideoId: "sample_rhythm_1" });
  const waitingJob = await waitForJob(harness.jobStore, second.processingJobId, "cache_waiting");
  assert.equal(waitingJob.cachePrompt?.cacheKind, "rhythm_structure");
  await harness.service.resolveCacheDecision({ jobId: second.processingJobId, decision: "reuse" });
  await waitForJob(harness.jobStore, second.processingJobId, "processed");

  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_rhythm_1"), "artifact.json"));
  assert.equal(artifact.rhythmStructureAnalysis.resultOrigin, "cache_reuse");
  assert.equal(artifact.rhythmStructureAnalysis.parentArtifactId, "artifact_shot_boundary");
  assert.equal(artifact.rhythmStructureAnalysis.sourceRhythmStructureArtifactId, artifact.rhythmStructureAnalysisHistory.at(-2).artifactId);
  assert.equal(artifact.rhythmStructureAnalysisHistory.at(-1).resultOrigin, "cache_reuse");
});

test("rhythm service surfaces latest running thread message with matching agent run", async () => {
  let releaseCompletion;
  const completionGate = new Promise((resolve) => {
    releaseCompletion = resolve;
  });
  const harness = await createRhythmHarness({
    appServer: {
      startTurnWithInputs: async (payload) => {
        harness.calls.started.push(payload);
        return { ok: true, threadId: "thread_rhythm_1", turnId: "turn_rhythm_1", status: "submitted" };
      },
      collectTurnResult: async (payload) => {
        harness.calls.collected.push(payload);
        if (harness.calls.collected.length === 1) {
          return {
            ok: false,
            threadId: "thread_rhythm_1",
            turnId: "turn_rhythm_1",
            status: "running",
            finalMessage: "",
            activeThreadMessage: "正在整理节奏结构证据",
          };
        }
        await completionGate;
        return {
          ok: true,
          threadId: "thread_rhythm_1",
          turnId: "turn_rhythm_1",
          status: "completed",
          activeThreadMessage: null,
          finalMessage: JSON.stringify(createRhythmOutput()),
        };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_rhythm_1" });
  const runningJob = await waitForJobField(harness.jobStore, result.processingJobId, (job) => job.activeThreadMessage?.text === "正在整理节奏结构证据");
  assert.equal(runningJob.agentRun?.threadId, "thread_rhythm_1");
  assert.equal(runningJob.agentRun?.turnId, "turn_rhythm_1");
  assert.equal(runningJob.agentRun?.status, "turn_submitted");
  assert.equal(runningJob.activeThreadMessage?.threadId, runningJob.agentRun?.threadId);
  assert.equal(runningJob.activeThreadMessage?.turnId, runningJob.agentRun?.turnId);

  releaseCompletion();
  const job = await waitForJob(harness.jobStore, result.processingJobId, "processed");
  assert.equal(job.activeThreadMessage, null);
  assert.equal(harness.calls.collected.length, 2);
});

test("rhythm service ignores completed results from a different turn while target turn is running", async () => {
  const harness = await createRhythmHarness({
    appServer: {
      startTurnWithInputs: async (payload) => {
        harness.calls.started.push(payload);
        return { ok: true, threadId: "thread_rhythm_1", turnId: "turn_rhythm_target", status: "submitted" };
      },
      collectTurnResult: async (payload) => {
        harness.calls.collected.push(payload);
        if (harness.calls.collected.length === 1) {
          return {
            ok: true,
            threadId: "thread_rhythm_1",
            turnId: "turn_rhythm_old",
            status: "completed",
            finalMessage: JSON.stringify(createRhythmOutput()),
          };
        }
        return {
          ok: true,
          threadId: "thread_rhythm_1",
          turnId: "turn_rhythm_target",
          status: "completed",
          finalMessage: JSON.stringify(createRhythmOutput()),
        };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_rhythm_1" });
  await waitForJob(harness.jobStore, result.processingJobId, "processed");
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_rhythm_1"), "artifact.json"));

  assert.equal(harness.calls.collected.length, 2);
  assert.equal(artifact.rhythmStructureAnalysis.agent.turnId, "turn_rhythm_target");
});

test("rhythm validation rejects missing sections", async () => {
  const harness = await createRhythmHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_rhythm_1", turnId: "turn_rhythm_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_rhythm_1",
        turnId: "turn_rhythm_1",
        status: "completed",
        finalMessage: JSON.stringify({ overview: { summary: "整体节奏有效" } }),
      }),
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_rhythm_1" });
  await waitForJob(harness.jobStore, result.processingJobId, "failed");
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_rhythm_1"), "artifact.json"));
  assert.equal(artifact.rhythmStructureAnalysis.validation.validatorCode, "rhythm_structure_missing_sections");
});

test("rhythm validation rejects unknown shot refs", async () => {
  const output = createRhythmOutput();
  output.sections[0].shotRefs = ["shot_missing"];
  const harness = await createRhythmHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_rhythm_1", turnId: "turn_rhythm_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_rhythm_1",
        turnId: "turn_rhythm_1",
        status: "completed",
        finalMessage: JSON.stringify(output),
      }),
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_rhythm_1" });
  await waitForJob(harness.jobStore, result.processingJobId, "failed");
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_rhythm_1"), "artifact.json"));
  assert.equal(artifact.rhythmStructureAnalysis.validation.validatorCode, "rhythm_structure_unknown_shot_ref");
});

test("rhythm validation rejects non-contiguous shot refs", async () => {
  const output = createRhythmOutput();
  output.sections[0].shotRefs = ["shot_1", "shot_3"];
  const harness = await createRhythmHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_rhythm_1", turnId: "turn_rhythm_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_rhythm_1",
        turnId: "turn_rhythm_1",
        status: "completed",
        finalMessage: JSON.stringify(output),
      }),
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_rhythm_1" });
  await waitForJob(harness.jobStore, result.processingJobId, "failed");
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_rhythm_1"), "artifact.json"));
  assert.equal(artifact.rhythmStructureAnalysis.validation.validatorCode, "rhythm_structure_non_contiguous_shot_refs");
});

async function createRhythmHarness({ appServer = {} } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-rhythm-agent-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1", cacheParamBuilders: createArtifactCacheParamBuilders() });
  const artifact = createArtifact();
  await store.ensureSampleDirs(artifact.sampleVideoId);
  await store.writeJson(path.join(store.sampleDir(artifact.sampleVideoId), "artifact.json"), artifact);
  await artifactIndex.registerSampleArtifact({ artifact, fileHash: hashBuffer(Buffer.from("rhythm-video")), traceId: "trace_source" });

  const calls = { acquire: [], started: [], collected: [], release: [] };
  const threadPool = {
    ensureRoleReady: async (role) => ({ ok: true, role, status: { role, canAcquire: true, readyForLeases: true, warming: false, warmupError: null, startupError: null } }),
    acquireLease: async (payload) => {
      calls.acquire.push(payload);
      return { lease_id: "lease_rhythm_1", thread_id: "thread_rhythm_1" };
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
  const service = createRhythmStructureService({
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

function createRhythmOutput() {
  return {
    overview: {
      summary: "开头压缩信息快速抓眼，中段连续推进，末尾回落收束。",
      fields: [
        { label: "节奏形态", value: "先压缩再释放" },
        { label: "密度变化", value: "开头信息密度偏高，中段动作连续堆叠" },
      ],
      uncertainties: [],
    },
    sections: [
      {
        label: "快速抓眼",
        shotRefs: ["shot_1"],
        fields: [
          { label: "节奏观察", value: "短时间内给出结果感，信息密度偏高" },
          { label: "结构信号", value: "展示整理前后反差" },
        ],
        confidence: 0.82,
        needReview: false,
      },
      {
        label: "连续推进",
        shotRefs: ["shot_2", "shot_3"],
        fields: [
          { label: "节奏观察", value: "动作信息堆叠后回到整洁结果" },
          { label: "结构信号", value: "演示收纳盒摆放和分类，随后回到整洁台面" },
        ],
        confidence: 0.79,
        needReview: false,
      },
    ],
  };
}

function createArtifact() {
  return {
    sampleVideoId: "sample_rhythm_1",
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
    subtitles: {
      artifactId: "artifact_subtitle",
      parentArtifactId: "artifact_audio",
      type: "subtitle-track",
      status: "processed",
      segments: [{ id: "subtitle_1", start: 0, end: 2, text: "台面一下就整齐了", confidence: null }],
      utterances: [],
      words: [
        { start: 0, end: 0.6, text: "台面" },
        { start: 1.3, end: 1.9, text: "整齐" },
      ],
    },
    shotBoundaryAnalysis: {
      artifactId: "artifact_shot_boundary",
      parentArtifactId: "artifact_sample",
      type: "shot-boundary-analysis",
      status: "processed",
      resultOrigin: "new_turn",
      sourceFrameArtifactIds: ["artifact_frame_1", "artifact_frame_2", "artifact_frame_3"],
      contactSheets: [],
      boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "反差进入演示", needReview: false }],
      validation: { status: "passed", rawBoundaryCount: 1, normalizedBoundaryCount: 1, repairAttemptCount: 0, validatorCode: null },
      agent: { provider: "codex-appserver", role: "shot-boundary-raw-analyze-legacy", threadId: "thread_shot_1", leaseId: "lease_shot_1", turnId: "turn_shot_1" },
      shots: [
        { id: "shot_1", index: 0, shotNo: "S001", start: 0, end: 1.2, representativeFrameId: "frame_1", confidence: 0.83, reason: "开场结果", summary: "展示整理前后反差", endBoundaryReason: "反差进入演示" },
        { id: "shot_2", index: 1, shotNo: "S002", start: 1.2, end: 3.8, representativeFrameId: "frame_2", confidence: 0.79, reason: "使用演示", summary: "演示收纳盒摆放和分类", endBoundaryReason: "动作连续推进" },
        { id: "shot_3", index: 2, shotNo: "S003", start: 3.8, end: 6, representativeFrameId: "frame_3", confidence: 0.77, reason: "收束转化", summary: "回到整洁台面并提示点击", endBoundaryReason: null },
      ],
      createdAt: new Date().toISOString(),
    },
    scriptSegmentAnalysis: {
      artifactId: "artifact_script_segment",
      parentArtifactId: "artifact_shot_boundary",
      type: "script-segment-analysis",
      status: "processed",
      segments: [
        { segmentId: "segment_1", label: "开场引题", roleInScript: "先抛出结果建立停留理由", shotRefs: ["shot_1"], evidence: ["展示整理前后反差"], transferableRule: "先亮结果", confidence: 0.8, needReview: false, start: 0, end: 1.2 },
        { segmentId: "segment_2", label: "卖点证明", roleInScript: "用连续镜头解释产品价值", shotRefs: ["shot_2", "shot_3"], evidence: ["演示收纳盒摆放和分类"], transferableRule: "连续证明", confidence: 0.8, needReview: false, start: 1.2, end: 6 },
      ],
      createdAt: new Date().toISOString(),
    },
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
  throw new Error(`job ${jobId} did not reach expected field: ${JSON.stringify(lastJob)}`);
}
