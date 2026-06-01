const test = require("node:test");
const assert = require("node:assert/strict");
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

function createInput() {
  return {
    sampleVideoId: "sample_1",
    parentArtifactId: "artifact_shot_boundary",
    shots: [
      { shotId: "shot_1", shotNo: "S001", start: 0, end: 1 },
      { shotId: "shot_2", shotNo: "S002", start: 1, end: 2 },
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
    coverage: "unknown",
    candidateShots: [],
    candidateGroups: [],
    reason: "",
    safeUsage: "",
    gapAdvice: "",
  };
}
