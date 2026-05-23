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
const { createArtifactIndex } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { loadRoleProfileByRole } = require("../../Apps/Api/lib/role-profile-loader");
const { summarizeThreadConversation } = require("../../Apps/Api/lib/thread-conversation");
const { createThreadPoolProxy, sanitizeRoleStatus } = require("../../Apps/Api/lib/threadpool-proxy");
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

test("shot boundary turn inputs remove invalid surrogate text and include multiple sheets", async () => {
  const artifact = createArtifact();
  artifact.sampleVideoId = "sample_\uDCAA1";
  artifact.trace.traceId = "trace_\uDCAA1";
  artifact.sampleVideo.artifactId = "artifact_\uDCAAsample";
  artifact.frames[0] = {
    ...artifact.frames[0],
    frameId: "frame_\uDCAA0",
    artifactId: "artifact_\uDCAAframe_0",
    parentArtifactId: "artifact_\uDCAAparent",
    imageUri: "/runtime/Artifacts/sample_1/frames/frame-\uDCAA0.jpg",
  };

  const prepared = prepareInput(artifact, 1, { runtimeRoot: "C:\\Runtime" });
  const contactSheets = createContactSheets(prepared, path.join("C:\\Runtime", "Artifacts", "sample_1"));
  const roleProfile = await loadRoleProfileByRole("shot-boundary-analyzer");
  const turnInputs = renderAnalyzeTurnInputs({ prepared, contactSheets, roleProfile });
  const promptText = turnInputs.inputs[0].text;
  const textItems = turnInputs.inputs.filter((item) => item.type === "text");
  const imageItems = turnInputs.inputs.filter((item) => item.type === "localImage");

  assert.equal(/[\uD800-\uDFFF]/.test(JSON.stringify(prepared)), false);
  assert.equal(/[\uD800-\uDFFF]/.test(promptText), false);
  assert.equal(textItems.length, 1);
  assert.equal(imageItems.length, 2);
  assert.match(promptText, /多张 localImage 联表/);
  assert.doesNotMatch(promptText, /输入清单/);
  assert.doesNotMatch(promptText, /sampleVideoId/);
  assert.doesNotMatch(promptText, /frameIndexMap/);
  assert.match(promptText, /"durationSeconds":2/);
  assert.match(promptText, /"startTime":0/);
  assert.match(promptText, /"endTime":1/);
  assert.match(promptText, /"endTime":0/);
  assert.match(promptText, /"schemaVersion":"shot-centric\.v2"/);
  assert.match(promptText, /"shots\[\]\.start":"number, seconds, first shot must start at 0"/);
  assert.match(promptText, /"shots\[\]\.endBoundary\.timestamp":"number, seconds, must equal current shot end, 0 < timestamp < durationSeconds"/);
  assert.doesNotMatch(promptText, /任务输入：.*analysisSampling/);
  assert.doesNotMatch(promptText, /任务输入：.*sheetCount/);
  assert.doesNotMatch(promptText, /任务输入：.*sheetIndex/);
  assert.doesNotMatch(promptText, /任务输入：.*frameCount/);
  assert.doesNotMatch(promptText, /输出契约：.*boundaryType/);
  assert.doesNotMatch(promptText, /sourceArtifactId/);
  assert.doesNotMatch(promptText, /sheetId/);
  assert.doesNotMatch(promptText, /extractSampling/);
  assert.doesNotMatch(promptText, /actualFrameCount/);
  assert.doesNotMatch(promptText, /maxFrames/);
  assert.doesNotMatch(promptText, /"timestamp":12\.48/);
  assert.doesNotMatch(promptText, /"timestamp":0/);
  assert.doesNotMatch(promptText, /runtime\/Artifacts/);
  assert.equal(turnInputs.promptTemplateId, "analyze");
  assert.match(turnInputs.promptTemplateVersion, /^analyze\.v2$/);
  assert.ok(turnInputs.promptTemplateHash);
  assert.equal(imageItems[0].path, "C:\\Runtime\\Artifacts\\sample_1\\contact-sheets\\sheet-001.jpg");
  assert.equal(imageItems[1].path, "C:\\Runtime\\Artifacts\\sample_1\\contact-sheets\\sheet-002.jpg");
});

