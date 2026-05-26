const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createJobStore } = require("../../Apps/Api/lib/job-store");
const { DEFAULT_PYTHON_RUNTIME_ROOT, createAppServerBridge } = require("../../Apps/Api/lib/appserver-bridge");
const { createShotBoundaryService, prepareInput, buildTurnInputs, renderAnalyzeTurnInputs, STAGES } = require("../../Apps/Api/lib/shot-boundary-service");
const { buildProcessedAnalysis, normalizeTimestampBoundaries, buildShotsFromBoundaries, buildShotBoundaryCacheParams, buildRepairTurnInputs, renderRepairTurnInputs, renderSummaryTurnInputs, resolveAnalysisSampling, selectAnalysisFramesByTargetGrid, stripPromptFingerprint, splitPredecessorCacheParams, resolveSkillHash } = require("../../Apps/Api/lib/shot-boundary-analysis");
const { createArtifactCacheParamBuilders } = require("../../Apps/Api/lib/artifact-cache-param-builders");
const { createArtifactIndex } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { loadRoleProfileByRole } = require("../../Apps/Api/lib/role-profile-loader");
const { summarizeThreadConversation } = require("../../Apps/Api/lib/thread-conversation");
const { createThreadPoolProxy, sanitizeRoleStatus, DEFAULT_ALLOWED_ROLES } = require("../../Apps/Api/lib/threadpool-proxy");
const { planContactSheets } = require("../../Infrastructure/MediaProcessing/contact-sheet-generator");

test("shot boundary sampling selects target-grid nearest unique frames and rejects oversampling", () => {
  const artifact = createArtifact();
  const input = prepareInput(artifact, 2, { runtimeRoot: "C:\\Runtime" });
  assert.equal(input.analysisSampling.selectionPolicy, "target_grid_nearest_unique");
  assert.equal(input.analysisSampling.duplicatePolicy, "nearest_unselected_tie_later");
  assert.equal(input.analysisSampling.targetFrameCount, 4);
  assert.equal(input.analysisSampling.selectedFrameCount, 4);
  assert.equal(input.analysisSampling.effectiveFps, 2);
  assert.deepEqual(input.frames.map((frame) => frame.inputIndex), [0, 1, 2, 3]);
  assert.deepEqual(input.frames.map((frame) => frame.sourceFrameIndex), [0, 2, 3, 5]);
  assert.deepEqual(input.frames.map((frame) => frame.timestamp), [0, 0.667, 1, 1.667]);
  assert.throws(() => prepareInput(artifact, 4), /高于抽帧采样率/);
  assert.throws(() => prepareInput(artifact, 0.5), /1 到 10 之间的整数/);
  assert.throws(() => prepareInput(artifact, 2.5), /1 到 10 之间的整数/);
  assert.throws(() => prepareInput(artifact, 11), /1 到 10 之间的整数/);
});

test("shot boundary sampling metadata uses target-grid policy", () => {
  assert.deepEqual(resolveAnalysisSampling({ requestedFrameSampleRateFps: 3, requestedAnalysisFps: 1, durationSeconds: 2, targetFrameCount: 2, selectedFrameCount: 2 }), {
    fps: 1,
    requestedFps: 1,
    targetFrameCount: 2,
    selectedFrameCount: 2,
    effectiveFps: 1,
    selectionPolicy: "target_grid_nearest_unique",
    duplicatePolicy: "nearest_unselected_tie_later",
    roundingPolicy: "target_grid_nearest_unique",
  });
  assert.deepEqual(resolveAnalysisSampling({ requestedFrameSampleRateFps: 3, requestedAnalysisFps: 2, durationSeconds: 2, targetFrameCount: 4, selectedFrameCount: 4 }), {
    fps: 2,
    requestedFps: 2,
    targetFrameCount: 4,
    selectedFrameCount: 4,
    effectiveFps: 2,
    selectionPolicy: "target_grid_nearest_unique",
    duplicatePolicy: "nearest_unselected_tie_later",
    roundingPolicy: "target_grid_nearest_unique",
  });
  assert.deepEqual(resolveAnalysisSampling({ requestedFrameSampleRateFps: 3, requestedAnalysisFps: 2.4, durationSeconds: 2, targetFrameCount: 5, selectedFrameCount: 5 }), {
    fps: 2.4,
    requestedFps: 2.4,
    targetFrameCount: 5,
    selectedFrameCount: 5,
    effectiveFps: 2.5,
    selectionPolicy: "target_grid_nearest_unique",
    duplicatePolicy: "nearest_unselected_tie_later",
    roundingPolicy: "target_grid_nearest_unique",
  });
  assert.deepEqual(resolveAnalysisSampling({ requestedFrameSampleRateFps: 3, requestedAnalysisFps: 3, durationSeconds: 2, targetFrameCount: 6, selectedFrameCount: 6 }), {
    fps: 3,
    requestedFps: 3,
    targetFrameCount: 6,
    selectedFrameCount: 6,
    effectiveFps: 3,
    selectionPolicy: "target_grid_nearest_unique",
    duplicatePolicy: "nearest_unselected_tie_later",
    roundingPolicy: "target_grid_nearest_unique",
  });
  assert.equal(resolveAnalysisSampling(3, 2).selectionPolicy, "target_grid_nearest_unique");
});

test("target-grid selection handles non-integer durations and target counts above available frames", () => {
  const frames = Array.from({ length: 4 }, (_, index) => ({ frameId: `frame_${index}`, timestamp: index / 3 }));
  const selected = selectAnalysisFramesByTargetGrid(frames, 2.1, 3);
  assert.equal(selected.length, 4);
  assert.deepEqual(selected.map((item) => item.sourceFrameIndex), [0, 1, 2, 3]);
  assert.deepEqual(selectAnalysisFramesByTargetGrid(frames, 1.1, 1).map((item) => item.sourceFrameIndex), [0, 3]);
});

test("contact sheet grid items include sequential display labels without changing tracking ids", () => {
  const sheets = planContactSheets({
    frames: [
      { frameId: "frame_a1b2", artifactId: "artifact_frame_0", parentArtifactId: "artifact_sample", timestamp: 0, inputIndex: 0, sourceFrameIndex: 7, filePath: "C:\\Runtime\\frame-0.jpg" },
      { frameId: "frame_c3d4", artifactId: "artifact_frame_1", parentArtifactId: "artifact_sample", timestamp: 4.393, inputIndex: 1, sourceFrameIndex: 11, filePath: "C:\\Runtime\\frame-1.jpg" },
      { frameId: "frame_e5f6", artifactId: "artifact_frame_2", parentArtifactId: "artifact_sample", timestamp: 9.125, inputIndex: 2, sourceFrameIndex: 18, filePath: "C:\\Runtime\\frame-2.jpg" },
    ],
    frameWidth: 1280,
    frameHeight: 720,
    parentArtifactId: "artifact_sample",
  });

  assert.equal(sheets.length, 1);
  assert.deepEqual(
    sheets[0].gridItems.map((item) => ({
      frameId: item.frameId,
      displayFrameLabel: item.displayFrameLabel,
      inputIndex: item.inputIndex,
      sourceFrameIndex: item.sourceFrameIndex,
    })),
    [
      { frameId: "frame_a1b2", displayFrameLabel: "frame-001", inputIndex: 0, sourceFrameIndex: 7 },
      { frameId: "frame_c3d4", displayFrameLabel: "frame-002", inputIndex: 1, sourceFrameIndex: 11 },
      { frameId: "frame_e5f6", displayFrameLabel: "frame-003", inputIndex: 2, sourceFrameIndex: 18 },
    ],
  );
  assert.deepEqual(sheets[0].overlapFrameIds, []);
});


test("shot boundary normalizes timestamp boundaries and builds contiguous shots", () => {
  const frames = [
    { frameId: "frame_0", inputIndex: 0, timestamp: 0 },
    { frameId: "frame_1", inputIndex: 1, timestamp: 1 },
    { frameId: "frame_2", inputIndex: 2, timestamp: 2 },
    { frameId: "frame_3", inputIndex: 3, timestamp: 3.5 },
  ];
  const boundaries = normalizeTimestampBoundaries([
    { timestamp: 1.5, confidence: 2, reason: "x".repeat(300), boundaryType: "", needReview: 1 },
    { timestamp: 3.2, confidence: 0.9, reason: "valid cut" },
  ]);
  const shots = buildShotsFromBoundaries(boundaries, frames, 4);

  assert.equal(boundaries.length, 2);
  assert.equal(boundaries[0].confidence, 1);
  assert.equal(boundaries[0].reason.length, 160);
  assert.equal(boundaries[0].boundaryType, null);
  assert.equal(boundaries[0].needReview, true);
  assert.equal(shots.length, 3);
  assert.equal(shots[0].start, 0);
  assert.equal(shots.at(-1).end, 4);
  assert.equal(shots[0].shotNo, "S001");
  assert.equal(shots[0].summary, "x".repeat(80));
  assert.equal(shots[0].endBoundaryReason, "x".repeat(160));
});

