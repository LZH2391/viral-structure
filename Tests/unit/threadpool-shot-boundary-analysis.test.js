const { test, assert, fs, os, path, crypto, createJobStore, DEFAULT_PYTHON_RUNTIME_ROOT, createAppServerBridge, createShotBoundaryService, prepareInput, buildTurnInputs, renderAnalyzeTurnInputs, STAGES, buildProcessedAnalysis, normalizeTimestampBoundaries, buildShotsFromBoundaries, buildShotBoundaryCacheParams, buildRepairTurnInputs, renderRepairTurnInputs, renderSummaryTurnInputs, resolveAnalysisSampling, selectAnalysisFramesByTargetGrid, stripPromptFingerprint, splitPredecessorCacheParams, resolveSkillHash, createArtifactCacheParamBuilders, createArtifactIndex, loadRoleProfileByRole, summarizeThreadConversation, createThreadPoolProxy, sanitizeRoleStatus, DEFAULT_ALLOWED_ROLES, planContactSheets, createArtifact, createShotHarness, isTransformTurnPayload, createContactSheets, rootRuntime, escapeRegExp, delay, hashText, response, structuredErrorForTest, createTransformMessage, createInvalidTransformMessage, createShotMessage, createCachedShotAnalysis, createValidCachedShotAnalysis } = require("./threadpool-shot-boundary.helpers");

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
