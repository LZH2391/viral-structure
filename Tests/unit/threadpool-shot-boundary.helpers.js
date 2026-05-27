const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createJobStore } = require("../../Apps/Api/lib/stores/job-store");
const { DEFAULT_PYTHON_RUNTIME_ROOT, createAppServerBridge } = require("../../Apps/Api/lib/gateways/appserver/bridge");
const { createShotBoundaryService, prepareInput, buildTurnInputs, renderAnalyzeTurnInputs, STAGES } = require("../../Apps/Api/lib/shot-boundary/service");
const { buildProcessedAnalysis, normalizeTimestampBoundaries, buildShotsFromBoundaries, buildShotBoundaryCacheParams, buildRepairTurnInputs, renderRepairTurnInputs, renderSummaryTurnInputs, resolveAnalysisSampling, selectAnalysisFramesByTargetGrid, stripPromptFingerprint, splitPredecessorCacheParams, resolveSkillHash } = require("../../Apps/Api/lib/shot-boundary-analysis");
const { createArtifactCacheParamBuilders } = require("../../Apps/Api/lib/modules/cache-param-builders");
const { createArtifactIndex } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { loadRoleProfileByRole } = require("../../Apps/Api/lib/gateways/threadpool/role-profile-loader");
const { summarizeThreadConversation } = require("../../Apps/Api/lib/observability/thread-conversation");
const { createThreadPoolProxy, sanitizeRoleStatus, DEFAULT_ALLOWED_ROLES } = require("../../Apps/Api/lib/gateways/threadpool/proxy");
const { planContactSheets } = require("../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { createTransformMessage, createInvalidTransformMessage, createShotMessage, createCachedShotAnalysis } = require("./threadpool-shot-boundary.fixtures");

function createArtifact(overrides = {}) {
  const subtitleStatus = overrides.subtitleStatus ?? null;
  const subtitleSegments = overrides.subtitleSegments ?? (subtitleStatus === "processed" ? [{ id: "subtitle_1", start: 0, end: 1, text: "你好", confidence: null }] : []);
  const originalVideoUri = overrides.originalVideoUri ?? "/runtime/source.mp4";
  const normalizedVideoUri = overrides.normalizedVideoUri ?? "/runtime/source-normalized.mp4";
  return {
    sampleVideoId: "sample_1",
    trace: { traceId: "trace_1" },
    processingOptions: { frameSampleRateFps: 3 },
    sampleVideo: {
      artifactId: "artifact_sample",
      original: { artifactId: "artifact_original", parentArtifactId: null, type: "original-video", uri: originalVideoUri, summary: "source.mp4" },
      normalized: { artifactId: "artifact_normalized", parentArtifactId: "artifact_sample", type: "normalized-video", uri: normalizedVideoUri, summary: "normalized.mp4" },
    },
    metadata: { durationSeconds: 2, width: 1280, height: 720 },
    frameOutputSummary: {
      frameSampleRateFps: 3,
      targetFrameCount: 6,
      actualFrameCount: 6,
      maxFrames: 120,
      samplingPolicy: "fixed_interval_from_zero",
      cappedByMaxFrames: false,
    },
    frames: Array.from({ length: 6 }, (_, index) => ({
      frameId: `frame_${index}`,
      artifactId: `artifact_frame_${index}`,
      parentArtifactId: "artifact_sample",
      timestamp: index / 3,
      imageUri: `/runtime/Artifacts/sample_1/frames/frame-${index}.jpg`,
    })),
    subtitles: subtitleStatus ? {
      artifactId: overrides.subtitleArtifactId ?? "artifact_subtitle",
      parentArtifactId: overrides.subtitleParentArtifactId ?? "artifact_audio",
      type: "subtitle-track",
      source: overrides.subtitleSource ?? (subtitleStatus === "processed" ? "recognition" : "degraded"),
      revisionIndex: overrides.subtitleRevisionIndex ?? null,
      revisionOfArtifactId: overrides.subtitleRevisionOfArtifactId ?? null,
      textHash: overrides.subtitleTextHash ?? hashText(subtitleSegments.map((segment) => `${segment.start}-${segment.end}:${segment.text}`).join("\n")),
      summary: subtitleStatus === "processed" ? `${subtitleSegments.length} 条字幕` : "字幕识别未产出",
      status: subtitleStatus,
      reason: subtitleStatus === "degraded" ? "字幕识别降级" : null,
      segments: subtitleSegments,
    } : null,
  };
}

async function createShotHarness({
  appServer,
  threadPoolConfig,
  threadPoolOverrides,
  skillPath,
  rawAnalysisWorkspaceRoot,
  artifact,
  artifactIndex: artifactIndexOverrides,
  contactSheetGenerator: contactSheetGeneratorOverride,
  useRealArtifactIndex = false,
  reviewCollectMaxAttempts,
  reviewPollIntervalMs,
  autoTransformFallback = true,
} = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "shot-boundary-"));
  const runtimeRoot = path.join(rootDir, "Runtime");
  const store = {
    runtimeRoot,
    sampleDir: (sampleVideoId) => path.join(runtimeRoot, "Artifacts", sampleVideoId),
    ensureRuntimeDirs: async () => {
      await fs.mkdir(path.join(runtimeRoot, "Artifacts"), { recursive: true });
      await fs.mkdir(path.join(runtimeRoot, "DebugSnapshots"), { recursive: true });
    },
    writeJson: async (filePath, value) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
    },
    readJson: async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8")),
    runtimeUri: (filePath) => `/runtime/${path.relative(runtimeRoot, filePath).split(path.sep).join("/")}`,
  };
  const sampleArtifact = artifact ?? createArtifact();
  await store.ensureRuntimeDirs();
  await store.writeJson(path.join(store.sampleDir("sample_1"), "artifact.json"), sampleArtifact);
  await fs.writeFile(path.join(runtimeRoot, "source.mp4"), "video", "utf8");
  await fs.writeFile(path.join(runtimeRoot, "source-normalized.mp4"), "video", "utf8");
  const framesDir = path.join(store.sampleDir("sample_1"), "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const framePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnS6fQAAAAASUVORK5CYII=";
  for (let index = 0; index < 6; index += 1) {
    await fs.writeFile(path.join(framesDir, `frame-${index}.jpg`), Buffer.from(framePngBase64, "base64"));
  }
  const logger = {
    logs: [],
    snapshots: [],
    writeStageLog: async (entry) => {
      logger.logs.push(entry);
      return entry;
    },
    writeDebugSnapshot: async (entry) => {
      const snapshot = { ...entry, uri: `/runtime/debug-${logger.snapshots.length}.json` };
      logger.snapshots.push(snapshot);
      return snapshot;
    },
  };
  const jobStore = createJobStore();
  const threadPool = {
    released: [],
    discarded: [],
    ownerReleased: [],
    config: async () => threadPoolConfig ?? { ok: true, discardOnRelease: false },
    roleStatus: async (role = "shot-boundary-transformer") => ({
      ok: true,
      role,
      counts: { idle: 1, leased: 0 },
      minIdle: 1,
      canAcquire: true,
      canInit: true,
      warming: false,
      readyForLeases: true,
      recovering: false,
      warmupError: null,
      startupError: null,
      threads: [],
      leases: [],
    }),
    ensureRoleReady: async (role = "shot-boundary-transformer") => ({ ok: true, role, status: { role, canAcquire: true, readyForLeases: true, warming: false, warmupError: null, startupError: null } }),
    acquireLease: async ({ role } = {}) => role === "shot-boundary-transformer"
      ? { lease_id: "review_lease_1", thread_id: "review_thread_1" }
      : { lease_id: "lease_1", thread_id: "thread_1" },
    releaseLease: async (payload) => {
      const result = { ...payload, thread_status: "idle" };
      threadPool.released.push(result);
      return { ok: true, thread_status: "idle" };
    },
    discardThread: async (payload) => {
      threadPool.discarded.push(payload);
      return { ok: true };
    },
    releaseOwnerLeases: async (ownerId) => {
      threadPool.ownerReleased.push(ownerId);
      return { ok: true };
    },
    ...threadPoolOverrides,
  };
  const fakeArtifactIndex = {
    findCacheEntry: async () => null,
    getItem: async () => ({ fileHash: "hash_1" }),
    registerSampleArtifact: async () => ({ ok: true }),
    loadItem: async () => null,
    ...artifactIndexOverrides,
  };
  const artifactIndex = useRealArtifactIndex
    ? createArtifactIndex({ store, processorVersion: "test-v1", cacheParamBuilders: createArtifactCacheParamBuilders() })
    : fakeArtifactIndex;
  const contactSheetGenerator = contactSheetGeneratorOverride ?? {
    generateContactSheets: async ({ frames, parentArtifactId, sampleDir, outputSubdir, sheetPurpose }) => createContactSheets(
      { frames, sourceArtifactId: parentArtifactId },
      sampleDir,
      { outputSubdir, sheetPurpose },
    ),
  };
  const appServerImpl = appServer ?? {};
  const turnKinds = [];
  const startedTurns = [];
  const startedThreads = [];
  const cancelledTurns = [];
  const service = createShotBoundaryService({
    rootDir,
    store,
    logger,
    jobStore,
    artifactIndex,
    threadPool,
    contactSheetGenerator,
    skillPath,
    rawAnalysisWorkspaceRoot,
    reviewCollectMaxAttempts,
    reviewPollIntervalMs,
    appServer: {
      startThread: async (payload) => {
        startedThreads.push(payload);
        const result = appServerImpl.startThread
          ? await appServerImpl.startThread(payload)
          : { ok: true, threadId: "thread_1", status: "created" };
        return result;
      },
      startTurnWithInputs: async (payload) => {
        const result = appServerImpl.startTurnWithInputs
          ? await appServerImpl.startTurnWithInputs(payload)
          : { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
        const kind = isTransformTurnPayload(payload) ? "transform" : "shot";
        turnKinds.push({ turnId: result.turnId ?? null, kind });
        startedTurns.push({ kind, payload, result });
        return result;
      },
      collectTurnResult: async (payload) => {
        const turnKindEntry = turnKinds.shift() ?? { kind: "shot" };
        const turnKind = turnKindEntry.kind;
        const result = appServerImpl.collectTurnResult
          ? await appServerImpl.collectTurnResult(payload)
          : { ok: false, threadId: "thread_1", turnId: "turn_1", status: "running", finalMessage: "" };
        if (turnKind === "transform" && result?.status !== "completed") {
          turnKinds.unshift(turnKindEntry);
        }
        if (autoTransformFallback && turnKind === "transform" && result?.status === "completed" && !String(result.finalMessage ?? "").includes("commerceBrief")) {
          return { ...result, finalMessage: createTransformMessage() };
        }
        return result;
      },
      cancelTurn: async (payload) => {
        cancelledTurns.push(payload);
        return appServerImpl.cancelTurn
          ? await appServerImpl.cancelTurn(payload)
          : { ok: true, threadId: payload.threadId, turnId: payload.turnId, status: "cancelled" };
      },
    },
    pollIntervalMs: 60_000,
  });
  return { rootDir, store, logger, jobStore, threadPool, artifactIndex, service, startedTurns, startedThreads, cancelledTurns, sampleArtifact };
}

function isTransformTurnPayload(payload) {
  const text = String(payload?.inputs?.[0]?.text ?? "");
  return text.includes("结果转换 agent")
    || text.includes("修正 shots[].summary")
    || (text.includes("commerceBrief") && text.includes("rawAnalyzerResult"));
}

function createContactSheets(prepared, sampleDir, options = {}) {
  const frames = prepared.frames ?? prepared;
  const parentArtifactId = prepared.sourceArtifactId ?? "artifact_sample";
  const outputSubdir = options.outputSubdir ?? "contact-sheets";
  const sheetPurpose = options.sheetPurpose ?? "shot_boundary_analysis";
  return [
    {
      artifactId: "artifact_sheet_1",
      parentArtifactId,
      type: "contact_sheet",
      artifactType: "contact_sheet",
      status: "processed",
      sheetPurpose,
      sheetId: "sheet-001",
      sheetIndex: 0,
      uri: `/runtime/Artifacts/sample_1/${outputSubdir}/sheet-001.jpg`,
      imagePath: `/runtime/Artifacts/sample_1/${outputSubdir}/sheet-001.jpg`,
      localImagePath: path.join(sampleDir, outputSubdir, "sheet-001.jpg"),
      frameCount: Math.min(4, frames.length),
      overlapFrameIds: [],
      gridItems: frames.slice(0, 4).map((frame, index) => ({
        frameId: frame.frameId,
        artifactId: frame.artifactId,
        parentArtifactId: frame.parentArtifactId,
        displayFrameLabel: `frame-${String((frame.inputIndex ?? index) + 1).padStart(3, "0")}`,
        timestamp: frame.timestamp,
        inputIndex: frame.inputIndex,
        sourceFrameIndex: frame.sourceFrameIndex,
        filePath: frame.filePath,
        gridIndex: index,
        row: 0,
        col: index,
      })),
      layout: { rows: 2, cols: 2, width: 600, height: 480, cellWidth: 300, cellHeight: 240, visibleFrameWidth: 300, visibleFrameHeight: 168, labelHeight: 28 },
      constraints: { maxDimension: 4096, minFrameShortSide: 144, minFrameLongSide: 256, labelHeight: 28, overlapFrameCount: 1 },
      compression: { format: "jpeg", quality: 88 },
      createdAt: new Date().toISOString(),
    },
    {
      artifactId: "artifact_sheet_2",
      parentArtifactId,
      type: "contact_sheet",
      artifactType: "contact_sheet",
      status: "processed",
      sheetPurpose,
      sheetId: "sheet-002",
      sheetIndex: 1,
      uri: `/runtime/Artifacts/sample_1/${outputSubdir}/sheet-002.jpg`,
      imagePath: `/runtime/Artifacts/sample_1/${outputSubdir}/sheet-002.jpg`,
      localImagePath: path.join(sampleDir, outputSubdir, "sheet-002.jpg"),
      frameCount: Math.max(0, Math.min(3, Math.max(0, frames.length - 3))),
      overlapFrameIds: [frames[3]?.frameId].filter(Boolean),
      gridItems: frames.slice(3, 6).map((frame, index) => ({
        frameId: frame.frameId,
        artifactId: frame.artifactId,
        parentArtifactId: frame.parentArtifactId,
        displayFrameLabel: `frame-${String((frame.inputIndex ?? (index + 3)) + 1).padStart(3, "0")}`,
        timestamp: frame.timestamp,
        inputIndex: frame.inputIndex,
        sourceFrameIndex: frame.sourceFrameIndex,
        filePath: frame.filePath,
        gridIndex: index,
        row: 0,
        col: index,
      })),
      layout: { rows: 2, cols: 2, width: 600, height: 480, cellWidth: 300, cellHeight: 240, visibleFrameWidth: 300, visibleFrameHeight: 168, labelHeight: 28 },
      constraints: { maxDimension: 4096, minFrameShortSide: 144, minFrameLongSide: 256, labelHeight: 28, overlapFrameCount: 1 },
      compression: { format: "jpeg", quality: 88 },
      createdAt: new Date().toISOString(),
    },
  ];
}

function rootRuntime(name) {
  return path.join("C:\\Runtime", name);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function structuredErrorForTest(code, exc, payload) {
  return {
    ok: false,
    error: code,
    message: String(exc).slice(0, 240),
    operation: payload.operation || "runTurnWithInputs",
    threadId: payload.threadId,
    turnId: payload.turnId,
  };
}

function createValidCachedShotAnalysis({ analysisFps = 3 } = {}) {
  const targetFrameCount = Math.ceil(2 * analysisFps);
  const selectedFrameCount = Math.min(targetFrameCount, 6);
  return {
    artifactId: "artifact_cached_valid_shot",
    parentArtifactId: "artifact_sample",
    type: "shot-boundary-analysis",
    status: "processed",
    resultOrigin: "new_turn",
    sourceFrameArtifactIds: [],
    extractSampling: {
      requestedFps: 3,
      targetFrameCount: 6,
      actualFrameCount: 6,
      maxFrames: 120,
      samplingPolicy: "fixed_interval_from_zero",
      cappedByMaxFrames: false,
    },
    analysisSampling: {
      fps: analysisFps,
      requestedFps: analysisFps,
      targetFrameCount,
      selectedFrameCount,
      effectiveFps: selectedFrameCount / 2,
      selectionPolicy: "target_grid_nearest_unique",
      duplicatePolicy: "nearest_unselected_tie_later",
      roundingPolicy: "target_grid_nearest_unique",
    },
    subtitleContextSummary: null,
    contactSheets: createContactSheets(prepareInput(createArtifact(), analysisFps, { runtimeRoot: rootRuntime("cached") }), rootRuntime("cached")),
    boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false }],
    validation: { status: "passed", rawBoundaryCount: 1, normalizedBoundaryCount: 1, repairAttemptCount: 0, validatorCode: null },
    agent: {
      provider: "codex-appserver",
      role: "shot-boundary-transformer",
      profilePath: "C:\\ByteDanceFullStack\\Assets\\RoleProfiles\\shot-boundary-transformer\\role.json",
      profileVersion: "2026-05-24.1",
      promptTemplateId: "transform",
      promptTemplateVersion: "transform.v1",
      promptTemplateHash: "cached_prompt_hash",
      initFingerprint: "cached_init_fingerprint",
      skillPath: "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-transformer\\SKILL.md",
      skillHash: "cached_hash",
      threadId: "review_thread_cached",
      leaseId: "review_lease_cached",
      turnId: "turn_transform_cached",
      sheetCount: 2,
      inputMode: "raw_video_path_text",
      rawAnalyzer: {
        phase: "raw_video_analyze",
        threadId: "thread_cached",
        leaseId: null,
        turnId: "turn_raw_cached",
        inputMode: "raw_video_path_text",
        rawResultPreview: "raw analyzer finished",
      },
    },
    shots: [
      { id: "shot_1", index: 0, shotNo: "S001", start: 0, end: 1.2, representativeFrameId: "frame_0", confidence: 0.8, reason: "cut", summary: "人物侧脸口播", endBoundaryReason: "cut" },
      { id: "shot_2", index: 1, shotNo: "S002", start: 1.2, end: 2, representativeFrameId: "frame_4", confidence: 0.8, reason: "视觉连续", summary: "产品特写镜头", endBoundaryReason: null },
    ],
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  test,
  assert,
  fs,
  os,
  path,
  crypto,
  createJobStore,
  DEFAULT_PYTHON_RUNTIME_ROOT,
  createAppServerBridge,
  createShotBoundaryService,
  prepareInput,
  buildTurnInputs,
  renderAnalyzeTurnInputs,
  STAGES,
  buildProcessedAnalysis,
  normalizeTimestampBoundaries,
  buildShotsFromBoundaries,
  buildShotBoundaryCacheParams,
  buildRepairTurnInputs,
  renderRepairTurnInputs,
  renderSummaryTurnInputs,
  resolveAnalysisSampling,
  selectAnalysisFramesByTargetGrid,
  stripPromptFingerprint,
  splitPredecessorCacheParams,
  resolveSkillHash,
  createArtifactCacheParamBuilders,
  createArtifactIndex,
  loadRoleProfileByRole,
  summarizeThreadConversation,
  createThreadPoolProxy,
  sanitizeRoleStatus,
  DEFAULT_ALLOWED_ROLES,
  planContactSheets,
  createArtifact,
  createShotHarness,
  isTransformTurnPayload,
  createContactSheets,
  rootRuntime,
  escapeRegExp,
  delay,
  hashText,
  response,
  structuredErrorForTest,
  createTransformMessage,
  createInvalidTransformMessage,
  createShotMessage,
  createCachedShotAnalysis,
  createValidCachedShotAnalysis,
};