test("processed shot analysis maps shot summaries and keeps fallback reason compatibility", () => {
  const artifact = createArtifact();
  const prepared = prepareInput(artifact, 1, { runtimeRoot: "C:\\Runtime" });
  const contactSheets = createContactSheets(prepared, path.join("C:\\Runtime", "Artifacts", "sample_1"));
  const analysis = buildProcessedAnalysis(
    JSON.stringify({
      boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "人物转场", needReview: false }],
      shots: [{ summary: "人物正脸特写" }],
    }),
    prepared,
    contactSheets,
    { artifactId: "artifact_shot", skillPath: "SKILL.md", skillHash: "hash" },
    { thread_id: "thread_1", lease_id: "lease_1" },
    { turnId: "turn_1" },
  );

  assert.equal(analysis.subtitleContextSummary.subtitleSegmentCount, 0);
  assert.equal(analysis.shots[0].summary, "人物正脸特写");
  assert.equal(analysis.shots[0].endBoundaryReason, "人物转场");
  assert.equal(analysis.shots[0].reason, "人物转场");
  assert.equal(analysis.shots[1].summary, "人物转场");
  assert.equal(analysis.shots[1].endBoundaryReason, null);
});

test("processed shot analysis accepts shot-centric output and derives boundaries", () => {
  const artifact = createArtifact();
  const prepared = prepareInput(artifact, 1, { runtimeRoot: "C:\\Runtime" });
  const contactSheets = createContactSheets(prepared, path.join("C:\\Runtime", "Artifacts", "sample_1"));
  const analysis = buildProcessedAnalysis(
    JSON.stringify({
      commerceBrief: {
        sellingObject: "卤鳗鱼即食产品",
        proofApproach: "包装展示加手持实拍",
        promisedOutcome: "方便快速吃到熟食",
        persuasionTarget: "想省事又想吃得像样的人",
        conversionAction: "下单试吃",
        uncertainties: ["未看到明确价格信息"],
      },
      shots: [
        {
          summary: "包装上的卤鳗鱼特写",
          start: 0,
          end: 1.2,
          endBoundary: {
            timestamp: 1.2,
            confidence: 0.8,
            boundaryType: "hard_cut",
            reason: "包装特写切到手持展示",
            needReview: false,
          },
        },
        {
          summary: "手持多包鳗鱼展示",
          start: 1.2,
          end: 2,
          endBoundary: null,
        },
      ],
    }),
    prepared,
    contactSheets,
    { artifactId: "artifact_shot", skillPath: "SKILL.md", skillHash: "hash" },
    { thread_id: "thread_1", lease_id: "lease_1" },
    { turnId: "turn_1" },
  );

  assert.equal(analysis.validation.schemaVersion, "shot-centric.v2");
  assert.equal(analysis.commerceBrief.sellingObject, "卤鳗鱼即食产品");
  assert.equal(analysis.commerceBrief.uncertainties[0], "未看到明确价格信息");
  assert.equal(analysis.boundaries.length, 1);
  assert.equal(analysis.boundaries[0].timestamp, 1.2);
  assert.equal(analysis.shots[0].summary, "包装上的卤鳗鱼特写");
  assert.equal(analysis.shots[0].endBoundaryReason, "包装特写切到手持展示");
  assert.equal(analysis.shots[1].summary, "手持多包鳗鱼展示");
  assert.equal(analysis.shots[1].endBoundaryReason, null);
});

test("processed shot analysis tolerates incomplete commerceBrief on legacy path", () => {
  const artifact = createArtifact();
  const prepared = prepareInput(artifact, 1, { runtimeRoot: "C:\\Runtime" });
  const contactSheets = createContactSheets(prepared, path.join("C:\\Runtime", "Artifacts", "sample_1"));
  const analysis = buildProcessedAnalysis(
    JSON.stringify({
      commerceBrief: {
        sellingObject: "多功能收纳盒".repeat(30),
        uncertainties: "invalid",
      },
      boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "展示角度变化", needReview: false }],
      shots: [{ summary: "桌面收纳盒展示" }],
    }),
    prepared,
    contactSheets,
    { artifactId: "artifact_shot", skillPath: "SKILL.md", skillHash: "hash" },
    { thread_id: "thread_1", lease_id: "lease_1" },
    { turnId: "turn_1" },
  );

  assert.equal(analysis.commerceBrief, null);
});

test("processed shot analysis normalizes missing conversionAction to explicit fallback", () => {
  const artifact = createArtifact();
  const prepared = prepareInput(artifact, 3, { runtimeRoot: "C:\\Runtime" });
  const analysis = buildProcessedAnalysis(JSON.stringify({
    commerceBrief: {
      sellingObject: "零食礼包",
      proofApproach: "试吃展示",
      promisedOutcome: "快速了解口味",
      persuasionTarget: "想囤零食的人",
      conversionAction: "",
      uncertainties: [],
    },
    shots: [
      {
        summary: "人物半身口播",
        start: 0,
        end: 1.2,
        endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false },
      },
      {
        summary: "产品特写镜头",
        start: 1.2,
        end: 2,
        endBoundary: null,
      },
    ],
  }), prepared, createContactSheets(prepared, rootRuntime("commerce-fallback")), {
    artifactId: "artifact_test",
    roleProfile: { profileVersion: "2026-05-22.2" },
    promptTemplate: { promptTemplateId: "analyze", promptTemplateVersion: "analyze.v2", promptTemplateHash: "hash_1" },
    skillHash: "skill_hash_1",
  }, { thread_id: "thread_1", lease_id: "lease_1" }, { threadId: "thread_1", turnId: "turn_1" }, {
    resultOrigin: "new_turn",
    repairAttemptCount: 0,
  });

  assert.equal(analysis.commerceBrief.conversionAction, "未观察到明显转化动作");
});

test("processed shot analysis rejects invalid commerceBrief uncertainties type on strict path", () => {
  const artifact = createArtifact();
  const prepared = prepareInput(artifact, 3, { runtimeRoot: "C:\\Runtime" });
  assert.throws(() => buildProcessedAnalysis(JSON.stringify({
    commerceBrief: {
      sellingObject: "零食礼包",
      proofApproach: "试吃展示",
      promisedOutcome: "快速了解口味",
      persuasionTarget: "想囤零食的人",
      conversionAction: "下单试吃",
      uncertainties: "invalid",
    },
    shots: [
      {
        summary: "人物半身口播",
        start: 0,
        end: 1.2,
        endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false },
      },
      {
        summary: "产品特写镜头",
        start: 1.2,
        end: 2,
        endBoundary: null,
      },
    ],
  }), prepared, createContactSheets(prepared, rootRuntime("commerce-invalid")), {
    artifactId: "artifact_test",
    roleProfile: { profileVersion: "2026-05-22.2" },
    promptTemplate: { promptTemplateId: "analyze", promptTemplateVersion: "analyze.v2", promptTemplateHash: "hash_1" },
    skillHash: "skill_hash_1",
  }, { thread_id: "thread_1", lease_id: "lease_1" }, { threadId: "thread_1", turnId: "turn_1" }, {
    resultOrigin: "new_turn",
    repairAttemptCount: 0,
  }), /commerceBrief/);
});

test("processed shot analysis does not fallback to legacy boundaries when v2 shots are invalid", () => {
  const artifact = createArtifact();
  const prepared = prepareInput(artifact, 1, { runtimeRoot: "C:\\Runtime" });
  const contactSheets = createContactSheets(prepared, path.join("C:\\Runtime", "Artifacts", "sample_1"));

  assert.throws(
    () => buildProcessedAnalysis(
      JSON.stringify({
        shots: [
          {
            summary: "首镜",
            start: 0.2,
            end: 1.2,
            endBoundary: {
              timestamp: 1.2,
              confidence: 0.8,
              boundaryType: "hard_cut",
              reason: "错误首镜起点",
              needReview: false,
            },
          },
          {
            summary: "尾镜",
            start: 1.2,
            end: 2,
            endBoundary: null,
          },
        ],
        boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "legacy fallback", needReview: false }],
      }),
      prepared,
      contactSheets,
      { artifactId: "artifact_shot", skillPath: "SKILL.md", skillHash: "hash", promptTemplate: { promptTemplateVersion: "analyze.v2" } },
      { thread_id: "thread_1", lease_id: "lease_1" },
      { turnId: "turn_1" },
    ),
    (error) => {
      assert.equal(error.code, "shot_boundary_validation_failed");
      assert.equal(error.debugPayload.outputSchemaVersion, "shot-centric.v2");
      assert.equal(error.debugPayload.validation.validatorCode, "shot_boundary_first_shot_start_invalid");
      return true;
    },
  );
});

