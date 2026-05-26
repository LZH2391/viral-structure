const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSegments } = require("../../Apps/Api/lib/script-segment-analysis/validation");
const { validateRhythmStructure } = require("../../Apps/Api/lib/rhythm-structure-analysis/validation");
const { validatePackagingStructure } = require("../../Apps/Api/lib/packaging-structure-analysis/validation");
const { buildProcessedAnalysis: buildScriptProcessedAnalysis } = require("../../Apps/Api/lib/script-segment-analysis/result-builder");
const { buildProcessedAnalysis: buildRhythmProcessedAnalysis } = require("../../Apps/Api/lib/rhythm-structure-analysis/result-builder");
const { buildProcessedAnalysis: buildPackagingProcessedAnalysis } = require("../../Apps/Api/lib/packaging-structure-analysis/result-builder");

test("script segment validation reports missing fields and shot coverage location", () => {
  const missingField = validateSegments({
    segments: [{ label: "开场", shotRefs: ["shot_1"] }],
  }, createInput());

  assert.equal(missingField.ok, false);
  assert.equal(missingField.summary.path, "segments[0]");
  assert.deepEqual(missingField.summary.missingFields, ["roleInScript", "transferableRule"]);
  assert.match(missingField.summary.readableMessage, /segments\[0\]/);

  const coverage = validateSegments({
    segments: [{
      label: "中段",
      roleInScript: "解释卖点",
      shotRefs: ["shot_2"],
      transferableRule: "中段证明",
    }],
  }, createInput());

  assert.equal(coverage.ok, false);
  assert.equal(coverage.summary.path, "segments[].shotRefs");
  assert.deepEqual(coverage.summary.missingShotRefs, ["shot_1", "shot_3"]);
  assert.equal(coverage.summary.firstMismatch.expectedShotRef, "shot_1");
  assert.equal(coverage.summary.firstMismatch.actualShotRef, "shot_2");
});

test("rhythm validation reports exact shotRef path", () => {
  const validation = validateRhythmStructure({
    overview: { summary: "节奏明确" },
    sections: [{
      label: "推进",
      shotRefs: ["shot_1", "shot_3"],
      fields: [{ label: "节奏观察", value: "中间缺镜头" }],
    }],
  }, createInput());

  assert.equal(validation.ok, false);
  assert.equal(validation.summary.validatorCode, "rhythm_structure_non_contiguous_shot_refs");
  assert.equal(validation.summary.path, "sections[0].shotRefs[1]");
  assert.equal(validation.summary.previousShotRef, "shot_1");
  assert.equal(validation.summary.shotRef, "shot_3");
  assert.match(validation.summary.readableMessage, /不连续/);
});

test("packaging validation reports scoped field and coverage details", () => {
  const missingField = validatePackagingStructure({
    overview: { summary: "包装明确" },
    shotPackagingNotes: [
      { shotRef: "shot_1", fields: [{ label: "字幕", value: "大字" }], packagingFunction: "抓眼" },
      { shotRef: "shot_2", fields: [{ label: "字幕", value: "解释" }], packagingFunction: "证明" },
      { shotRef: "shot_3", fields: [{ label: "字幕", value: "转化" }], packagingFunction: "收束" },
    ],
    packagingBlocks: [{ label: "标题包装", shotRefs: ["shot_1"], fields: [], packagingFunction: "抓眼" }],
    claimStack: [],
    proofStack: [],
    conversionWrap: { summary: "无明确转化包装", shotRefs: ["shot_3"], fields: [] },
  }, createInput());

  assert.equal(missingField.ok, false);
  assert.equal(missingField.summary.path, "packagingBlocks[0]");
  assert.deepEqual(missingField.summary.missingFields, ["fields"]);

  const coverage = validatePackagingStructure({
    overview: { summary: "包装明确" },
    shotPackagingNotes: [
      { shotRef: "shot_2", fields: [{ label: "字幕", value: "解释" }], packagingFunction: "证明" },
    ],
    packagingBlocks: [],
    claimStack: [],
    proofStack: [],
    conversionWrap: { summary: "无明确转化包装", shotRefs: ["shot_3"], fields: [] },
  }, createInput());

  assert.equal(coverage.ok, false);
  assert.equal(coverage.summary.path, "shotPackagingNotes[].shotRef");
  assert.deepEqual(coverage.summary.missingShotRefs, ["shot_1", "shot_3"]);
});

test("malformed JSON output is reported as readable validation failure", () => {
  const context = {
    artifactId: "artifact_result",
    traceContext: { traceId: "trace_1" },
  };

  for (const [buildProcessedAnalysis, expectedCode] of [
    [buildScriptProcessedAnalysis, "script_segment_validation_failed"],
    [buildRhythmProcessedAnalysis, "rhythm_structure_validation_failed"],
    [buildPackagingProcessedAnalysis, "packaging_structure_validation_failed"],
  ]) {
    assert.throws(
      () => buildProcessedAnalysis("{ invalid json", createInput(), context, { turnId: "turn_1" }, { turnId: "turn_1" }),
      (error) => {
        assert.equal(error.code, expectedCode);
        assert.equal(error.debugPayload.validation.validatorCode, "agent_output_parse_failed");
        assert.equal(error.debugPayload.validation.path, "$");
        assert.match(error.debugPayload.validation.readableMessage, /合法 JSON object/);
        assert.equal(error.debugPayload.outputSummary.hasOwnProperty("messagePreview"), true);
        return true;
      },
    );
  }
});

function createInput() {
  return {
    sampleVideoId: "sample_1",
    parentArtifactId: "artifact_shot_boundary",
    shots: [
      { shotId: "shot_1", shotNo: "S001", start: 0, end: 1 },
      { shotId: "shot_2", shotNo: "S002", start: 1, end: 2 },
      { shotId: "shot_3", shotNo: "S003", start: 2, end: 3 },
    ],
  };
}