test("shot boundary turn inputs include subtitle context as semantic-only aid", async () => {
  const artifact = createArtifact({
    subtitleStatus: "processed",
    subtitleSegments: [
      { id: "subtitle_1", start: 0, end: 0.8, text: "第一句字幕".repeat(40), confidence: null },
      { id: "subtitle_2", start: 1, end: 1.8, text: "第二句字幕", confidence: null },
    ],
  });
  const prepared = prepareInput(artifact, 1, { runtimeRoot: "C:\\Runtime" });
  const contactSheets = createContactSheets(prepared, path.join("C:\\Runtime", "Artifacts", "sample_1"));
  const roleProfile = await loadRoleProfileByRole("shot-boundary-analyzer");
  const turnInputs = renderAnalyzeTurnInputs({ prepared, contactSheets, roleProfile });
  const promptText = turnInputs.inputs[0].text;

  assert.match(promptText, /subtitleContextSummary/);
  assert.match(promptText, /subtitleContext/);
  assert.match(promptText, /字幕当作语义辅助/);
  assert.match(promptText, /"subtitleSegmentCount":2/);
  assert.match(promptText, /"truncated":false/);
  assert.match(promptText, /shots\[\]\.summary/);
  assert.match(promptText, /shots\[\]\.endBoundary/);
  assert.doesNotMatch(promptText, /第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕第一句字幕/);
});

test("shot boundary repair turn inputs use field contract without timestamp examples", async () => {
  const artifact = createArtifact();
  const prepared = prepareInput(artifact, 1, { runtimeRoot: "C:\\Runtime" });
  const contactSheets = createContactSheets(prepared, path.join("C:\\Runtime", "Artifacts", "sample_1"));
  const validationError = {
    code: "shot_boundary_validation_failed",
    message: "切镜结果校验失败",
    debugPayload: {
      validation: {
        code: "shot_boundary_timestamp_out_of_range",
        message: "切镜时间点超出允许范围",
        validatorCode: "shot_boundary_timestamp_out_of_range",
      },
    },
  };

  const roleProfile = await loadRoleProfileByRole("shot-boundary-analyzer");
  const turnInputs = renderRepairTurnInputs({
    prepared,
    contactSheets,
    validationError,
    priorTurnOutput: JSON.stringify({ boundaries: [{ timestamp: 9.9 }] }),
    repairAttemptCount: 1,
    roleProfile,
  });
  const promptText = turnInputs.inputs[0].text;

  assert.match(promptText, /"shots\[\]\.endBoundary\.timestamp":"number, seconds, must equal current shot end, 0 < timestamp < durationSeconds"/);
  assert.match(promptText, /"shots\[\]\.endBoundary\.reason":"short string, explain why the cut happens here, not the shot summary"/);
  assert.match(promptText, /shots\[\]\.summary/);
  assert.match(promptText, /"hasPriorOutput":true/);
  assert.match(promptText, /"outputLength":34/);
  assert.doesNotMatch(promptText, /任务输入：.*analysisSampling/);
  assert.doesNotMatch(promptText, /任务输入：.*sheetCount/);
  assert.doesNotMatch(promptText, /输出契约：.*boundaryType/);
  assert.doesNotMatch(promptText, /"timestamp":12\.48/);
  assert.doesNotMatch(promptText, /"timestamp":0/);
  assert.doesNotMatch(promptText, /9\.9/);
  assert.doesNotMatch(promptText, /sourceArtifactId/);
  assert.doesNotMatch(promptText, /sheetId/);
  assert.doesNotMatch(promptText, /extractSampling/);
  assert.equal(turnInputs.promptTemplateId, "repair");
  assert.match(turnInputs.promptTemplateVersion, /^repair\.v2$/);
  assert.equal(turnInputs.inputs.filter((item) => item.type === "localImage").length, 2);
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
    title: "shot-boundary-analyzer",
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
    role: "shot-boundary-analyzer",
    min_idle: 1,
    init_prompt: "very long prompt",
    skill_path: "C:\\x\\shot-boundary-analyzer\\SKILL.md",
    counts: { idle: 1, leased: 0 },
    seed_thread_id: "thread_seed",
    can_acquire: true,
    can_init: true,
    thread_entries: [{ thread_id: "thread_1", thread_status: "idle", lease_id: null, latest_input_tokens: 700, threshold_input_tokens: 1000, last_owner_id: "owner_1" }],
    active_leases: [],
  });
  assert.equal(status.config.skill_path, "SKILL.md");
  assert.equal(status.config.profile_path, null);
  assert.equal(status.config.profile_version, null);
  assert.equal("init_prompt" in status, false);
  assert.equal(status.threads[0].status, "idle");
  assert.equal(status.threads[0].latest_input_tokens, 700);
  assert.equal(status.threads[0].threshold_input_tokens, 1000);
  assert.equal(status.threads[0].last_owner_id, "owner_1");
  assert.equal(status.canInit, true);
});