test("subtitle hash participates in shot boundary cache params", () => {
  const artifactA = createArtifact({
    subtitleStatus: "processed",
    subtitleSegments: [{ id: "subtitle_1", start: 0, end: 1, text: "第一版字幕", confidence: null }],
  });
  const artifactB = createArtifact({
    subtitleStatus: "processed",
    subtitleSegments: [{ id: "subtitle_1", start: 0, end: 1, text: "第二版字幕", confidence: null }],
  });
  const preparedA = prepareInput(artifactA, 1, { runtimeRoot: "C:\\Runtime" });
  const preparedB = prepareInput(artifactB, 1, { runtimeRoot: "C:\\Runtime" });
  const contactSheetsA = createContactSheets(preparedA, path.join("C:\\Runtime", "Artifacts", "sample_1"));
  const contactSheetsB = createContactSheets(preparedB, path.join("C:\\Runtime", "Artifacts", "sample_1"));
  const paramsA = buildShotBoundaryCacheParams({
    sourceArtifactId: preparedA.sourceArtifactId,
    extractSampling: preparedA.extractSampling,
    analysisSampling: preparedA.analysisSampling,
    frameDimensions: preparedA.frameDimensions,
    contactSheets: contactSheetsA,
    subtitleContextSummary: preparedA.subtitleContextSummary,
    skillHash: "skill_hash",
  });
  const paramsB = buildShotBoundaryCacheParams({
    sourceArtifactId: preparedB.sourceArtifactId,
    extractSampling: preparedB.extractSampling,
    analysisSampling: preparedB.analysisSampling,
    frameDimensions: preparedB.frameDimensions,
    contactSheets: contactSheetsB,
    subtitleContextSummary: preparedB.subtitleContextSummary,
    skillHash: "skill_hash",
  });

  assert.equal(paramsA.subtitleArtifactId, "artifact_subtitle");
  assert.equal(paramsA.subtitleSegmentCount, 1);
  assert.notEqual(paramsA.subtitleTextHash, paramsB.subtitleTextHash);
});

test("review mode participates in shot boundary cache params", () => {
  const common = {
    sourceArtifactId: "artifact_sample",
    analysisSampling: { fps: 3 },
    subtitleContextSummary: { subtitleArtifactId: null, subtitleSegmentCount: 0, subtitleTextHash: null, truncated: false },
    skillHash: "skill_hash",
  };
  const reviewed = buildShotBoundaryCacheParams({ ...common, reviewMode: "reviewed" });
  const unreviewed = buildShotBoundaryCacheParams({ ...common, reviewMode: "unreviewed" });

  assert.equal(reviewed.reviewMode, "reviewed");
  assert.equal(unreviewed.reviewMode, "unreviewed");
  assert.notDeepEqual(reviewed, unreviewed);
});

test("revised subtitle artifact participates in shot boundary subtitle context summary", () => {
  const artifact = createArtifact({
    subtitleStatus: "processed",
    subtitleArtifactId: "artifact_subtitle_revision_1",
    subtitleParentArtifactId: "artifact_subtitle_recognition",
    subtitleSource: "manual_edit",
    subtitleRevisionIndex: 1,
    subtitleRevisionOfArtifactId: "artifact_subtitle_recognition",
    subtitleSegments: [{ id: "subtitle_1", start: 0, end: 1, text: "手改后的字幕版本", confidence: null }],
  });
  const prepared = prepareInput(artifact, 1, { runtimeRoot: "C:\\Runtime" });

  assert.equal(prepared.subtitleContextSummary.subtitleArtifactId, "artifact_subtitle_revision_1");
  assert.equal(prepared.subtitleContextSummary.subtitleSegmentCount, 1);
  assert.ok(prepared.subtitleContextSummary.subtitleTextHash);
});

test("thread conversation summary keeps compact turn-safe fields", () => {
  const summary = summarizeThreadConversation({
    id: "thread_1",
    title: "shot-boundary-transformer",
    status: "idle",
    turns: [
      {
        id: "turn_1",
        status: "completed",
        createdAt: "2026-05-21T10:00:00.000Z",
        items: [
          { type: "userMessage", text: "请分析这段视频的镜头变化和语义" },
          { type: "agentMessage", text: "已完成，输出 JSON。" },
        ],
        last_token_usage: { input_tokens: 120, output_tokens: 45, total_tokens: 165 },
      },
    ],
  });

  assert.equal(summary.threadId, "thread_1");
  assert.equal(summary.turns[0].turnId, "turn_1");
  assert.match(summary.turns[0].inputSummary, /请分析这段视频/);
  assert.match(summary.turns[0].finalMessage, /已完成/);
  assert.equal(summary.turns[0].tokenUsage.totalTokens, 165);
});

test("threadpool role status removes init prompt and keeps safe summary", () => {
  const status = sanitizeRoleStatus({
    ok: true,
    role: "shot-boundary-transformer",
    min_idle: 1,
    init_prompt: "very long prompt",
    skill_path: "C:\\x\\shot-boundary-transformer\\SKILL.md",
    counts: { idle: 1, leased: 0 },
    seed_thread_id: "thread_seed",
    can_acquire: true,
    can_init: true,
    thread_entries: [
      { thread_id: "thread_seed", thread_status: "idle", is_seed: true },
      { thread_id: "thread_1", thread_status: "idle", lease_id: null, is_seed: false, latest_input_tokens: 700, threshold_input_tokens: 1000, last_owner_id: "owner_1" },
    ],
    active_leases: [],
  });
  assert.equal(status.config.skill_path, "SKILL.md");
  assert.equal(status.config.profile_path, null);
  assert.equal(status.config.profile_version, null);
  assert.equal("init_prompt" in status, false);
  assert.equal(status.threads[0].seed, true);
  assert.equal(status.threads[1].status, "idle");
  assert.equal(status.threads[1].seed, false);
  assert.equal(status.threads[1].latest_input_tokens, 700);
  assert.equal(status.threads[1].threshold_input_tokens, 1000);
  assert.equal(status.threads[1].last_owner_id, "owner_1");
  assert.equal(status.canInit, true);
});

test("threadpool proxy filters roles outside the workspace allowlist", async () => {
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-transformer"],
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/health") {
        return response({ ok: true, roles: ["shot-boundary-transformer", "ae-precomp-design-producer"], warming_roles: ["ae-precomp-design-producer"] });
      }
      if (pathname === "/roles/shot-boundary-transformer/status") {
        return response({ ok: true, role: "shot-boundary-transformer", min_idle: 1, counts: { idle: 1, leased: 0 }, can_acquire: true, thread_entries: [{ thread_id: "thread_1", thread_status: "idle" }], active_leases: [] });
      }
      if (pathname === "/threads/thread_1/discard") return response({ ok: true, thread_id: "thread_1", status: "discarded" });
      return response({ ok: false, detail: "unexpected" }, 404);
    },
  });
  const roles = await proxy.roles();
  assert.deepEqual(roles.roles.map((role) => role.role), ["shot-boundary-transformer"]);
  assert.deepEqual(roles.health.warming_roles, []);
  const blocked = await proxy.roleStatus("ae-precomp-design-producer");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, "threadpool_role_not_allowed");
  const allowedThread = await proxy.findAllowedThread("thread_1");
  assert.equal(allowedThread.ok, true);
  const discarded = await proxy.discardThread({ threadId: "thread_1", reason: "test" });
  assert.equal(discarded.status, "discarded");
});

test("threadpool proxy backfills ctx usage from persisted token usage cache", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "threadpool-proxy-"));
  const tokenUsagePath = path.join(tempRoot, "thread_token_usage.json");
  await fs.writeFile(tokenUsagePath, JSON.stringify({
    thread_1: {
      latest: { last_token_usage: { input_tokens: 888, output_tokens: 12, total_tokens: 900 } },
      turns: {},
    },
  }), "utf8");
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-transformer"],
    threadTokenUsagePath: tokenUsagePath,
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/health") {
        return response({ ok: true, roles: ["shot-boundary-transformer"], warming_roles: [] });
      }
      if (pathname === "/roles/shot-boundary-transformer/status") {
        return response({
          ok: true,
          role: "shot-boundary-transformer",
          min_idle: 1,
          counts: { idle: 1, leased: 0 },
          can_acquire: true,
          thread_entries: [{ thread_id: "thread_1", thread_status: "idle", is_seed: false }],
          active_leases: [],
        });
      }
      return response({ ok: false, detail: "unexpected" }, 404);
    },
  });

  const status = await proxy.roleStatus("shot-boundary-transformer");
  assert.equal(status.threads[0].latest_input_tokens, 888);
});

