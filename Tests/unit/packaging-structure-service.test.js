const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createJobStore } = require("../../Apps/Api/lib/stores/job-store");
const contactSheetGenerator = require("../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { createPackagingStructureService, STAGES, prepareInput } = require("../../Apps/Api/lib/packaging-structure/service");
const { prepareInputPackage, renderAnalyzeTurnInputs } = require("../../Apps/Api/lib/packaging-structure-analysis/input");
const { createArtifactCacheParamBuilders } = require("../../Apps/Api/lib/modules/cache-param-builders");
const { loadRoleProfileByRole } = require("../../Apps/Api/lib/gateways/threadpool/role-profile-loader");
const { createArtifactIndex, hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");

contactSheetGenerator.generateContactSheets = async ({ frames, sampleDir, parentArtifactId, sheetPurpose, buildSheetId }) => {
  if (!frames.length) return [];
  const sheetId = buildSheetId({ sheetIndex: 0 });
  return [{
    artifactId: `artifact_${sheetPurpose}_${sheetId}`,
    parentArtifactId,
    type: "contact_sheet",
    artifactType: "contact_sheet",
    status: "processed",
    sheetPurpose,
    sheetId,
    sheetIndex: 0,
    frameCount: frames.length,
    localImagePath: path.join(sampleDir, "sheets", `${sheetId}.jpg`),
    uri: `/runtime/${sheetId}.jpg`,
    gridItems: frames.map((frame, index) => ({
      frameId: frame.frameId,
      artifactId: frame.artifactId,
      parentArtifactId: frame.parentArtifactId,
      timestamp: frame.timestamp,
      row: 0,
      col: index,
    })),
  }];
};

test("packaging input package includes shot subtitles, visualRefs and sfx candidates with localImage attachments", async () => {
  const artifact = createArtifact();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-packaging-input-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  await store.ensureSampleDirs(artifact.sampleVideoId);

  const input = prepareInput(artifact, { runtimeRoot: store.runtimeRoot });
  const inputPackage = await prepareInputPackage({ input, sampleDir: store.sampleDir(artifact.sampleVideoId), store });
  const roleProfile = await loadRoleProfileByRole("packaging-structure-analyzer");
  const turnInputs = renderAnalyzeTurnInputs({ input, inputPackage, roleProfile });
  const shot = inputPackage.manifest.shots[0];

  assert.equal(Object.hasOwn(input, "scriptSegments"), false);
  assert.equal(Object.hasOwn(input, "rhythmStructureAnalysis"), false);
  assert.equal(inputPackage.manifest.commerceBrief.sellingObject, "收纳盒");
  assert.equal(inputPackage.manifest.audioEventCandidates.length, 1);
  assert.equal(inputPackage.manifest.audioEventCandidates[0].kind, "sfx_candidate");
  assert.equal(typeof shot.subtitleText, "string");
  assert.equal(typeof shot.subtitleContextText, "string");
  assert.equal(Array.isArray(shot.visualRefs), true);
  assert.equal(shot.visualRefs[0].type, "shot_contact_sheet");
  assert.equal(turnInputs.inputs.filter((item) => item.type === "localImage").length, inputPackage.visualManifest.sheetCount);
  assert.match(turnInputs.inputs[0].text, /sfx_candidate/);
});

test("packaging service writes analysis, history and artifact index node", async () => {
  const harness = await createPackagingHarness({
    appServer: {
      startTurnWithInputs: async (payload) => {
        harness.calls.started.push(payload);
        return { ok: true, threadId: "thread_packaging_1", turnId: "turn_packaging_1", status: "submitted" };
      },
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_packaging_1",
        turnId: "turn_packaging_1",
        status: "completed",
        finalMessage: JSON.stringify(createPackagingOutput()),
      }),
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_packaging_1" });
  const job = await waitForJob(harness.jobStore, result.processingJobId, "processed");
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_packaging_1"), "artifact.json"));
  const detail = await harness.artifactIndex.getItem("sample_packaging_1");
  const node = detail.artifactTree.find((entry) => entry.stageName === STAGES.materialized);
  const imageInputs = harness.calls.started[0].inputs.filter((item) => item.type === "localImage");

  assert.equal(job.status, "processed");
  assert.equal(harness.calls.acquire[0].role, "packaging-structure-analyzer");
  assert.equal(imageInputs.length > 0, true);
  assert.equal(artifact.packagingStructureAnalysis.agent.role, "packaging-structure-analyzer");
  assert.equal(artifact.packagingStructureAnalysis.agent.promptTemplateVersion, "analyze.v1");
  assert.equal(artifact.packagingStructureAnalysis.shotPackagingNotes.length, 3);
  assert.equal(artifact.packagingStructureAnalysis.packagingBlocks.length, 2);
  assert.equal(artifact.packagingStructureAnalysis.validation.shotPackagingNoteCount, 3);
  assert.equal(artifact.packagingStructureAnalysisHistory.at(-1).packagingBlockCount, 2);
  assert.ok(artifact.packagingStructureAnalysisRef.uri);
  assert.ok(node);
  assert.equal(detail.tags.includes("包装结构"), true);
});

test("packaging validation failure repairs once", async () => {
  const harness = await createPackagingHarness({
    appServer: {
      startTurnWithInputs: async () => {
        harness.calls.started.push({});
        const turnId = harness.calls.started.length === 1 ? "turn_packaging_bad" : "turn_packaging_repair";
        return { ok: true, threadId: "thread_packaging_1", turnId, status: "submitted" };
      },
      collectTurnResult: async (payload) => ({
        ok: true,
        threadId: "thread_packaging_1",
        turnId: payload.turnId,
        status: "completed",
        finalMessage: payload.turnId === "turn_packaging_repair"
          ? JSON.stringify(createPackagingOutput())
          : JSON.stringify({ overview: { summary: "有包装观察" }, packagingBlocks: [], claimStack: [], proofStack: [], conversionWrap: { summary: "无明确转化包装", shotRefs: ["shot_3"], fields: [] } }),
      }),
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_packaging_1" });
  await waitForJob(harness.jobStore, result.processingJobId, "processed");
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_packaging_1"), "artifact.json"));
  assert.equal(artifact.packagingStructureAnalysis.resultOrigin, "repaired_turn");
  assert.equal(artifact.packagingStructureAnalysis.validation.repairAttemptCount, 1);
});

test("packaging cache reuse creates new artifact with lineage", async () => {
  const harness = await createPackagingHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_packaging_1", turnId: "turn_packaging_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: true, threadId: "thread_packaging_1", turnId: "turn_packaging_1", status: "completed", finalMessage: JSON.stringify(createPackagingOutput()) }),
    },
  });

  const first = await harness.service.enqueue({ sampleVideoId: "sample_packaging_1" });
  await waitForJob(harness.jobStore, first.processingJobId, "processed");

  const second = await harness.service.enqueue({ sampleVideoId: "sample_packaging_1" });
  const waitingJob = await waitForJob(harness.jobStore, second.processingJobId, "cache_waiting");
  assert.equal(waitingJob.cachePrompt.cacheKind, "packaging_structure");
  await harness.service.resolveCacheDecision({ jobId: second.processingJobId, decision: "reuse" });
  await waitForJob(harness.jobStore, second.processingJobId, "processed");

  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_packaging_1"), "artifact.json"));
  assert.equal(artifact.packagingStructureAnalysis.resultOrigin, "cache_reuse");
  assert.equal(artifact.packagingStructureAnalysis.sourcePackagingStructureArtifactId, artifact.packagingStructureAnalysisHistory.at(-2).artifactId);
  assert.equal(artifact.packagingStructureAnalysisHistory.at(-1).resultOrigin, "cache_reuse");
});

test("packaging service rejects stale shot boundary artifact", async () => {
  const harness = await createPackagingHarness();
  await assert.rejects(
    () => harness.service.enqueue({ sampleVideoId: "sample_packaging_1", expectedShotBoundaryArtifactId: "artifact_previous_shot_boundary" }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "packaging_structure_shot_boundary_stale");
      return true;
    },
  );
});