test("threadpool proxy filters roles outside the workspace allowlist", async () => {
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-analyzer"],
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/health") {
        return response({ ok: true, roles: ["shot-boundary-analyzer", "ae-precomp-design-producer"], warming_roles: ["ae-precomp-design-producer"] });
      }
      if (pathname === "/roles/shot-boundary-analyzer/status") {
        return response({ ok: true, role: "shot-boundary-analyzer", min_idle: 1, counts: { idle: 1, leased: 0 }, can_acquire: true, thread_entries: [{ thread_id: "thread_1", thread_status: "idle" }], active_leases: [] });
      }
      if (pathname === "/threads/thread_1/discard") return response({ ok: true, thread_id: "thread_1", status: "discarded" });
      return response({ ok: false, detail: "unexpected" }, 404);
    },
  });
  const roles = await proxy.roles();
  assert.deepEqual(roles.roles.map((role) => role.role), ["shot-boundary-analyzer"]);
  assert.deepEqual(roles.health.warming_roles, []);
  const blocked = await proxy.roleStatus("ae-precomp-design-producer");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, "threadpool_role_not_allowed");
  const allowedThread = await proxy.findAllowedThread("thread_1");
  assert.equal(allowedThread.ok, true);
  const discarded = await proxy.discardThread({ threadId: "thread_1", reason: "test" });
  assert.equal(discarded.status, "discarded");
});

test("threadpool proxy timeout becomes unavailable payload", async () => {
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-analyzer"],
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
    allowedRoles: ["shot-boundary-analyzer"],
    requestTimeoutMs: 3000,
    leaseAcquireTimeoutMs: 15000,
    fetchImpl: async (url, options = {}) => {
      requests.push({
        pathname: new URL(url).pathname,
        method: options.method,
      });
      return response({ ok: true, lease_id: "lease_1", thread_id: "thread_1" });
    },
  });

  await proxy.acquireLease({ role: "shot-boundary-analyzer", ownerId: "trace_1" });

  assert.equal(proxy.requestTimeoutMs, 3000);
  assert.equal(proxy.leaseAcquireTimeoutMs, 15000);
  assert.deepEqual(requests, [{ pathname: "/leases/acquire", method: "POST" }]);
});

test("appserver bridge defaults to in-repo python runtime root", () => {
  const bridge = createAppServerBridge({ python: "python" });
  assert.equal(bridge.pythonRuntimeRoot, DEFAULT_PYTHON_RUNTIME_ROOT);
  assert.match(DEFAULT_PYTHON_RUNTIME_ROOT, /Infrastructure[\\/]AgentRuntime$/);
});