test("threadpool proxy default allowlist follows thread role config", () => {
  assert.deepEqual(DEFAULT_ALLOWED_ROLES, [
    "script-segment-analyzer",
    "rhythm-structure-analyzer",
    "packaging-structure-analyzer",
    "shot-boundary-transformer",
  ]);
  const proxy = createThreadPoolProxy({ fetchImpl: async () => response({ ok: true }) });
  assert.deepEqual(proxy.allowedRoles, DEFAULT_ALLOWED_ROLES);
});

test("threadpool proxy timeout becomes unavailable payload", async () => {
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-transformer"],
    requestTimeoutMs: 10,
    fetchImpl: async (_url, options = {}) => new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  });

  const health = await proxy.health();

  assert.equal(health.ok, false);
  assert.equal(health.unavailable, true);
  assert.equal(health.error, "threadpool_unavailable");
  assert.match(health.message, /超时/);
  assert.equal(health.request.requestTimeoutMs, 10);
  assert.equal(health.request.pathname, "/health");
  assert.equal(health.request.method, "GET");
});

test("threadpool proxy acquire lease uses dedicated timeout", async () => {
  const requests = [];
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-transformer"],
    requestTimeoutMs: 3000,
    leaseAcquireTimeoutMs: 90000,
    fetchImpl: async (url, options = {}) => {
      requests.push({
        pathname: new URL(url).pathname,
        method: options.method,
      });
      return response({ ok: true, lease_id: "lease_1", thread_id: "thread_1" });
    },
  });

  await proxy.acquireLease({ role: "shot-boundary-transformer", ownerId: "trace_1" });

  assert.equal(proxy.requestTimeoutMs, 3000);
  assert.equal(proxy.leaseAcquireTimeoutMs, 90000);
  assert.deepEqual(requests, [{ pathname: "/leases/acquire", method: "POST" }]);
});

test("threadpool proxy default lease timeout leaves headroom for seed initialization wait", async () => {
  const proxy = createThreadPoolProxy({ fetchImpl: async () => response({ ok: true }) });

  assert.ok(proxy.leaseAcquireTimeoutMs > 90000);
});

test("threadpool acquire retries warming until role becomes ready", async () => {
  const { acquireLeaseWithRetry } = require("../../Apps/Api/lib/shot-boundary/threadpool-runner");
  let readinessCalls = 0;
  let acquireCalls = 0;
  const releasedOwners = [];
  const threadPool = {
    leaseAcquireTimeoutMs: 90000,
    ensureRoleReady: async () => {
      readinessCalls += 1;
      if (readinessCalls < 3) {
        return {
          ok: false,
          error: "threadpool_warming",
          message: "ThreadPool 正在 warming，请稍后再试",
          retryable: true,
          detail: { role: "script-segment-analyzer", warming: true, canAcquire: false, readyForLeases: true },
        };
      }
      return {
        ok: true,
        status: { role: "script-segment-analyzer", warming: false, canAcquire: true, readyForLeases: true },
      };
    },
    acquireLease: async () => {
      acquireCalls += 1;
      if (acquireCalls < 3) {
        throw Object.assign(new Error("thread pool role is warming: seed is still initializing"), {
          code: "threadpool_acquire_failed",
          request: { requestTimeoutMs: 90000 },
        });
      }
      return { ok: true, lease_id: "lease_1", thread_id: "thread_1" };
    },
    releaseOwnerLeases: async (ownerId) => {
      releasedOwners.push(ownerId);
      return { ok: true };
    },
  };

  const result = await acquireLeaseWithRetry(threadPool, {
    role: "script-segment-analyzer",
    ownerId: "trace_1",
    backoffMs: [0],
    codedError: (code, message, debugPayload, retryable) => Object.assign(new Error(message), { code, debugPayload, retryable }),
  });

  assert.equal(result.lease.lease_id, "lease_1");
  assert.equal(readinessCalls, 3);
  assert.equal(acquireCalls, 3);
  assert.deepEqual(releasedOwners, ["trace_1", "trace_1"]);
  assert.equal(result.attemptCount, 3);
});

test("appserver bridge defaults to in-repo python runtime root", () => {
  const bridge = createAppServerBridge({ python: "python" });
  assert.equal(bridge.pythonRuntimeRoot, DEFAULT_PYTHON_RUNTIME_ROOT);
  assert.match(DEFAULT_PYTHON_RUNTIME_ROOT, /Infrastructure[\\/]AgentRuntime$/);
});

