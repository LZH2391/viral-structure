const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { prepareInputPackage, renderAnalyzeTurnInputs, buildOutputSkeleton } = require("../../Apps/Api/lib/user-material-tagger-analysis/input");
const { buildProcessedAnalysis } = require("../../Apps/Api/lib/user-material-tagger-analysis/result-builder");

test("user material pack shot cards include representative frame visualRef from visual manifest", () => {
  const input = createInput();
  const context = {
    artifactId: "artifact_material",
    traceContext: { traceId: "trace_1" },
    inputPackage: {
      visualManifest: {
        shotSheets: [
          {
            shotId: "shot_1",
            shotNo: "S001",
            empty: false,
            sheetIds: ["shot-representatives-p1"],
            middleTimestamp: 0.5,
            representativeFrameTimestamp: 0.5,
            duration: 1,
          },
        ],
        sheets: [
          {
            sheetId: "shot-representatives-p1",
            attachmentIndex: 0,
            pageIndex: 0,
            cells: [
              {
                shotId: "shot_1",
                shotNo: "S001",
                start: 0,
                end: 1,
                duration: 1,
                middleTimestamp: 0.5,
                representativeFrameTimestamp: 0.5,
                row: 0,
                col: 0,
              },
            ],
          },
        ],
      },
    },
  };

  const analysis = buildProcessedAnalysis(
    JSON.stringify(createOutput()),
    input,
    context,
    { turnId: "turn_1" },
    { turnId: "turn_1" },
  );

  assert.deepEqual(analysis.shotCards[0].visualRef, {
    type: "shot_representative_frame",
    sheetId: "shot-representatives-p1",
    attachmentIndex: 0,
    pageIndex: 0,
    row: 0,
    col: 0,
    timeRange: { start: 0, end: 1 },
    middleTimestamp: 0.5,
    representativeFrameTimestamp: 0.5,
  });
  assert.equal(Object.hasOwn(analysis.shotCards[1], "visualRef"), false);
});

test("user material pack accepts proofCoverage object map from agent output", () => {
  const output = createOutput();
  output.materialGroups = [
    {
      groupId: "group_product",
      groupType: "product_identity",
      shotRefs: ["shot_1"],
      groupSummary: "商品露出",
    },
  ];
  output.proofCoverage = {
    problem_visibility: {
      coverage: "not_covered",
      supportingShotRefs: [],
      supportingGroupRefs: [],
      safeUsage: "当前素材不展示问题状态。",
      gapAdvice: "补充使用前问题场景。",
    },
    product_identity: {
      coverage: "covered",
      supportingShotRefs: ["shot_1"],
      supportingGroupRefs: ["group_product"],
      safeUsage: "可用于商品识别。",
      gapAdvice: "",
    },
    process_demonstration: {
      coverage: "partially_covered",
      supportingShotRefs: ["shot_2"],
      supportingGroupRefs: [],
      reason: "有部分动作画面。",
    },
    mechanism_support: { coverage: "not_covered", supportingShotRefs: [], supportingGroupRefs: [] },
    result_evidence: { coverage: "not_covered", supportingShotRefs: [], supportingGroupRefs: [] },
    comparison_evidence: { coverage: "not_covered", supportingShotRefs: [], supportingGroupRefs: [] },
    trust_evidence: { coverage: "not_covered", supportingShotRefs: [], supportingGroupRefs: [] },
    conversion_support: { coverage: "not_covered", supportingShotRefs: [], supportingGroupRefs: [] },
  };

  const analysis = buildProcessedAnalysis(
    JSON.stringify(output),
    createInput(),
    { artifactId: "artifact_material", traceContext: { traceId: "trace_1" } },
    { turnId: "turn_1" },
    { turnId: "turn_1" },
  );

  assert.equal(analysis.proofCoverage.length, 8);
  assert.deepEqual(analysis.proofCoverage.find((item) => item.proofNeedClass === "product_identity"), {
    proofNeedClass: "product_identity",
    coverage: "strong",
    candidateShots: ["shot_1"],
    candidateGroups: ["group_product"],
    reason: "可用于商品识别。",
    safeUsage: "可用于商品识别。",
    gapAdvice: "",
  });
  assert.equal(analysis.proofCoverage.find((item) => item.proofNeedClass === "process_demonstration").coverage, "partial");
  assert.equal(analysis.proofCoverage.find((item) => item.proofNeedClass === "problem_visibility").coverage, "missing");
});

