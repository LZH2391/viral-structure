const test = require("node:test");
const assert = require("node:assert/strict");

const { loadRoleProfileByRole } = require("../../Apps/Api/lib/gateways/threadpool/role-profile-loader");
const { renderBoundaryReworkTurnInputs } = require("../../Apps/Api/lib/function-slot-atomization-analysis/input");
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
  assert.equal(typeof descriptor.runBoundaryRework, "function");
  assert.equal(descriptor.STAGES.boundaryReviewed, "function_slot_atomization.boundary_review");
  assert.equal(descriptor.STAGES.boundaryReworked, "function_slot_atomization.boundary_rework");
  assert.equal(descriptor.progress.boundaryReviewed, 90);
  assert.equal(descriptor.progress.boundaryReworked, 92);
});

test("function slot atomization descriptor adapts cache lookup to analysis runtime", async () => {
  const calls = [];
  const descriptor = createFunctionSlotAtomizationPipelineDescriptor({
    store: {},
    artifactIndex: {
      getItem: async () => ({ fileHash: "file_hash_1" }),
      findCacheEntry: async () => null,
    },
  });
  const context = {
    sampleVideoId: "sample_1",
    cacheDecision: "ask",
    artifactId: "artifact_atomization",
    cacheKey: "cache_key_1",
    skillHash: "skill_hash_1",
    roleProfile: { profileVersion: "profile.v1" },
    promptTemplate: { promptTemplateId: "analyze", promptTemplateVersion: "prompt.v1", promptTemplateHash: "prompt_hash" },
  };
  const input = {
    parentArtifactId: "artifact_packaging",
    sourceScriptSegmentArtifactId: "artifact_script",
    sourceRhythmStructureArtifactId: "artifact_rhythm",
    sourcePackagingStructureArtifactId: "artifact_packaging",
  };
  const runtime = {
    runStage: async (stageContext, stageName, progress, options) => {
      calls.push({ stageContext, stageName, progress, inputSummary: options.inputSummary });
      const result = await options.action();
      options.outputSummary(result);
      return result;
    },
  };

  const cached = await descriptor.runCacheLookup({ context, input, runtime });

  assert.equal(cached, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stageContext, context);
  assert.equal(calls[0].stageName, descriptor.STAGES.cacheLookup);
  assert.equal(calls[0].progress, descriptor.progress.cacheLookup);
  assert.equal(calls[0].inputSummary.sourcePackagingStructureArtifactId, "artifact_packaging");
});

test("function slot analyzer renders boundary rework turn with reviewer issues", async () => {
  const roleProfile = await loadRoleProfileByRole("function-slot-atomization-analyzer");
  const turn = renderBoundaryReworkTurnInputs({
    inputPackage: {
      manifestPath: "C:/tmp/manifest.json",
      outputContractPath: "C:/tmp/output-contract.json",
      manifest: {
        scriptSegmentAnalysis: { segments: [{ segmentId: "seg_1" }] },
        rhythmStructureAnalysis: { sections: [{ sectionId: "rhythm_1" }] },
        packagingStructureAnalysis: { packagingBlocks: [{ blockId: "pkg_1" }], shotPackagingNotes: [] },
      },
      lineage: {},
      outputContract: {},
    },
    boundaryReview: {
      decision: "rework",
      reason: "AtomCore 字段包含样例内容",
      issues: [{
        issue: "semantic_function 写入具体品类",
        minimalFix: "改成抽象说服任务",
        fieldPaths: ["atom_inventory.script_atoms[0].semantic_function"],
      }],
    },
    priorTurnOutput: "{\"atom_inventory\":{\"script_atoms\":[]}}",
    reworkAttemptCount: 1,
    roleProfile,
  });

  assert.equal(turn.promptTemplateId, "boundaryRework");
  assert.match(turn.text, /boundary reviewer/);
  assert.match(turn.text, /semantic_function/);
  assert.match(turn.text, /上一轮 JSON/);
  assert.doesNotMatch(turn.text, /manifestPath/);
  assert.doesNotMatch(turn.text, /outputContractPath/);
});