test("shot boundary raw submit starts standalone thread and sends fixed mp4 path text", async () => {
  const rawAnalysisWorkspaceRoot = path.join(os.tmpdir(), "codex-raw-workspace");
  const harness = await createShotHarness({
    rawAnalysisWorkspaceRoot,
    artifact: createArtifact({
      subtitleStatus: "processed",
      subtitleSegments: [
        { id: "subtitle_1", start: 0, end: 1.1, text: "这是包装上的鳗鱼", confidence: null },
        { id: "subtitle_2", start: 1.2, end: 2, text: "手里展示多袋包装", confidence: null },
      ],
    }),
    appServer: {
      startThread: async () => ({ ok: true, threadId: "thread_raw_1", status: "created" }),
      startTurnWithInputs: async ({ threadId }) => ({ ok: true, threadId, turnId: "turn_raw_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: false, threadId: "thread_raw_1", turnId: "turn_raw_1", status: "running", finalMessage: "" }),
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);
  const rawTurn = harness.startedTurns.find((item) => item.kind === "shot");

  assert.equal(harness.startedThreads.length, 1);
  assert.equal(harness.startedThreads[0].workspaceRoot, rawAnalysisWorkspaceRoot);
  assert.equal(rawTurn != null, true);
  assert.equal(rawTurn.payload.threadId, "thread_raw_1");
  assert.equal(rawTurn.payload.workspaceRoot, rawAnalysisWorkspaceRoot);
  assert.equal(rawTurn.payload.inputs.length, 1);
  assert.equal(rawTurn.payload.inputs[0].type, "text");
  assert.match(rawTurn.payload.inputs[0].text, /请使用 Video-shot skill 执行原始视频切镜/);
  assert.match(rawTurn.payload.inputs[0].text, new RegExp(escapeRegExp(path.join(harness.store.runtimeRoot, "source.mp4"))));
  assert.match(rawTurn.payload.inputs[0].text, /不查仓库、不调用其他技能、不看工作区项目实现/);
  assert.match(rawTurn.payload.skillPath, /[\\\/]\.agents[\\\/]skills[\\\/]video-shot[\\\/]SKILL\.md$/);
  assert.equal(job.status, "processing");
  assert.equal(job.agentRun.threadId, "thread_raw_1");
  assert.equal(job.agentRun.leaseId, null);
  assert.equal(job.agentRun.turnId, "turn_raw_1");
  assert.equal(job.agentRun.inputMode, "raw_video_path_text");
  assert.deepEqual(job.agentRun.rawVideoPathInfo, { resolved: true, basename: "source.mp4" });
  assert.equal(harness.threadPool.released.length, 0);
});

test("shot boundary transform collect polls running turn and preserves active message", async () => {
  let transformCollectCount = 0;
  const transformMessages = [];
  const rawAnalysisWorkspaceRoot = path.join(os.tmpdir(), "codex-raw-workspace");
  const harness = await createShotHarness({
    rawAnalysisWorkspaceRoot,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_raw_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        transformCollectCount += 1;
        if (transformCollectCount === 1) {
          return { ok: false, threadId, turnId, status: "running", finalMessage: "", activeThreadMessage: "transform 正在整理切镜结果" };
        }
        if (transformCollectCount === 2) {
          return { ok: false, threadId, turnId, status: "running", finalMessage: "", activeThreadMessage: "" };
        }
        return { ok: true, threadId, turnId, status: "completed", finalMessage: createTransformMessage() };
      },
    },
    reviewPollIntervalMs: 0,
  });

  const originalUpdateJob = harness.jobStore.updateJob;
  harness.jobStore.updateJob = (jobId, patch) => {
    const updated = originalUpdateJob(jobId, patch);
    if (Object.prototype.hasOwnProperty.call(patch, "activeThreadMessage")) {
      transformMessages.push(updated?.activeThreadMessage ?? null);
    }
    return updated;
  };

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const job = harness.jobStore.getJob(result.processingJobId);
  const rawTurn = harness.startedTurns.find((item) => item.kind === "shot");
  const transformTurn = harness.startedTurns.find((item) => item.kind === "transform");
  const collectLogs = harness.logger.logs.filter((entry) => entry.stageName === STAGES.reviewCollected && entry.event === "stage.end");
  const visualCollectLogs = harness.logger.logs.filter((entry) => entry.stageName === STAGES.visualSummaryCollected && entry.event === "stage.end");

  assert.equal(rawTurn.payload.workspaceRoot, rawAnalysisWorkspaceRoot);
  assert.equal(transformTurn.payload.workspaceRoot, harness.rootDir);
  assert.equal(transformCollectCount, 4);
  assert.equal(collectLogs.length, 3);
  assert.deepEqual(collectLogs.map((entry) => entry.outputSummary.attempt), [1, 2, 3]);
  assert.equal(visualCollectLogs.length, 1);
  assert.ok(transformMessages.some((message) => message?.text === "transform 正在整理切镜结果"));
  assert.equal(job.status, "processed");
  assert.equal(job.activeThreadMessage, null);
});

test("shot boundary collect completed writes transformed artifact and releases only transformer lease", async () => {
  const harness = await createShotHarness({
    artifact: createArtifact({
      subtitleStatus: "processed",
      subtitleSegments: [
        { id: "subtitle_1", start: 0, end: 1.1, text: "这是包装上的鳗鱼", confidence: null },
        { id: "subtitle_2", start: 1.2, end: 2, text: "手里展示多袋包装", confidence: null },
      ],
    }),
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_raw_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return { ok: true, threadId, turnId, status: "completed", finalMessage: createTransformMessage() };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);
  const transformTurns = harness.startedTurns.filter((item) => item.kind === "transform");
  const transformTurn = transformTurns[0];
  const visualSummaryTurn = transformTurns[1];

  assert.equal(job.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.resultOrigin, "transformed_turn");
  assert.equal(artifact.shotBoundaryAnalysis.agent.role, "shot-boundary-transformer");
  assert.equal(artifact.shotBoundaryAnalysis.agent.threadId, "review_thread_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.leaseId, "review_lease_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, "turn_transform_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.promptTemplateId, "transform");
  assert.equal(artifact.shotBoundaryAnalysis.agent.profileVersion, "2026-05-24.2");
  assert.equal(artifact.shotBoundaryAnalysis.agent.inputMode, "raw_video_path_text");
  assert.equal(artifact.shotBoundaryAnalysis.agent.rawAnalyzer.phase, "raw_video_analyze");
  assert.equal(artifact.shotBoundaryAnalysis.agent.rawAnalyzer.threadId, "thread_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.rawAnalyzer.turnId, "turn_raw_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.rawAnalyzer.leaseId, null);
  assert.equal(artifact.shotBoundaryAnalysis.agent.rawAnalyzer.inputMode, "raw_video_path_text");
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.length, 4);
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.some((sheet) => sheet.sheetPurpose === "shot_boundary_result_sheet"), true);
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.every((sheet) => sheet.localImagePath === undefined), true);
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.every((sheet) => (sheet.gridItems ?? []).every((item) => item.filePath === undefined)), true);
  assert.equal(artifact.shotBoundaryAnalysis.boundaries.length, 1);
  assert.equal(artifact.shotBoundaryAnalysis.shots[0].summary, "turn_transform 人物半身面对镜头");
  assert.equal(artifact.shotBoundaryAnalysis.shots[1].summary, "turn_transform 产品包装特写");
  assert.equal(Object.prototype.hasOwnProperty.call(artifact.shotBoundaryAnalysis.commerceBrief, "videoSummary"), false);
  assert.equal(transformTurns.length, 2);
  assert.equal(transformTurn.payload.inputs.length, 1);
  assert.equal(transformTurn.payload.inputs[0].type, "text");
  assert.equal(transformTurn.payload.inputs.filter((item) => item.type === "localImage").length, 0);
  assert.equal(visualSummaryTurn.payload.inputs.length, 5);
  assert.equal(visualSummaryTurn.payload.inputs[0].type, "text");
  assert.equal(visualSummaryTurn.payload.inputs.filter((item) => item.type === "localImage").length, 4);
  assert.match(transformTurn.payload.inputs[0].text, /结果转换 agent/);
  assert.match(transformTurn.payload.inputs[0].text, /rawAnalyzerResult/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /subtitleContext/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /这是包装上的鳗鱼/);
  assert.match(visualSummaryTurn.payload.inputs[0].text, /script-segment-analyzer/);
  assert.match(visualSummaryTurn.payload.inputs[0].text, /只写视觉画面内容/);
  assert.match(visualSummaryTurn.payload.inputs[0].text, /subtitleText/);
  assert.match(visualSummaryTurn.payload.inputs[0].text, /这是包装上的鳗鱼/);
  assert.match(visualSummaryTurn.payload.inputs[0].text, /手里展示多袋包装/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /shots\[\]\.endBoundary\.reason/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /textLength/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /inputIndex/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /sourceFrameIndex/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /fileName/);
  assert.equal(harness.threadPool.released.length, 1);
  assert.deepEqual(harness.threadPool.released[0], { leaseId: "review_lease_1", ownerId: `${result.traceId}:transform`, thread_status: "idle" });
  assert.deepEqual(harness.threadPool.ownerReleased, []);
  assert.deepEqual(harness.threadPool.discarded, []);
});

test("shot boundary skill content change misses old shot cache", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "shot-skill-hash-"));
  const skillPath = path.join(tempRoot, "SKILL.md");
  await fs.writeFile(skillPath, "new skill content", "utf8");
  const oldSkillHash = hashText("old skill content");
  let shotStartTurnCount = 0;
  const cacheLookups = [];
  const harness = await createShotHarness({
    skillPath,
    artifactIndex: {
      findCacheEntry: async ({ params }) => {
        cacheLookups.push(params);
        return params.skillHash === oldSkillHash ? { sampleVideoId: "sample_cached", cacheKey: "old_cache" } : null;
      },
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (!isTransformTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);

  assert.ok(cacheLookups.length >= 1);
  const currentLookup = cacheLookups[0];
  assert.equal(currentLookup.profileVersion, "2026-05-24.2");
  assert.equal(currentLookup.promptTemplateId, "transform");
  assert.equal(currentLookup.promptTemplateVersion, "transform.v1");
  assert.ok(currentLookup.promptTemplateHash);
  assert.equal("initFingerprint" in currentLookup, false);
  assert.ok(currentLookup.skillHash);
  assert.notEqual(currentLookup.skillHash, oldSkillHash);
  assert.equal(shotStartTurnCount, 1);
});

test("shot boundary cache hit skips turn and writes cache reuse log", async () => {
  let shotStartTurnCount = 0;
  const cachedAnalysis = createCachedShotAnalysis();
  const harness = await createShotHarness({
    artifactIndex: {
      findCacheEntry: async () => ({ sampleVideoId: "sample_cached", cacheKey: "cache_1" }),
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: cachedAnalysis }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (!isTransformTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);
  const cacheLookupLog = harness.logger.logs.find((entry) => entry.stageName === STAGES.cacheLookup && entry.event === "stage.end" && entry.outputSummary?.cacheLookup === "miss");

  assert.equal(shotStartTurnCount, 1);
  assert.equal(job.status, "processing");
  assert.equal(artifact.shotBoundaryAnalysis, undefined);
  assert.equal(cacheLookupLog.outputSummary.reason, "eligibility_rejected");
});

test("shot boundary valid cache can be reused", async () => {
  let shotStartTurnCount = 0;
  const cachedAnalysis = createValidCachedShotAnalysis();
  const harness = await createShotHarness({
    artifactIndex: {
      findCacheEntry: async () => ({ sampleVideoId: "sample_cached", cacheKey: "cache_1" }),
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: cachedAnalysis }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (!isTransformTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const waitingJob = harness.jobStore.getJob(result.processingJobId);
  assert.equal(waitingJob.status, "cache_waiting");
  assert.equal(waitingJob.cachePrompt.cachedItem.analysisFps, 3);
  assert.equal(waitingJob.cachePrompt.profileVersion, "2026-05-24.2");
  assert.equal(waitingJob.cachePrompt.promptTemplateId, "transform");
  assert.equal(waitingJob.cachePrompt.promptTemplateVersion, "transform.v1");
  assert.ok(waitingJob.cachePrompt.promptTemplateHash);
  assert.ok(waitingJob.cachePrompt.initFingerprint);
  await harness.service.resolveCacheDecision({ jobId: result.processingJobId, decision: "reuse" });
  await delay(20);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);
  const cacheReuseLog = harness.logger.logs.find((entry) => entry.stageName === STAGES.cacheReuse && entry.event === "stage.end");

  assert.equal(shotStartTurnCount, 0);
  assert.equal(job.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.resultOrigin, "cache_reuse");
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, "turn_transform_cached");
  assert.equal(cacheReuseLog.outputSummary.sourceSampleVideoId, "sample_cached");
  assert.equal(cacheReuseLog.outputSummary.cacheKey, "cache_1");
  assert.equal(cacheReuseLog.outputSummary.sourceTurnId, "turn_transform_cached");
  assert.equal(cacheReuseLog.outputSummary.analysisFps, 3);
  assert.equal(cacheReuseLog.outputSummary.boundaryCount, 1);
  assert.equal(cacheReuseLog.outputSummary.shotCount, 2);
});

test("shot boundary registers reusable cache for the same service run", async () => {
  let shotStartTurnCount = 0;
  const harness = await createShotHarness({
    useRealArtifactIndex: true,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: `turn_${shotStartTurnCount}`, status: "submitted" };
      },
      collectTurnResult: async ({ turnId }) => {
        if (turnId === "turn_1") return { ok: true, threadId: "thread_1", turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return {
          ok: true,
          threadId: "review_thread_1",
          turnId,
          status: "completed",
          finalMessage: createTransformMessage(),
        };
      },
    },
  });

  const first = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(first.processingJobId);
  const second = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const secondJob = harness.jobStore.getJob(second.processingJobId);

  assert.equal(secondJob.status, "cache_waiting");
  assert.equal(secondJob.cachePrompt.cachedItem.analysisFps, 3);
  assert.equal(shotStartTurnCount, 1);
});

test("shot boundary cache lookup no longer falls back to legacy promptless cache params", async () => {
  const cacheEntries = new Map();
  const stableKey = (fileHash, stageName, params) => JSON.stringify({ fileHash, stageName, params });
  const cachedAnalysis = createValidCachedShotAnalysis();
  const harness = await createShotHarness({
    artifactIndex: {
      getItem: async () => ({ fileHash: "hash_1" }),
      findCacheEntry: async ({ fileHash, stageName, params }) => cacheEntries.get(stableKey(fileHash, stageName, params)) ?? null,
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: cachedAnalysis }),
      registerSampleArtifact: async () => ({ ok: true }),
    },
  });
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const prepared = prepareInput(artifact, 3, { runtimeRoot: harness.store.runtimeRoot });
  const contactSheets = createContactSheets(prepared, harness.store.sampleDir("sample_1"));
  const legacyParams = stripPromptFingerprint(buildShotBoundaryCacheParams({
    sourceArtifactId: prepared.sourceArtifactId,
    extractSampling: prepared.extractSampling,
    analysisSampling: prepared.analysisSampling,
    frameDimensions: prepared.frameDimensions,
    contactSheets,
    subtitleContextSummary: prepared.subtitleContextSummary,
    skillHash: await resolveSkillHash(),
  }));
  cacheEntries.set(stableKey("hash_1", STAGES.resultWritten, legacyParams), { sampleVideoId: "sample_cached", cacheKey: "legacy_cache" });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);
  const cacheLookupLog = harness.logger.logs.find((entry) => entry.stageName === STAGES.cacheLookup && entry.event === "stage.end");

  assert.notEqual(job.status, "cache_waiting");
  assert.equal(cacheLookupLog.outputSummary.cacheLookup, "miss");
  assert.equal(cacheLookupLog.outputSummary.reason, "key_miss");
});

