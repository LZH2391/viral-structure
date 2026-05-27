const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createArtifactIndex } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createFunctionSlotAtomizationManualEditService } = require("../../Apps/Api/lib/function-slot-atomization/manual-edit-service");

test("manual boundary edit creates a new function slot atomization artifact and projects it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "function-slot-manual-edit-"));
  const store = createLocalStore(root);
  await store.ensureRuntimeDirs();
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1" });
  const stageLogs = [];
  const projected = [];
  const logger = {
    writeStageLog: async (entry) => {
      stageLogs.push(entry);
      return entry;
    },
    writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/manual-edit.json" }),
  };
  const service = createFunctionSlotAtomizationManualEditService({
    rootDir: root,
    store,
    logger,
    artifactIndex,
    projectionService: {
      projectArtifact: async (artifact) => {
        projected.push(artifact.functionSlotAtomizationAnalysis.artifactId);
        return { artifactId: artifact.functionSlotAtomizationAnalysis.artifactId };
      },
    },
  });
  const artifact = buildSampleArtifact();
  await store.writeJson(path.join(store.sampleDir(artifact.sampleVideoId), "artifact.json"), artifact);

  const result = await service.applyBoundaryManualEdit({
    sampleVideoId: artifact.sampleVideoId,
    expectedArtifactId: "artifact_atom_old",
    sourceBoundaryReviewArtifactId: "artifact_review_2",
    editedJsonText: JSON.stringify(buildEditedJson()),
  });

  const next = result.sampleArtifact.functionSlotAtomizationAnalysis;
  assert.equal(next.resultOrigin, "manual_boundary_edit");
  assert.equal(next.parentArtifactId, "artifact_atom_old");
  assert.equal(next.sourceFunctionSlotAtomizationArtifactId, "artifact_atom_old");
  assert.equal(next.manualBoundaryEdit.sourceBoundaryReviewArtifactId, "artifact_review_2");
  assert.equal(next.validation.manualEdit, true);
  assert.equal(projected.length, 1);
  assert.equal(projected[0], next.artifactId);
  assert.equal(stageLogs.some((entry) => entry.stageName === "function_slot_atomization.manual_boundary_edit" && entry.event === "stage.end"), true);
  const finalOutput = await fs.readFile(path.join(root, "Artifacts", "AnalysisFinalOutputs", artifact.sampleVideoId, "function-slot-atomization.final.txt"), "utf8");
  assert.match(finalOutput, /problem_to_solution_transition/);
});

test("manual boundary edit rejects stale source artifact", async () => {
  const { service, artifact } = await createManualEditFixture();

  await assert.rejects(
    service.applyBoundaryManualEdit({
      sampleVideoId: artifact.sampleVideoId,
      expectedArtifactId: "artifact_stale",
      sourceBoundaryReviewArtifactId: "artifact_review_2",
      editedJsonText: JSON.stringify(buildEditedJson()),
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "function_slot_atomization_manual_edit_stale");
      return true;
    },
  );
});

test("manual boundary edit only opens after automatic boundary rework limit", async () => {
  const { service, artifact } = await createManualEditFixture((analysis) => {
    analysis.validation.boundaryReworkAttemptCount = 0;
    analysis.boundaryReview.reviewAttemptCount = 1;
    analysis.boundaryReviewHistory = [{ artifactId: "artifact_review_1", decision: "rework", issues: [] }];
  });

  await assert.rejects(
    service.applyBoundaryManualEdit({
      sampleVideoId: artifact.sampleVideoId,
      expectedArtifactId: "artifact_atom_old",
      sourceBoundaryReviewArtifactId: "artifact_review_2",
      editedJsonText: JSON.stringify(buildEditedJson()),
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "function_slot_atomization_manual_edit_before_rework_limit");
      return true;
    },
  );
});

async function createManualEditFixture(mutator = null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "function-slot-manual-edit-"));
  const store = createLocalStore(root);
  await store.ensureRuntimeDirs();
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1" });
  const logger = {
    writeStageLog: async (entry) => entry,
    writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/manual-edit.json" }),
  };
  const service = createFunctionSlotAtomizationManualEditService({
    rootDir: root,
    store,
    logger,
    artifactIndex,
  });
  const artifact = buildSampleArtifact();
  mutator?.(artifact.functionSlotAtomizationAnalysis);
  await store.writeJson(path.join(store.sampleDir(artifact.sampleVideoId), "artifact.json"), artifact);
  return { service, artifact };
}