test("shot boundary warming fails before acquire and writes failed job", async () => {
  const harness = await createShotHarness({
    threadPoolOverrides: {
      ensureRoleReady: async () => ({
        ok: false,
        error: "threadpool_warming",
        message: "ThreadPool 正在 warming，请稍后再试",
        retryable: true,
        detail: { warming: true, canAcquire: false, readyForLeases: false },
      }),
      acquireLease: async () => {
        throw new Error("should not acquire");
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(30);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const failLog = harness.logger.logs.find((entry) => entry.event === "stage.fail");

  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "threadpool_warming");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(failLog.stageName, STAGES.threadAcquired);
  assert.equal(harness.threadPool.discarded.length, 0);
});

test("shot boundary acquire timeout retries and then submits turn", async () => {
  let acquireAttempts = 0;
  const startTurnPayloads = [];
  const harness = await createShotHarness({
    threadPoolOverrides: {
      acquireLease: async () => {
        acquireAttempts += 1;
        if (acquireAttempts === 1) {
          const error = new Error("ThreadPool 请求超时，请稍后再试");
          error.code = "threadpool_timeout";
          error.request = { method: "POST", pathname: "/leases/acquire", requestTimeoutMs: 15000 };
          throw error;
        }
        return { lease_id: "lease_1", thread_id: "thread_1" };
      },
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        startTurnPayloads.push(payload);
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
      collectTurnResult: async () => ({ ok: false, threadId: "thread_1", turnId: "turn_1", status: "running", finalMessage: "" }),
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(650);
  const job = harness.jobStore.getJob(result.processingJobId);
  const stageEnd = harness.logger.logs.find((entry) => entry.event === "stage.end" && entry.stageName === STAGES.threadAcquired);

  assert.equal(acquireAttempts, 2);
  assert.equal(job.status, "processing");
  assert.equal(job.agentRun.turnId, "turn_1");
  assert.equal(startTurnPayloads.length, 1);
  assert.equal(stageEnd.outputSummary.attemptCount, 2);
  assert.equal(stageEnd.outputSummary.requestTimeoutMs, 15000);
  assert.deepEqual(harness.threadPool.ownerReleased, [result.traceId]);
});

test("shot boundary acquire timeout exhausts retries as pre-agent failure", async () => {
  let acquireAttempts = 0;
  const harness = await createShotHarness({
    threadPoolOverrides: {
      acquireLease: async () => {
        acquireAttempts += 1;
        const error = new Error("ThreadPool 请求超时，请稍后再试");
        error.code = "threadpool_timeout";
        error.request = { method: "POST", pathname: "/leases/acquire", requestTimeoutMs: 15000 };
        throw error;
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(1700);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const failLog = harness.logger.logs.find((entry) => entry.event === "stage.fail" && entry.stageName === STAGES.threadAcquired);
  const snapshot = harness.logger.snapshots.find((entry) => entry.stageName === STAGES.threadAcquired);

  assert.equal(acquireAttempts, 3);
  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "threadpool_unavailable");
  assert.equal(job.errorSummary.retryable, true);
  assert.equal(job.errorSummary.preAgentFailure, true);
  assert.equal(job.errorSummary.turnSubmitted, false);
  assert.equal(job.agentRun ?? null, null);
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, null);
  assert.equal(snapshot.debugPayload.attemptCount, 3);
  assert.equal(snapshot.debugPayload.requestTimeoutMs, 15000);
  assert.equal(snapshot.debugPayload.lastRequestError.request.pathname, "/leases/acquire");
  assert.equal(failLog.errorSummary.preAgentFailure, true);
  assert.deepEqual(harness.threadPool.ownerReleased, [result.traceId, result.traceId, result.traceId]);
});

test("shot boundary start turn persists inflight without waiting for final message", async () => {
  const startTurnPayloads = [];
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async (payload) => {
        startTurnPayloads.push(payload);
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
      collectTurnResult: async () => ({ ok: false, threadId: "thread_1", turnId: "turn_1", status: "running", finalMessage: "" }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);

  assert.equal(job.agentRun.threadId, "thread_1");
  assert.equal(job.agentRun.leaseId, "lease_1");
  assert.equal(job.agentRun.turnId, "turn_1");
  assert.equal(job.agentRun.contactSheets.length, 2);
  assert.equal(job.status, "processing");
  assert.equal(harness.threadPool.released.length, 0);
  assert.equal(startTurnPayloads.length, 1);
  assert.equal("skillPath" in startTurnPayloads[0], false);
});

test("shot boundary enqueue returns before contact sheet work finishes", async () => {
  let releaseContactSheet;
  const contactSheetStarted = new Promise((resolve) => {
    releaseContactSheet = resolve;
  });
  const harness = await createShotHarness({
    contactSheetGenerator: {
      generateContactSheets: async ({ frames, parentArtifactId, sampleDir }) => {
        await contactSheetStarted;
        return createContactSheets({ frames, sourceArtifactId: parentArtifactId }, sampleDir);
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  const pending = harness.jobStore.getJob(result.processingJobId);
  releaseContactSheet();
  await delay(20);

  assert.equal(result.processingJobId != null, true);
  assert.equal(pending.status, "processing");
});

test("shot boundary contact sheet failure writes stage fail and debug snapshot", async () => {
  const error = new Error("sharp failed");
  error.code = "contact_sheet_failed";
  const harness = await createShotHarness({
    contactSheetGenerator: {
      generateContactSheets: async () => { throw error; },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);
  const failLog = harness.logger.logs.find((entry) => entry.event === "stage.fail");

  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "contact_sheet_failed");
  assert.equal(failLog.stageName, STAGES.contactSheetPrepared);
  assert.equal(harness.logger.snapshots.length, 1);
});

test("shot boundary collect completed writes artifact and releases lease", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        finalMessage: `补充说明\n${JSON.stringify({
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
        })}\n已完成`,
      }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);

  assert.equal(job.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, "turn_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.profileVersion, "2026-05-22.2");
  assert.equal(artifact.shotBoundaryAnalysis.agent.promptTemplateId, "analyze");
  assert.equal(artifact.shotBoundaryAnalysis.agent.promptTemplateVersion, "analyze.v2");
  assert.ok(artifact.shotBoundaryAnalysis.agent.promptTemplateHash);
  assert.ok(artifact.shotBoundaryAnalysis.agent.initFingerprint);
  assert.equal(artifact.shotBoundaryAnalysis.resultOrigin, "new_turn");
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.length, 2);
  assert.equal(artifact.shotBoundaryAnalysis.boundaries.length, 1);
  assert.equal(artifact.shotBoundaryAnalysis.validation.repairAttemptCount, 0);
  assert.equal(artifact.shotBoundaryAnalysis.shots[0].shotNo, "S001");
  assert.equal(artifact.shotBoundaryAnalysis.shots[0].summary, "人物半身口播");
  assert.equal(artifact.shotBoundaryAnalysis.shots[0].endBoundaryReason, "cut");
  assert.equal(artifact.shotBoundaryAnalysis.shots[1].summary, "产品特写镜头");
  assert.equal(artifact.shotBoundaryAnalysis.shots[1].endBoundaryReason, null);
  assert.equal(artifact.shotBoundaryAnalysis.review.decision, "pass");
  assert.equal(artifact.shotBoundaryAnalysis.reviewRuns[0].role, "shot-boundary-reviewer");
  assert.notEqual(artifact.shotBoundaryAnalysis.reviewRuns[0].threadId, artifact.shotBoundaryAnalysis.agent.threadId);
  assert.deepEqual(harness.threadPool.released.map((entry) => entry.ownerId).sort(), [`${result.traceId}:review`, result.traceId].sort());
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
        if (!isSummaryTurnPayload(payload) && !isReviewTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);

  assert.ok(cacheLookups.length >= 1);
  const currentLookup = cacheLookups[0];
  assert.equal(currentLookup.profileVersion, "2026-05-22.2");
  assert.equal(currentLookup.promptTemplateId, "analyze");
  assert.equal(currentLookup.promptTemplateVersion, "analyze.v2");
  assert.ok(currentLookup.promptTemplateHash);
  assert.ok(currentLookup.initFingerprint);
  assert.equal(currentLookup.skillHash, hashText("new skill content"));
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
        if (!isSummaryTurnPayload(payload) && !isReviewTurnPayload(payload)) shotStartTurnCount += 1;
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
        if (!isSummaryTurnPayload(payload) && !isReviewTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const waitingJob = harness.jobStore.getJob(result.processingJobId);
  assert.equal(waitingJob.status, "cache_waiting");
  assert.equal(waitingJob.cachePrompt.cachedItem.analysisFps, 3);
  assert.equal(waitingJob.cachePrompt.profileVersion, "2026-05-22.2");
  assert.equal(waitingJob.cachePrompt.promptTemplateId, "analyze");
  assert.equal(waitingJob.cachePrompt.promptTemplateVersion, "analyze.v2");
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
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, "turn_cached");
  assert.equal(cacheReuseLog.outputSummary.sourceSampleVideoId, "sample_cached");
  assert.equal(cacheReuseLog.outputSummary.cacheKey, "cache_1");
  assert.equal(cacheReuseLog.outputSummary.sourceTurnId, "turn_cached");
  assert.equal(cacheReuseLog.outputSummary.analysisFps, 3);
  assert.equal(cacheReuseLog.outputSummary.boundaryCount, 1);
  assert.equal(cacheReuseLog.outputSummary.shotCount, 2);
});

test("shot boundary registers reusable cache for the same service run", async () => {
  let shotStartTurnCount = 0;
  let summaryCollectCount = 0;
  const harness = await createShotHarness({
    useRealArtifactIndex: true,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (!isSummaryTurnPayload(payload) && !isReviewTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: isSummaryTurnPayload(payload) ? "turn_summary_1" : `turn_${shotStartTurnCount}`, status: "submitted" };
      },
      collectTurnResult: async ({ turnId }) => {
        if (turnId === "turn_summary_1") {
          summaryCollectCount += 1;
          if (summaryCollectCount === 1) return { ok: false, threadId: "thread_1", turnId, status: "inProgress", finalMessage: "" };
          return { ok: true, threadId: "thread_1", turnId, status: "completed", finalMessage: createSummaryMessage() };
        }
        return {
          ok: true,
          threadId: "thread_1",
          turnId,
          status: "completed",
          finalMessage: JSON.stringify({ boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false }] }),
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
  assert.equal(summaryCollectCount, 2);
});

test("shot boundary cache lookup falls back to pre-split analyze prompt params", async () => {
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
  const analyzeTurn = renderAnalyzeTurnInputs({ prepared, contactSheets, roleProfile: await loadRoleProfileByRole("shot-boundary-analyzer") });
  const predecessorParams = splitPredecessorCacheParams(prepared, contactSheets, {
    skillHash: await resolveSkillHash(),
    profileVersion: "2026-05-22.2",
    promptTemplateId: analyzeTurn.promptTemplateId,
    promptTemplateVersion: analyzeTurn.promptTemplateVersion,
    promptTemplateHash: analyzeTurn.promptTemplateHash,
    initFingerprint: "36d01f2d22128b1f",
  });
  cacheEntries.set(stableKey("hash_1", STAGES.resultWritten, predecessorParams), { sampleVideoId: "sample_cached", cacheKey: "pre_split_cache" });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);
  const cacheLookupLog = harness.logger.logs.find((entry) => entry.stageName === STAGES.cacheLookup && entry.event === "stage.end");

  assert.equal(job.status, "cache_waiting");
  assert.equal(job.cachePrompt.cacheKey, "pre_split_cache");
  assert.equal(cacheLookupLog.outputSummary.cacheLookup, "hit");
  assert.equal(cacheLookupLog.outputSummary.cacheLookupMode, "split_predecessor");
});

test("shot boundary cache lookup falls back to legacy promptless cache params", async () => {
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
    skillHash: "302ec99d6733632b",
  }));
  cacheEntries.set(stableKey("hash_1", STAGES.resultWritten, legacyParams), { sampleVideoId: "sample_cached", cacheKey: "legacy_cache" });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);
  const cacheLookupLog = harness.logger.logs.find((entry) => entry.stageName === STAGES.cacheLookup && entry.event === "stage.end");

  assert.equal(job.status, "cache_waiting");
  assert.equal(job.cachePrompt.cacheKey, "legacy_cache");
  assert.equal(cacheLookupLog.outputSummary.cacheLookup, "hit");
  assert.equal(cacheLookupLog.outputSummary.cacheLookupMode, "legacy_promptless");
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
        if (!isSummaryTurnPayload(payload) && !isReviewTurnPayload(payload)) shotStartTurnCount += 1;
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
        if (!isSummaryTurnPayload(payload) && !isReviewTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_1",
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
      findCacheEntry: async ({ params }) => (params.analysisSampling?.fps === 1 ? { sampleVideoId: "sample_cached", cacheKey: "cache_bad" } : null),
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
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-2).resultOrigin, "new_turn");
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-1).resultOrigin, "cache_reuse");
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-2).traceId, first.traceId);
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-1).traceId, second.traceId);
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-1).sourceTraceId, "trace_1");
});