test("user material pack normalizes common agent field aliases", () => {
  const output = createOutput();
  output.shotCards = [
    {
      ...createShotCard("S002", "S002"),
      shotRef: undefined,
      shotClass: "product_process_closeup",
      visibleObjects: ["杯子", "小包装"],
      proofAffordances: undefined,
      proofNeedRefs: [
        { proofNeedClass: "process_demonstration", supportStrength: "medium", reason: "有倒粉动作。", limitations: ["不能证明完整搅拌。"] },
      ],
      positionRecommendations: {
        opening: { suitable: false, reason: "不是首屏成品。" },
        middle: { suitable: true, reason: "适合流程中段。" },
        ending: { suitable: false, reason: "不适合收尾。" },
      },
      quality: { clarity: "medium", stability: "unknown", limitations: ["略暗"] },
    },
    createShotCard("shot_1", "S001"),
  ];
  output.materialGroups = [
    {
      groupId: "group_process",
      groupType: "process_demonstration",
      name: "冲泡过程",
      supportingShotRefs: ["S001", "S002"],
      proofNeedClasses: ["process_demonstration"],
      limitations: ["缺少饮用动作"],
    },
  ];
  output.proofCoverage = {
    problem_visibility: { coverage: "not_covered", supportingShotRefs: [], supportingGroupRefs: [] },
    product_identity: { coverage: "covered", supportingShotRefs: ["S001"], supportingGroupRefs: [] },
    process_demonstration: { coverage: "covered", supportingShotRefs: ["S001", "S002"], supportingGroupRefs: ["group_process"] },
    mechanism_support: { coverage: "not_covered", supportingShotRefs: [], supportingGroupRefs: [] },
    result_evidence: { coverage: "not_covered", supportingShotRefs: [], supportingGroupRefs: [] },
    comparison_evidence: { coverage: "not_covered", supportingShotRefs: [], supportingGroupRefs: [] },
    trust_evidence: { coverage: "not_covered", supportingShotRefs: [], supportingGroupRefs: [] },
    conversion_support: { coverage: "not_covered", supportingShotRefs: [], supportingGroupRefs: [] },
  };
  output.sequenceRecommendations = {
    openingCandidates: [{ shotNo: "S001", fit: "medium", reason: "包装露出" }],
    middleCandidates: [{ shotNo: "S002", fit: "strong", reason: "流程动作" }],
    endingCandidates: [],
  };

  const analysis = buildProcessedAnalysis(
    JSON.stringify(output),
    createInput(),
    { artifactId: "artifact_material", traceContext: { traceId: "trace_1" } },
    { turnId: "turn_1" },
    { turnId: "turn_1" },
  );

  assert.deepEqual(analysis.shotCards.map((card) => card.shotRef), ["shot_1", "shot_2"]);
  assert.equal(analysis.shotCards[1].shotClass, "usage_process");
  assert.deepEqual(analysis.shotCards[1].detectedEntities.objects, ["杯子", "小包装"]);
  assert.deepEqual(analysis.shotCards[1].proofAffordances[0], {
    proofNeedClass: "process_demonstration",
    strength: "medium",
    reason: "有倒粉动作。",
    limits: ["不能证明完整搅拌。"],
  });
  assert.deepEqual(analysis.materialGroups[0].shotRefs, ["shot_1", "shot_2"]);
  assert.equal(analysis.sequenceRecommendations.middleCandidates[0].shotRef, "shot_2");
});

