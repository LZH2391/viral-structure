const test = require("node:test");
const assert = require("node:assert/strict");

const { loadRoleProfileByRole } = require("../../Apps/Api/lib/gateways/threadpool/role-profile-loader");
const { renderReviewTurnInputs } = require("../../Apps/Api/lib/function-slot-atomization-boundary-review/input");
const { validateBoundaryReviewResult } = require("../../Apps/Api/lib/function-slot-atomization-boundary-review/validation");
const { REVIEW_ROLE } = require("../../Apps/Api/lib/function-slot-atomization-boundary-review");
const { createFunctionSlotAtomizationPipelineDescriptor } = require("../../Apps/Api/lib/function-slot-atomization/pipeline-descriptor");

test("function slot boundary reviewer profile renders field roles and final output path", async () => {
  const roleProfile = await loadRoleProfileByRole(REVIEW_ROLE);
  const turn = renderReviewTurnInputs({
    context: { sampleVideoId: "sample_1" },
    analysis: {
      artifactId: "artifact_atomization",
      sourceScriptSegmentArtifactId: "artifact_script",
      sourceRhythmStructureArtifactId: "artifact_rhythm",
      sourcePackagingStructureArtifactId: "artifact_packaging",
      agent: {
        role: "function-slot-atomization-analyzer",
        threadId: "thread_analyzer",
        turnId: "turn_analyzer",
      },
    },
    finalOutput: {
      filePath: "C:/ByteDanceFullStack/Artifacts/AnalysisFinalOutputs/sample_1/function-slot-atomization.final.txt",
      manifestPath: "C:/ByteDanceFullStack/Artifacts/AnalysisFinalOutputs/sample_1/manifest.json",
    },
    roleProfile,
  });

  assert.equal(turn.promptTemplateId, "review");
  assert.match(turn.text, /finalOutputPath/);
  assert.match(turn.text, /AtomCore/);
  assert.equal(turn.manifest.functionSlotAtomizationArtifactId, "artifact_atomization");
  assert.equal(turn.fieldRoles["AtomCore.Graph"].includes("binding_graph.bindings[].{slot_ids,atom_ids}"), true);
  assert.match(turn.fieldRolesHash, /^[a-f0-9]{64}$/);
});

test("function slot boundary review validation keeps the minimal reviewer contract", () => {
  const result = validateBoundaryReviewResult(JSON.stringify({
    decision: "rework",
    reason: "AtomCore 字段包含样例内容",
    issues: [{
      issue: "semantic_function 写入具体品类",
      minimal_fix: "改成抽象说服任务",
      field_paths: ["atom_inventory.script_atoms[0].semantic_function"],
    }],
  }), { turnId: "turn_review" });

  assert.equal(result.decision, "rework");
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].minimalFix, "改成抽象说服任务");
  assert.deepEqual(result.issues[0].fieldPaths, ["atom_inventory.script_atoms[0].semantic_function"]);
});

test("function slot atomization descriptor exposes an internal boundary review hook", () => {
  const descriptor = createFunctionSlotAtomizationPipelineDescriptor({ store: {} });
  assert.equal(typeof descriptor.runBoundaryReview, "function");
  assert.equal(descriptor.STAGES.boundaryReviewed, "function_slot_atomization.boundary_review");
  assert.equal(descriptor.progress.boundaryReviewed, 90);
});