test("shot boundary keeps Chinese reason text without mojibake", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        finalMessage: JSON.stringify({ boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "未检测到明显视觉变化", needReview: false }] }),
      }),
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

test("shot boundary summary turn inputs only request commerce brief", async () => {
  const roleProfile = await loadRoleProfileByRole("shot-boundary-analyzer");
  const turnInputs = renderSummaryTurnInputs({
    roleProfile,
    shots: [
      { shotNo: "S001", start: 0, end: 1.2, summary: "人物半身口播", endBoundaryReason: "cut" },
      { shotNo: "S002", start: 1.2, end: 2, summary: "产品特写镜头", endBoundaryReason: null },
    ],
  });
  const promptText = turnInputs.inputs[0].text;

  assert.equal(turnInputs.promptTemplateId, "summary");
  assert.equal(turnInputs.promptTemplateVersion, "summary.v1");
  assert.match(promptText, /不要重新切镜/);
  assert.match(promptText, /commerceBrief/);
  assert.doesNotMatch(promptText, /localImage/);
  assert.doesNotMatch(JSON.stringify(turnInputs.outputContract), /boundaries/);
  assert.equal(turnInputs.inputs.filter((item) => item.type === "localImage").length, 0);
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
        role: "shot-boundary-analyzer",
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
  const status = await harness.threadPool.roleStatus("shot-boundary-analyzer");

  assert.equal(status.readyForLeases, false);
  assert.equal(status.recovering, true);
  assert.equal(status.warming, true);
});