test("user material tagger input package includes output skeleton from shot facts", async () => {
  const sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), "user-material-skeleton-"));
  const store = {
    writeJson: async (filePath, value) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
    },
    runtimeUri: (filePath) => filePath,
  };
  const input = {
    sampleVideoId: "sample_1",
    parentArtifactId: "artifact_shot_boundary",
    commerceBrief: null,
    durationSeconds: 2,
    frameDimensions: { width: 720, height: 1280 },
    frames: [],
    shots: [
      { shotId: "shot_1", shotNo: "S001", start: 0, end: 1, summary: "商品包装近景", subtitleText: "", subtitleContextText: "" },
      { shotId: "shot_2", shotNo: "S002", start: 1, end: 2, summary: "倒粉入杯", subtitleText: "早上冲一杯", subtitleContextText: "" },
    ],
  };

  const inputPackage = await prepareInputPackage({ input, sampleDir, store });
  const skeleton = JSON.parse(fs.readFileSync(inputPackage.outputSkeletonPath, "utf8"));

  assert.equal(skeleton.type, "user-material-pack");
  assert.equal(skeleton.schemaVersion, "user-material-pack.stable");
  assert.deepEqual(skeleton.shotCards.map((card) => [card.shotRef, card.shotNo, card.timeRange, card.visualSummary]), [
    ["shot_1", "S001", { start: 0, end: 1 }, "商品包装近景"],
    ["shot_2", "S002", { start: 1, end: 2 }, "倒粉入杯"],
  ]);
  assert.equal(skeleton.proofCoverage.length, 8);

  const payload = renderAnalyzeTurnInputs({
    inputPackage,
    roleProfile: {
      turnTemplates: {
        analyze: {
          templateBody: "skeleton={{outputSkeletonPath}} contract={{outputContractPath}}",
          templateVersion: "analyze.v1",
          templateHash: "hash_analyze",
        },
      },
    },
  });
  assert.match(payload.inputs[0].text, /output-skeleton\.json/);
});

test("user material pack rejects untouched proof coverage skeleton", () => {
  const output = createOutput();
  output.proofCoverage = buildOutputSkeleton(createInput()).proofCoverage;

  assert.throws(
    () => buildProcessedAnalysis(
      JSON.stringify(output),
      createInput(),
      { artifactId: "artifact_material", traceContext: { traceId: "trace_1" } },
      { turnId: "turn_1" },
      { turnId: "turn_1" },
    ),
    /用户素材识别输出未通过校验/,
  );
});

function createInput() {
  return {
    sampleVideoId: "sample_1",
    parentArtifactId: "artifact_shot_boundary",
    shots: [
      { shotId: "shot_1", shotNo: "S001", start: 0, end: 1, summary: "商品画面" },
      { shotId: "shot_2", shotNo: "S002", start: 1, end: 2, summary: "操作画面" },
    ],
  };
}

function createOutput() {
  return {
    type: "user-material-pack",
    schemaVersion: "user-material-pack.stable",
    sampleVideoId: "sample_1",
    sourceArtifacts: { shotBoundaryAnalysis: { shotCount: 2 } },
    shotCards: [
      createShotCard("shot_1", "S001"),
      createShotCard("shot_2", "S002"),
    ],
    materialGroups: [],
    proofCoverage: [
      createProofCoverage("problem_visibility"),
      createProofCoverage("product_identity"),
      createProofCoverage("process_demonstration"),
      createProofCoverage("mechanism_support"),
      createProofCoverage("result_evidence"),
      createProofCoverage("comparison_evidence"),
      createProofCoverage("trust_evidence"),
      createProofCoverage("conversion_support"),
    ],
    sequenceRecommendations: {
      openingCandidates: [],
      middleCandidates: [],
      endingCandidates: [],
    },
    globalConstraints: [],
    restructureInputSummary: {
      strongMaterialAreas: [],
      weakMaterialAreas: [],
      missingMaterialAreas: [],
      recommendedUse: [],
      doNotUseFor: [],
      needsRestructureAttention: [],
    },
  };
}

function createShotCard(shotRef, shotNo) {
  return {
    shotRef,
    shotNo,
    shotClass: "product_display",
    shotFunctions: ["product_visibility"],
    visualSummary: "商品画面",
    spokenOrSubtitleSummary: "",
    detectedEntities: { products: [], people: [], scenes: [], objects: [], textSignals: [] },
    materialTags: [],
    proofAffordances: [],
    sequenceFit: {
      opening: { fit: "weak", reason: "", requiredSupport: [] },
      middle: { fit: "weak", reason: "", requiredSupport: [] },
      ending: { fit: "weak", reason: "", requiredSupport: [] },
    },
    quality: {
      visualClarity: "high",
      stability: "high",
      subjectFocus: "high",
      audioUsefulness: "none",
      captionUsefulness: "none",
    },
    constraints: [],
    confidence: 0.8,
    needReview: false,
  };
}

function createProofCoverage(proofNeedClass) {
  return {
    proofNeedClass,
    coverage: proofNeedClass === "product_identity" ? "strong" : "unknown",
    candidateShots: proofNeedClass === "product_identity" ? ["shot_1"] : [],
    candidateGroups: [],
    reason: proofNeedClass === "product_identity" ? "商品画面可见。" : "",
    safeUsage: "",
    gapAdvice: "",
  };
}