test("shot boundary cache decision refresh continues same job and trace", async () => {
  let shotStartTurnCount = 0;
  const harness = await createShotHarness({
    artifactIndex: {
      findCacheEntry: async () => ({ sampleVideoId: "sample_cached", cacheKey: "cache_1" }),
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: createValidCachedShotAnalysis() }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (!isTransformTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const waitingJob = harness.jobStore.getJob(result.processingJobId);
  await harness.service.resolveCacheDecision({ jobId: result.processingJobId, decision: "refresh" });
  await delay(20);
  const refreshedJob = harness.jobStore.getJob(result.processingJobId);

  assert.equal(waitingJob.status, "cache_waiting");
  assert.equal(refreshedJob.traceId, result.traceId);
  assert.equal(refreshedJob.jobId, result.processingJobId);
  assert.equal(refreshedJob.status, "processing");
  assert.equal(shotStartTurnCount, 1);
});

test("same fps lookup reuses registered shot cache params while different fps misses", async () => {
  const cacheEntries = new Map();
  const stableKey = (fileHash, stageName, params) => JSON.stringify({
    fileHash,
    stageName,
    params,
  });
  let shotStartTurnCount = 0;
  const harness = await createShotHarness({
    artifactIndex: {
      getItem: async () => ({ fileHash: "hash_1" }),
      findCacheEntry: async ({ fileHash, stageName, params }) => cacheEntries.get(stableKey(fileHash, stageName, params)) ?? null,
      loadItem: async (sampleVideoId) => sampleVideoId === "sample_cached" ? { ...createArtifact(), sampleVideoId, shotBoundaryAnalysis: createValidCachedShotAnalysis({ analysisFps: 1 }) } : null,
      registerSampleArtifact: async ({ artifact }) => {
        const params = buildShotBoundaryCacheParams({
          sourceArtifactId: artifact.shotBoundaryAnalysis.parentArtifactId,
          extractSampling: artifact.shotBoundaryAnalysis.extractSampling,
          analysisSampling: artifact.shotBoundaryAnalysis.analysisSampling,
          frameDimensions: { width: artifact.metadata.width, height: artifact.metadata.height },
          contactSheets: artifact.shotBoundaryAnalysis.contactSheets,
          profileVersion: artifact.shotBoundaryAnalysis.agent.profileVersion,
          promptTemplateId: artifact.shotBoundaryAnalysis.agent.promptTemplateId,
          promptTemplateVersion: artifact.shotBoundaryAnalysis.agent.promptTemplateVersion,
          promptTemplateHash: artifact.shotBoundaryAnalysis.agent.promptTemplateHash,
          initFingerprint: artifact.shotBoundaryAnalysis.agent.initFingerprint,
          skillHash: artifact.shotBoundaryAnalysis.agent.skillHash,
        });
        cacheEntries.set(stableKey("hash_1", STAGES.resultWritten, params), { sampleVideoId: "sample_cached", cacheKey: "cache_registered" });
        return { ok: true };
      },
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (!isTransformTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
      collectTurnResult: async ({ turnId }) => {
        if (turnId === "turn_1") {
          return { ok: true, threadId: "thread_1", turnId, status: "completed", finalMessage: "raw analyzer finished" };
        }
        return { ok: true, threadId: "review_thread_1", turnId, status: "completed", finalMessage: createTransformMessage() };
      },
    },
  });

  const first = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(first.processingJobId);
  const second = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1, cacheDecision: "ask" });
  await delay(20);
  const third = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 2, cacheDecision: "ask" });
  await delay(20);
  const secondJob = harness.jobStore.getJob(second.processingJobId);
  const thirdJob = harness.jobStore.getJob(third.processingJobId);

  assert.equal(shotStartTurnCount, 2);
  assert.equal(secondJob.status, "cache_waiting");
  assert.equal(secondJob.cachePrompt.cachedItem.analysisFps, 1);
  assert.notEqual(thirdJob.status, "cache_waiting");
});

test("cache miss log distinguishes key miss from eligibility rejection", async () => {
  const harness = await createShotHarness({
    artifactIndex: {
      getItem: async () => ({ fileHash: "hash_1" }),
      findCacheEntry: async ({ params }) => (params.analysisFps === 1 ? { sampleVideoId: "sample_cached", cacheKey: "cache_bad" } : null),
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: createCachedShotAnalysis() }),
    },
  });

  await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1, cacheDecision: "ask" });
  await delay(20);
  await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 2, cacheDecision: "ask" });
  await delay(20);
  const cacheLogs = harness.logger.logs.filter((entry) => entry.stageName === STAGES.cacheLookup && entry.event === "stage.end");

  assert.equal(cacheLogs.some((entry) => entry.outputSummary?.reason === "eligibility_rejected"), true);
  assert.equal(cacheLogs.some((entry) => entry.outputSummary?.reason === "key_miss"), true);
});