async function createPackagingHarness({ appServer = {} } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-packaging-agent-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const logger = createStageLogger(store);
  const jobStore = createJobStore();
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1", cacheParamBuilders: createArtifactCacheParamBuilders() });
  const artifact = createArtifact();
  await store.ensureSampleDirs(artifact.sampleVideoId);
  await store.writeJson(path.join(store.sampleDir(artifact.sampleVideoId), "artifact.json"), artifact);
  await artifactIndex.registerSampleArtifact({ artifact, fileHash: hashBuffer(Buffer.from("packaging-video")), traceId: "trace_source" });

  const calls = { acquire: [], started: [], collected: [], release: [] };
  const threadPool = {
    ensureRoleReady: async (role) => ({ ok: true, role, status: { role, canAcquire: true, readyForLeases: true, warming: false, warmupError: null, startupError: null } }),
    acquireLease: async (payload) => {
      calls.acquire.push(payload);
      return { lease_id: "lease_packaging_1", thread_id: "thread_packaging_1" };
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
  const service = createPackagingStructureService({
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

function createPackagingOutput() {
  return {
    overview: {
      summary: "首屏用大字幕和结果画面快速说明收纳利益，中段用字幕和贴纸强化演示证据。",
      fields: [{ label: "主包装风格", value: "字幕解释加局部贴纸强调" }],
      uncertainties: [],
    },
    shotPackagingNotes: [
      {
        shotRef: "shot_1",
        fields: [{ label: "字幕密度", value: "开头字幕承担读懂卖点的主要功能" }],
        packagingFunction: "用结果感和标题化字幕建立停留理由",
        confidence: 0.82,
        needReview: false,
      },
      {
        shotRef: "shot_2",
        fields: [{ label: "证明包装", value: "演示画面配字幕解释分类方式" }],
        packagingFunction: "把商品使用方式包装成可信证明",
        confidence: 0.78,
        needReview: false,
      },
      {
        shotRef: "shot_3",
        fields: [{ label: "转化包装", value: "回到整洁结果并用字幕提示行动" }],
        packagingFunction: "用结果收束推动点击理解",
        confidence: 0.76,
        needReview: false,
      },
    ],
    packagingBlocks: [
      {
        label: "结果标题化包装",
        shotRefs: ["shot_1"],
        fields: [{ label: "元素组合", value: "结果画面加大字幕" }],
        packagingFunction: "放大承诺和停留理由",
        confidence: 0.82,
        needReview: false,
      },
      {
        label: "演示证明包装",
        shotRefs: ["shot_2", "shot_3"],
        fields: [{ label: "元素组合", value: "实拍演示加字幕解释" }],
        packagingFunction: "把收纳过程转成证据链",
        confidence: 0.78,
        needReview: false,
      },
    ],
    claimStack: [{ label: "台面变整洁", shotRefs: ["shot_1"], fields: [{ label: "视觉化方式", value: "直接展示整理结果" }] }],
    proofStack: [{ label: "分类收纳证明", shotRefs: ["shot_2"], fields: [{ label: "实拍证明", value: "展示收纳盒摆放和分类" }] }],
    conversionWrap: { summary: "末尾用结果画面和行动字幕做轻量转化包装", shotRefs: ["shot_3"], fields: [{ label: "行动包装", value: "提示点击理解" }], uncertainties: [] },
  };
}

function createArtifact() {
  return {
    sampleVideoId: "sample_packaging_1",
    workspaceId: "workspace_1",
    status: "processed",
    trace: { runId: "run_source", traceId: "trace_source", stageId: "stage_source" },
    processingOptions: { frameSampleRateFps: 3, enableAudioFeatureAnalysis: true },
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
    audioFeatures: {
      artifactId: "artifact_audio_features",
      parentArtifactId: "artifact_audio",
      type: "audio-feature-analysis",
      beats: [],
      onsets: [],
      energyFrames: [],
      audioEventCandidates: [
        { time: 1.2, kind: "sfx_candidate", confidence: 0.81, usableForEdit: true, evidence: { rms: 0.2, labels: ["sfx_candidate"] } },
        { time: 2.4, kind: "strong_cut_candidate", confidence: 0.65, usableForEdit: true, evidence: { rms: 0.1, labels: ["cut"] } },
      ],
    },
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
      commerceBrief: {
        sellingObject: "收纳盒",
        proofApproach: "通过前后对比和使用演示证明收纳效果",
        promisedOutcome: "台面更整洁",
        persuasionTarget: "需要整理桌面的用户",
        conversionAction: "点击了解",
        uncertainties: [],
      },
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