test("shot boundary parse failure writes failed artifact and debug snapshot", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "completed", finalMessage: "not-json" }),
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
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.length, 2);
  assert.equal(harness.logger.snapshots.length, 1);
  assert.deepEqual(harness.threadPool.discarded, [{ threadId: "thread_1", reason: "shot-boundary-analysis-failed" }]);
  assert.deepEqual(harness.threadPool.ownerReleased, [result.traceId]);
});

test("shot boundary mojibake reason fails quality gate and writes debug snapshot", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        finalMessage: JSON.stringify({ boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "鏈娴嬪埌鏄庢樉瑙嗚鍙樺寲", needReview: false }] }),
      }),
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
  assert.equal(failLog.stageName, STAGES.turnValidated);
  assert.equal(harness.logger.snapshots[0].debugPayload.turnId, "turn_1");
  assert.match(harness.logger.snapshots[0].debugPayload.parseFailureReason, /mojibake/);
});

test("shot boundary recovery completes active inflight", async () => {
  const harness = await createShotHarness({
    appServer: {
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        finalMessage: JSON.stringify({ boundaries: [{ timestamp: 1.2, confidence: 0.7, boundaryType: "hard_cut", reason: "cut", needReview: false }] }),
      }),
    },
  });
  const job = harness.jobStore.createJob({ sampleVideoId: "sample_1", traceId: "trace_recover" });
  harness.jobStore.updateJob(job.jobId, {
    status: "processing",
    stage: STAGES.turnStarted,
    progress: 80,
    agentRun: {
      provider: "codex-appserver",
      role: "shot-boundary-analyzer",
      leaseId: "lease_1",
      threadId: "thread_1",
      turnId: "turn_1",
      traceId: "trace_recover",
      artifactId: "artifact_recover",
      parentArtifactId: "artifact_sample",
      sampleVideoId: "sample_1",
      analysisFps: 3,
      contactSheets: createContactSheets(prepareInput(createArtifact(), 3, { runtimeRoot: rootRuntime("recover") }), rootRuntime("recover")),
      status: "turn_submitted",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  const recovered = await harness.service.recoverActiveAgentRuns();

  assert.equal(recovered.recovered, 1);
  assert.equal(harness.jobStore.getJob(job.jobId).status, "processed");
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
    allowedRoles: ["shot-boundary-analyzer"],
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
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        finalMessage: JSON.stringify({ boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false }] }),
      }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  for (let attempt = 0; attempt < 10 && harness.threadPool.released.length === 0; attempt += 1) {
    await delay(10);
  }

  assert.deepEqual(harness.threadPool.released.map((entry) => entry.ownerId).sort(), [`${result.traceId}:review`, result.traceId].sort());
  assert.deepEqual(harness.threadPool.discarded, []);
  assert.deepEqual(harness.threadPool.ownerReleased, []);
});