test("shot boundary history appends for refresh and cache reuse without overwriting prior entries", async () => {
  const cacheEntries = new Map();
  const harness = await createShotHarness({
    artifactIndex: {
      getItem: async () => ({ fileHash: "hash_1" }),
      findCacheEntry: async ({ fileHash, stageName, params }) => cacheEntries.get(JSON.stringify({ fileHash, stageName, params })) ?? null,
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: createValidCachedShotAnalysis() }),
      registerSampleArtifact: async ({ artifact }) => {
        const params = buildShotBoundaryCacheParams({
          sourceArtifactId: artifact.shotBoundaryAnalysis.parentArtifactId,
          extractSampling: artifact.shotBoundaryAnalysis.extractSampling,
          analysisSampling: artifact.shotBoundaryAnalysis.analysisSampling,
          frameDimensions: { width: artifact.metadata.width, height: artifact.metadata.height },
          contactSheets: artifact.shotBoundaryAnalysis.contactSheets,
          profileVersion: artifact.shotBoundaryAnalysis.agent.profileVersion,
          promptTemplateId: artifact.shotBoundaryAnalysis.agent.promptTemplateId,
          promptTemplateVersion: artifact.shotBoundaryAnalysis.agent.promptTemplateVersion,
          promptTemplateHash: artifact.shotBoundaryAnalysis.agent.promptTemplateHash,
          initFingerprint: artifact.shotBoundaryAnalysis.agent.initFingerprint,
          skillHash: artifact.shotBoundaryAnalysis.agent.skillHash,
        });
        cacheEntries.set(JSON.stringify({ fileHash: "hash_1", stageName: STAGES.resultWritten, params }), { sampleVideoId: "sample_cached", cacheKey: "cache_registered" });
        return { ok: true };
      },
    },
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: `turn_${Date.now()}`, status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_history_1",
        status: "completed",
        finalMessage: JSON.stringify({ boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false }] }),
      }),
    },
  });

  const first = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(first.processingJobId);
  const second = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1, cacheDecision: "ask" });
  await delay(20);
  await harness.service.resolveCacheDecision({ jobId: second.processingJobId, decision: "reuse" });
  await delay(20);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(second.processingJobId != null, true);
  assert.equal(Array.isArray(artifact.shotBoundaryAnalysisHistory), true);
  assert.equal(artifact.shotBoundaryAnalysisHistory.length >= 2, true);
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-2).resultOrigin, "transformed_turn");
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-1).resultOrigin, "cache_reuse");
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-2).traceId, first.traceId);
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-1).traceId, second.traceId);
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-1).sourceTraceId, "trace_1");
});

test("shot boundary keeps Chinese reason text without mojibake", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return {
          ok: true,
          threadId,
          turnId,
          status: "completed",
          finalMessage: JSON.stringify({
            shots: [
              {
                summary: "镜头一",
                start: 0,
                end: 1.2,
                endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "未检测到明显视觉变化", needReview: false },
              },
              {
                summary: "镜头二",
                start: 1.2,
                end: 2,
                endBoundary: null,
              },
            ],
            commerceBrief: {
              sellingObject: "产品样例",
              proofApproach: "画面展示",
              promisedOutcome: "快速理解卖点",
              persuasionTarget: "潜在购买用户",
              conversionAction: "未观察到明显转化动作",
              uncertainties: [],
            },
          }),
        };
      },
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(artifact.shotBoundaryAnalysis.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.boundaries[0].reason, "未检测到明显视觉变化");
});

test("shot boundary collect retryable error keeps inflight processing", async () => {
  const error = new Error("missing-content-type");
  error.code = "appserver_bridge_failed";
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => { throw error; },
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const job = harness.jobStore.getJob(result.processingJobId);

  assert.equal(job.status, "processing");
  assert.equal(job.agentRun.status, "collecting");
  assert.equal(job.errorSummary.retryable, true);
  assert.equal(harness.threadPool.discarded.length, 0);
});

test("appserver bridge structured error payload is surfaced", async () => {
  const error = new Error("missing-content-type");
  const payload = structuredErrorForTest("appserver_bridge_failed", error, {
    operation: "readThread",
    threadId: "thread_1",
    turnId: "turn_1",
  });

  assert.deepEqual(payload, {
    ok: false,
    error: "appserver_bridge_failed",
    message: "Error: missing-content-type",
    operation: "readThread",
    threadId: "thread_1",
    turnId: "turn_1",
  });
});

test("threadpool readiness detail exposes ready_for_leases and recovering gate", async () => {
  const harness = await createShotHarness({
    threadPoolOverrides: {
      roleStatus: async () => ({
        ok: true,
        role: "shot-boundary-transformer",
        counts: { idle: 0, leased: 0 },
        minIdle: 1,
        canAcquire: false,
        canInit: false,
        warming: true,
        readyForLeases: false,
        recovering: true,
        warmupError: null,
        startupError: null,
        threads: [],
        leases: [],
      }),
    },
  });
  const status = await harness.threadPool.roleStatus("shot-boundary-transformer");

  assert.equal(status.readyForLeases, false);
  assert.equal(status.recovering, true);
  assert.equal(status.warming, true);
});

test("shot boundary parse failure writes failed artifact and debug snapshot", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return { ok: true, threadId, turnId, status: "completed", finalMessage: "not-json" };
      },
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);

  assert.equal(job.status, "failed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(artifact.shotBoundaryAnalysis.agent.threadId, "thread_1");
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.length, 0);
  assert.equal(harness.logger.snapshots.length, 1);
  assert.deepEqual(harness.threadPool.discarded, []);
  assert.deepEqual(harness.threadPool.released, [
    { leaseId: "review_lease_1", ownerId: `${result.traceId}:transform`, thread_status: "idle" },
  ]);
  assert.deepEqual(harness.threadPool.ownerReleased, []);
});

test("shot boundary mojibake reason fails quality gate and writes debug snapshot", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return {
          ok: true,
          threadId,
          turnId,
          status: "completed",
          finalMessage: JSON.stringify({
            shots: [
              {
                summary: "镜头一",
                start: 0,
                end: 1.2,
                endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "鏈娴嬪埌鏄庢樉瑙嗚鍙樺寲", needReview: false },
              },
              {
                summary: "镜头二",
                start: 1.2,
                end: 2,
                endBoundary: null,
              },
            ],
            commerceBrief: {
              sellingObject: "产品样例",
              proofApproach: "画面展示",
              promisedOutcome: "快速理解卖点",
              persuasionTarget: "潜在购买用户",
              conversionAction: "未观察到明显转化动作",
              uncertainties: [],
            },
          }),
        };
      },
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);
  const failLog = harness.logger.logs.find((entry) => entry.event === "stage.fail");

  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "agent_output_quality_failed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(harness.logger.snapshots.length, 1);
  assert.equal(failLog.stageName, STAGES.turnCollected);
  assert.equal(harness.logger.snapshots[0].debugPayload.turnId, "turn_transform_1");
  assert.match(harness.logger.snapshots[0].debugPayload.parseFailureReason, /mojibake/);
});