function buildSampleArtifact() {
  const analysis = {
    artifactId: "artifact_atom_old",
    parentArtifactId: "artifact_packaging",
    traceId: "trace_old",
    type: "function-slot-atomization-analysis",
    status: "processed",
    resultOrigin: "boundary_reworked_turn",
    stageName: "function_slot_atomization.materialize",
    sampleVideoId: "sample_manual_1",
    sourceScriptSegmentArtifactId: "artifact_script",
    sourceRhythmStructureArtifactId: "artifact_rhythm",
    sourcePackagingStructureArtifactId: "artifact_packaging",
    cacheKey: "cache_atom",
    atomInventory: {
      scriptAtoms: [{ id: "S001", slot: "problem_activation", label: "问题转行动", function: "具体旧表达", claimType: "problem", proofNeed: "状态变化", mustKeep: [], replaceableVariables: [], sourceRefs: { shotRefs: ["S001"] }, confidence: 0.8, needReview: false }],
      rhythmAtoms: [{ id: "R001", slot: "problem_activation", label: "快速推进", function: "聚焦注意", pace: "fast", densityType: "cut_density", beatShape: "tight", avoidFor: [], syncPoints: [], sourceRefs: { shotRefs: ["S001"] }, confidence: 0.8, needReview: false }],
      packagingAtoms: [{ id: "P001", slot: "problem_activation", label: "状态证明", function: "展示变化", packagingFunction: "展示变化", proofType: "visual", visualProofType: "before_after", visualHierarchy: "main", replaceableForms: [], risk: "", sourceRefs: { shotRefs: ["S001"] }, confidence: 0.8, needReview: false }],
    },
    slotMap: {
      slots: [{
        slotId: "F001",
        slotOrder: 1,
        slotName: "问题激活槽",
        slotType: "problem_activation",
        viewerStateBefore: "未关注",
        viewerStateAfter: "愿意行动",
        persuasionTask: "建立解决必要性",
        scriptAtomIds: ["S001"],
        rhythmAtomIds: ["R001"],
        packagingAtomIds: ["P001"],
        requiredSyncPoints: [],
        substitutionRules: [],
        sourceRefs: { shotRefs: ["S001"] },
        confidence: 0.8,
        needReview: false,
      }],
    },
    bindingGraph: { bindings: [{ id: "B001", type: "sync", slotIds: ["F001"], atomIds: ["S001", "R001", "P001"], rule: "同步问题和证明", riskIfBroken: "说服断裂", confidence: 0.8 }] },
    conflictChecks: [],
    recombinationRules: [{ id: "rule_1", slotIds: ["F001"], atomIds: ["S001"], reason: "旧具体表达", fix: "抽象化", appliesTo: ["old_specific"], sourceBindingIds: ["B001"] }],
    recompositionTemplates: [{ templateId: "T001", templateName: "基础模板", sequence: ["F001"] }],
    validation: { status: "passed", slotCount: 1, scriptAtomCount: 1, rhythmAtomCount: 1, packagingAtomCount: 1, bindingCount: 1, recombinationRuleCount: 1, templateCount: 1, validatorCode: null, repairAttemptCount: 0, boundaryReworkAttemptCount: 1 },
    boundaryReview: { artifactId: "artifact_review_2", decision: "rework", reason: "仍有具体样例内容", reviewAttemptCount: 2, issues: [{ issue: "applies_to 具体", minimalFix: "改为抽象引用", fieldPaths: ["recombination_rules[0].applies_to"] }] },
    boundaryReviewHistory: [{ artifactId: "artifact_review_1", decision: "rework", issues: [] }, { artifactId: "artifact_review_2", decision: "rework", issues: [] }],
    agent: { provider: "codex-appserver", role: "function-slot-atomization-analyzer", skillPath: "skill", threadId: "thread", leaseId: "lease", turnId: "turn" },
    createdAt: new Date().toISOString(),
  };
  return {
    sampleVideoId: "sample_manual_1",
    workspaceId: "default-workspace",
    status: "processed",
    trace: { traceId: "trace_sample" },
    metadata: { durationSeconds: 10, width: 1080, height: 1920 },
    sampleVideo: {
      artifactId: "artifact_video",
      parentArtifactId: null,
      original: { artifactId: "artifact_original", parentArtifactId: null, type: "original-video", summary: "sample.mp4", uri: "/runtime/sample.mp4" },
      normalized: { artifactId: "artifact_normalized", parentArtifactId: "artifact_original", type: "normalized-video", summary: "normalized", uri: "/runtime/normalized.mp4" },
    },
    frames: [],
    functionSlotAtomizationAnalysis: analysis,
  };
}

function buildEditedJson() {
  return {
    atom_inventory: {
      script_atoms: [{ id: "S001", slot: "problem_activation", label: "问题转行动", semantic_function: "将高关注问题对象转成解决动作", claim_type: "problem", proof_need: "状态变化", dependency_before: [], dependency_after: [], must_keep: [], replaceable_variables: [], source_refs: { shot_refs: ["S001"] }, confidence: 0.8, need_review: false }],
      rhythm_atoms: [{ id: "R001", slot: "problem_activation", label: "快速推进", attention_function: "聚焦注意", pace: "fast", density_type: "cut_density", beat_shape: "tight", best_for_script_functions: [], avoid_for: [], sync_points: [], source_refs: { shot_refs: ["S001"] }, confidence: 0.8, need_review: false }],
      packaging_atoms: [{ id: "P001", slot: "problem_activation", label: "状态证明", packaging_function: "展示变化", visual_elements: [], visual_hierarchy: "main", proof_type: "visual", visual_proof_type: "before_after", replaceable_forms: [], risk: "", source_refs: { shot_refs: ["S001"] }, confidence: 0.8, need_review: false }],
    },
    slot_map: {
      slots: [{ slot_id: "F001", slot_order: 1, slot_name: "问题激活槽", slot_type: "problem_activation", viewer_state_before: "未关注", viewer_state_after: "愿意行动", persuasion_task: "建立解决必要性", script_atom_ids: ["S001"], rhythm_atom_ids: ["R001"], packaging_atom_ids: ["P001"], required_sync_points: [], substitution_rules: [], source_refs: { shot_refs: ["S001"] }, confidence: 0.8, need_review: false }],
    },
    binding_graph: { bindings: [{ id: "B001", type: "sync", slot_ids: ["F001"], atom_ids: ["S001", "R001", "P001"], rule: "同步问题和证明", risk_if_broken: "说服断裂", confidence: 0.8 }] },
    conflict_checks: [],
    recombination_rules: [{ id: "rule_1", slot_ids: ["F001"], atom_ids: ["S001"], reason: "适用于问题到解决的转换", fix: "保持抽象引用", applies_to: ["problem_to_solution_transition"], source_binding_ids: ["B001"] }],
    recomposition_templates: [{ template_id: "T001", template_name: "基础模板", sequence: ["F001"] }],
  };
}