test("shot boundary empty boundaries triggers repair and can recover", async () => {
  let collectCount = 0;
  const startTurnPayloads = [];
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async (payload) => {
        startTurnPayloads.push(payload);
        return { ok: true, threadId: "thread_1", turnId: collectCount ? "turn_2" : "turn_1", status: "submitted" };
      },
      collectTurnResult: async () => {
        collectCount += 1;
        if (collectCount === 1) return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "completed", finalMessage: JSON.stringify({ boundaries: [] }) };
        return { ok: true, threadId: "thread_1", turnId: "turn_2", status: "completed", finalMessage: JSON.stringify({ boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false }] }) };
      },
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(artifact.shotBoundaryAnalysis.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.resultOrigin, "repaired_turn");
  assert.equal(artifact.shotBoundaryAnalysis.validation.repairAttemptCount, 1);
  assert.equal(startTurnPayloads.length, 4);
  assert.equal("skillPath" in startTurnPayloads[0], false);
  assert.equal("skillPath" in startTurnPayloads[1], false);
  assert.equal("skillPath" in startTurnPayloads[2], false);
  assert.equal(isReviewTurnPayload(startTurnPayloads[2]), true);
  assert.equal(isSummaryTurnPayload(startTurnPayloads[3]), true);
});

test("shot boundary empty boundaries after repair stays failed", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "completed", finalMessage: JSON.stringify({ boundaries: [] }) }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "shot_boundary_validation_failed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(artifact.shotBoundaryAnalysis.validation.validatorCode, "shot_boundary_empty_boundaries");
});