test("shot boundary recovery completes active inflight", async () => {
  const harness = await createShotHarness({
    appServer: {
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_1") {
          return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        }
        return { ok: true, threadId, turnId, status: "completed", finalMessage: createTransformMessage() };
      },
    },
  });
  const job = harness.jobStore.createJob({ sampleVideoId: "sample_1", traceId: "trace_recover" });
  harness.jobStore.updateJob(job.jobId, {
    status: "processing",
    stage: STAGES.turnStarted,
    progress: 80,
    agentRun: {
      provider: "codex-appserver",
      role: "raw_video_analyze",
      leaseId: null,
      threadId: "thread_1",
      turnId: "turn_1",
      traceId: "trace_recover",
      artifactId: "artifact_recover",
      parentArtifactId: "artifact_sample",
      sampleVideoId: "sample_1",
      analysisFps: 3,
      contactSheets: [],
      status: "turn_submitted",
      inputMode: "raw_video_path_text",
      rawVideoPathInfo: { resolved: true, basename: "source.mp4" },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  const recovered = await harness.service.recoverActiveAgentRuns();

  assert.equal(recovered.recovered, 1);
  assert.equal(harness.jobStore.getJob(job.jobId).status, "processed");
});

test("shot boundary startup interrupt fails active inflight without collecting old turn", async () => {
  let collectCalls = 0;
  const harness = await createShotHarness({
    appServer: {
      collectTurnResult: async () => {
        collectCalls += 1;
        throw new Error("should not collect during startup interrupt");
      },
    },
  });
  const job = harness.jobStore.createJob({ sampleVideoId: "sample_1", traceId: "trace_restart" });
  harness.jobStore.updateJob(job.jobId, {
    status: "processing",
    stage: STAGES.turnStarted,
    progress: 80,
    agentRun: {
      provider: "codex-appserver",
      role: "raw_video_analyze",
      leaseId: null,
      threadId: "thread_restart",
      turnId: "turn_restart",
      traceId: "trace_restart",
      artifactId: "artifact_restart",
      parentArtifactId: "artifact_sample",
      sampleVideoId: "sample_1",
      analysisFps: 3,
      contactSheets: [],
      status: "turn_submitted",
      inputMode: "raw_video_path_text",
      rawVideoPathInfo: { resolved: true, basename: "source.mp4" },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  const interrupted = await harness.service.interruptActiveAgentRuns("server-startup");
  const failed = harness.jobStore.getJob(job.jobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(interrupted.interruptedAgentRuns, 1);
  assert.equal(interrupted.interrupted, 0);
  assert.equal(collectCalls, 0);
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorSummary.code, "shot_boundary_job_interrupted");
  assert.equal(failed.errorSummary.retryable, true);
  assert.equal(failed.errorSummary.stageName, STAGES.turnCollected);
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.deepEqual(harness.cancelledTurns, [{
    workspaceRoot: "C:\\Users\\Administrator\\Documents\\Codex",
    threadId: "thread_restart",
    turnId: "turn_restart",
    timeoutSeconds: 30,
  }]);
  assert.deepEqual(harness.threadPool.released, []);
  assert.deepEqual(harness.threadPool.ownerReleased, ["trace_restart"]);
  assert.deepEqual(harness.startedTurns.filter((item) => item.kind === "transform"), []);
});

test("shot boundary fails before raw submit when mp4 path cannot be resolved", async () => {
  const harness = await createShotHarness({
    artifact: createArtifact({ originalVideoUri: "relative/source.mp4", normalizedVideoUri: "relative/source-normalized.mp4" }),
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const failLog = harness.logger.logs.find((entry) => entry.event === "stage.fail");

  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "shot_boundary_video_path_invalid");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(harness.startedThreads.length, 0);
  assert.equal(harness.startedTurns.length, 0);
  assert.equal(failLog.stageName, STAGES.turnStarted);
});

test("shot boundary recovery fails interrupted pre-agent job", async () => {
  const harness = await createShotHarness();
  const job = harness.jobStore.createJob({ sampleVideoId: "sample_1", traceId: "trace_interrupted" });
  harness.jobStore.updateJob(job.jobId, {
    status: "processing",
    stage: STAGES.threadAcquired,
    progress: 60,
  });
  const recovered = await harness.service.recoverActiveAgentRuns();
  const failed = harness.jobStore.getJob(job.jobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const failLog = harness.logger.logs.find((entry) => entry.event === "stage.fail");

  assert.equal(recovered.recovered, 0);
  assert.equal(recovered.interrupted, 1);
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorSummary.code, "shot_boundary_job_interrupted");
  assert.equal(failed.errorSummary.retryable, true);
  assert.equal(failed.errorSummary.stageName, STAGES.threadAcquired);
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(failLog.stageName, STAGES.threadAcquired);
  assert.deepEqual(harness.threadPool.ownerReleased, ["trace_interrupted"]);
});

test("threadpool owner release sends owner_id only", async () => {
  const requests = [];
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-transformer"],
    fetchImpl: async (url, options = {}) => {
      requests.push({ pathname: new URL(url).pathname, body: options.body ? JSON.parse(options.body) : null });
      return response({ ok: true, released: 1 });
    },
  });
  await proxy.releaseOwnerLeases("trace_1");

  assert.equal(requests[0].pathname, "/leases/release-owner");
  assert.deepEqual(requests[0].body, { owner_id: "trace_1" });
});

test("shot boundary success releases lease and thread returns idle", async () => {
  const harness = await createShotHarness({
    threadPoolConfig: { ok: true, discardOnRelease: false },
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return { ok: true, threadId, turnId, status: "completed", finalMessage: createTransformMessage() };
      },
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  for (let attempt = 0; attempt < 10 && harness.threadPool.released.length === 0; attempt += 1) {
    await delay(10);
  }

  assert.deepEqual(harness.threadPool.released.map((entry) => entry.ownerId), [`${result.traceId}:transform`]);
  assert.deepEqual(harness.threadPool.discarded, []);
  assert.deepEqual(harness.threadPool.ownerReleased, []);
});

test("shot boundary raw empty final message fails before transform", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "completed", finalMessage: "   " }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(job.status, "failed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(job.errorSummary.code, "shot_raw_video_analyze_empty_result");
  assert.equal(harness.startedTurns.filter((item) => item.kind === "transform").length, 0);
});

test("shot boundary transform repairs invalid shot-centric output once", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) {
          const turnIndex = harness.startedTurns.filter((item) => item.kind === "transform").length + 1;
          return { ok: true, threadId: "review_thread_1", turnId: `turn_transform_${turnIndex}`, status: "submitted" };
        }
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        if (turnId === "turn_transform_1") {
          return { ok: true, threadId, turnId, status: "completed", finalMessage: createInvalidTransformMessage() };
        }
        return { ok: true, threadId, turnId, status: "completed", finalMessage: createTransformMessage() };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const transformTurns = harness.startedTurns.filter((item) => item.kind === "transform");
  const repairTurn = transformTurns[1];
  const repairPrompt = repairTurn.payload.inputs[0].text;

  assert.equal(job.status, "processed");
  assert.equal(transformTurns.length, 3);
  assert.equal(artifact.shotBoundaryAnalysis.validation.repairAttemptCount, 1);
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, "turn_transform_2");
  assert.equal(artifact.shotBoundaryAnalysis.agent.promptTemplateId, "repair");
  assert.equal(artifact.shotBoundaryAnalysis.agent.promptTemplateVersion, "repair.v1");
  assert.match(repairPrompt, /校验失败摘要/);
  assert.match(repairPrompt, /shot_boundary_shot_not_contiguous/);
  assert.match(repairPrompt, /shots\[1\]/);
  assert.equal(harness.logger.logs.some((entry) => entry.stageName === STAGES.reviewRepairStarted && entry.event === "stage.end"), true);
  assert.equal(harness.logger.logs.some((entry) => entry.stageName === STAGES.reviewRepairValidated && entry.event === "stage.end"), true);
});

test("shot boundary transform legacy reviewer contract stays failed", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return { ok: true, threadId, turnId, status: "completed", finalMessage: JSON.stringify({ decision: "pass", issues: [] }) };
      },
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "shot_boundary_transform_legacy_review_result");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(artifact.shotBoundaryAnalysis.validation.validatorCode, "shot_boundary_transform_legacy_review_result");
});

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

function createTransformMessage() {
  return JSON.stringify({
    shots: [
      {
        summary: "turn_transform 人物半身面对镜头",
        start: 0,
        end: 1.2,
        endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", needReview: false },
      },
      {
        summary: "turn_transform 产品包装特写",
        start: 1.2,
        end: 2,
        endBoundary: null,
      },
    ],
    commerceBrief: {
      sellingObject: "产品样例",
      proofApproach: "画面展示",
      promisedOutcome: "快速理解卖点",
      persuasionTarget: "潜在购买用户",
      conversionAction: "未观察到明显转化动作",
      uncertainties: [],
    },
  });
}

function createInvalidTransformMessage() {
  return JSON.stringify({
    shots: [
      {
        summary: "人物半身面对镜头",
        start: 0,
        end: 1.2,
        endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", needReview: false },
      },
      {
        summary: "产品包装特写",
        start: 1.4,
        end: 2,
        endBoundary: null,
      },
    ],
    commerceBrief: {
      sellingObject: "产品样例",
      proofApproach: "画面展示",
      promisedOutcome: "快速理解卖点",
      persuasionTarget: "潜在购买用户",
      conversionAction: "未观察到明显转化动作",
      uncertainties: [],
    },
  });
}

function createShotMessage(label = "turn_shot") {
  return `补充说明\n${JSON.stringify({
    shots: [
      {
        summary: `${label} 人物半身口播`,
        start: 0,
        end: 1.2,
        endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false },
      },
      {
        summary: `${label} 产品特写镜头`,
        start: 1.2,
        end: 2,
        endBoundary: null,
      },
    ],
  })}\n已完成`;
}

function createCachedShotAnalysis() {
  return {
    artifactId: "artifact_cached_shot",
    parentArtifactId: "artifact_sample",
    type: "shot-boundary-analysis",
    status: "processed",
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
      fps: 3,
      requestedFps: 3,
      targetFrameCount: 6,
      selectedFrameCount: 6,
      effectiveFps: 3,
      selectionPolicy: "target_grid_nearest_unique",
      duplicatePolicy: "nearest_unselected_tie_later",
      roundingPolicy: "target_grid_nearest_unique",
    },
    subtitleContextSummary: null,
    contactSheets: [],
    boundaries: [],
    validation: { status: "passed", rawBoundaryCount: 0, normalizedBoundaryCount: 0, repairAttemptCount: 0, validatorCode: null },
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
    shots: [{ id: "shot_1", index: 0, shotNo: "S001", start: 0, end: 2, representativeFrameId: "frame_0", confidence: 0.4, reason: "未检测到明确切镜边界", summary: "未检测到明确切镜边界", endBoundaryReason: null }],
    createdAt: new Date().toISOString(),
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