function createArtifact(overrides = {}) {
  const subtitleStatus = overrides.subtitleStatus ?? null;
  const subtitleSegments = overrides.subtitleSegments ?? (subtitleStatus === "processed" ? [{ id: "subtitle_1", start: 0, end: 1, text: "你好", confidence: null }] : []);
  return {
    sampleVideoId: "sample_1",
    trace: { traceId: "trace_1" },
    processingOptions: { frameSampleRateFps: 3 },
    sampleVideo: { artifactId: "artifact_sample" },
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

async function createShotHarness({ appServer, threadPoolConfig, threadPoolOverrides, skillPath, artifactIndex: artifactIndexOverrides, contactSheetGenerator: contactSheetGeneratorOverride, useRealArtifactIndex = false } = {}) {
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
  await store.ensureRuntimeDirs();
  await store.writeJson(path.join(store.sampleDir("sample_1"), "artifact.json"), createArtifact());
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
    roleStatus: async (role = "shot-boundary-analyzer") => ({
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
    ensureRoleReady: async (role = "shot-boundary-analyzer") => ({ ok: true, role, status: { role, canAcquire: true, readyForLeases: true, warming: false, warmupError: null, startupError: null } }),
    acquireLease: async ({ role } = {}) => role === "shot-boundary-reviewer"
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
    ? createArtifactIndex({ store, processorVersion: "test-v1" })
    : fakeArtifactIndex;
  const contactSheetGenerator = contactSheetGeneratorOverride ?? {
    generateContactSheets: async ({ frames, parentArtifactId, sampleDir }) => createContactSheets({ frames, sourceArtifactId: parentArtifactId }, sampleDir),
  };
  const appServerImpl = appServer ?? {};
  const turnKinds = [];
  const service = createShotBoundaryService({
    rootDir,
    store,
    logger,
    jobStore,
    artifactIndex,
    threadPool,
    contactSheetGenerator,
    skillPath,
    appServer: {
      startTurnWithInputs: async (payload) => {
        const result = appServerImpl.startTurnWithInputs
          ? await appServerImpl.startTurnWithInputs(payload)
          : { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
        turnKinds.push({ turnId: result.turnId ?? null, kind: isSummaryTurnPayload(payload) ? "summary" : (isReviewTurnPayload(payload) ? "review" : "shot") });
        return result;
      },
      collectTurnResult: async (payload) => {
        const turnKindEntry = turnKinds.shift() ?? { kind: "shot" };
        const turnKind = turnKindEntry.kind;
        const result = appServerImpl.collectTurnResult
          ? await appServerImpl.collectTurnResult(payload)
          : { ok: false, threadId: "thread_1", turnId: "turn_1", status: "running", finalMessage: "" };
        if (turnKind === "summary" && result?.status !== "completed") {
          turnKinds.unshift(turnKindEntry);
        }
        if (turnKind === "review" && result?.status === "completed" && !String(result.finalMessage ?? "").includes("decision")) {
          return { ...result, finalMessage: createReviewPassMessage() };
        }
        if (turnKind === "summary" && result?.status === "completed" && !String(result.finalMessage ?? "").includes("commerceBrief")) {
          return { ...result, finalMessage: createSummaryMessage() };
        }
        return result;
      },
    },
    pollIntervalMs: 60_000,
    summaryPollIntervalMs: 0,
    summaryCollectMaxAttempts: 3,
  });
  return { rootDir, store, logger, jobStore, threadPool, artifactIndex, service };
}

function isSummaryTurnPayload(payload) {
  const text = String(payload?.inputs?.[0]?.text ?? "");
  return text.includes("已完成切镜摘要") && text.includes("commerceBrief");
}

function isReviewTurnPayload(payload) {
  const text = String(payload?.inputs?.[0]?.text ?? "");
  return text.includes("切镜审查") && text.includes("decision") && text.includes("issues");
}

function createContactSheets(prepared, sampleDir) {
  const frames = prepared.frames ?? prepared;
  const parentArtifactId = prepared.sourceArtifactId ?? "artifact_sample";
  return [
    {
      artifactId: "artifact_sheet_1",
      parentArtifactId,
      type: "contact_sheet",
      artifactType: "contact_sheet",
      status: "processed",
      sheetPurpose: "shot_boundary_analysis",
      sheetId: "sheet-001",
      sheetIndex: 0,
      uri: "/runtime/Artifacts/sample_1/contact-sheets/sheet-001.jpg",
      imagePath: "/runtime/Artifacts/sample_1/contact-sheets/sheet-001.jpg",
      localImagePath: path.join(sampleDir, "contact-sheets", "sheet-001.jpg"),
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
      sheetPurpose: "shot_boundary_analysis",
      sheetId: "sheet-002",
      sheetIndex: 1,
      uri: "/runtime/Artifacts/sample_1/contact-sheets/sheet-002.jpg",
      imagePath: "/runtime/Artifacts/sample_1/contact-sheets/sheet-002.jpg",
      localImagePath: path.join(sampleDir, "contact-sheets", "sheet-002.jpg"),
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

function createSummaryMessage() {
  return JSON.stringify({
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

function createReviewPassMessage() {
  return JSON.stringify({
    decision: "pass",
    reason: "未发现明确误切或漏切",
    issues: [],
  });
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
      role: "shot-boundary-analyzer",
      profilePath: "C:\\ByteDanceFullStack\\Assets\\RoleProfiles\\shot-boundary-analyzer\\role.json",
      profileVersion: "2026-05-22.2",
      promptTemplateId: "analyze",
      promptTemplateVersion: "analyze.v2",
      promptTemplateHash: "cached_prompt_hash",
      initFingerprint: "cached_init_fingerprint",
      skillPath: "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-analyzer\\SKILL.md",
      skillHash: "cached_hash",
      threadId: "thread_cached",
      leaseId: "lease_cached",
      turnId: "turn_cached",
      sheetCount: 2,
      inputMode: "multi_contact_sheet",
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
      role: "shot-boundary-analyzer",
      profilePath: "C:\\ByteDanceFullStack\\Assets\\RoleProfiles\\shot-boundary-analyzer\\role.json",
      profileVersion: "2026-05-22.2",
      promptTemplateId: "analyze",
      promptTemplateVersion: "analyze.v2",
      promptTemplateHash: "cached_prompt_hash",
      initFingerprint: "cached_init_fingerprint",
      skillPath: "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-analyzer\\SKILL.md",
      skillHash: "cached_hash",
      threadId: "thread_cached",
      leaseId: "lease_cached",
      turnId: "turn_cached",
      sheetCount: 2,
      inputMode: "multi_contact_sheet",
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
