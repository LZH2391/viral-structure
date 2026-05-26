const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createFunctionSlotProjectionStore } = require("../../Infrastructure/FunctionSlotProjection/function-slot-projection-store");
const { createFunctionSlotProjectionService } = require("../../Apps/Api/lib/function-slot-projection/service");
const { validateFunctionSlotAtomization } = require("../../Apps/Api/lib/function-slot-atomization-analysis/validation");
const { createMaterializeRuntime } = require("../../Apps/Api/lib/analysis-runtime-v2/materialize-runtime");
const { createServer } = require("../../Apps/Api/server");

test("function slot projection stores slots, split atom subtype fields, bindings, rules and templates", async () => {
  const { store, projectionStore } = await createTempProjectionStore("bd-function-slot-projection-");
  const artifact = buildArtifact();

  const summary = await projectionStore.projectArtifact(artifact);
  assert.equal(summary.slotCount, 5);
  assert.equal(summary.atomCount, 15);
  assert.equal(summary.bindingCount, 7);
  assert.equal(summary.ruleCount, 6);
  assert.equal(summary.templateCount, 1);

  const slots = await projectionStore.querySlots({ slotType: "problem_activation" });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].viewerStateBefore, "before 1");
  assert.equal(slots[0].viewerStateAfter, "after 1");
  assert.equal(slots[0].traceId, "trace_projection");

  const atoms = await projectionStore.queryAtoms({ atomType: "packaging" });
  assert.equal(atoms.length, 5);

  const db = new DatabaseSync(projectionStore.dbPath);
  try {
    const script = db.prepare("SELECT claimType, proofNeed FROM function_script_atoms WHERE artifactId = ? AND atomId = ?").get("artifact_function_slot", "S001");
    const rhythm = db.prepare("SELECT pace, densityType FROM function_rhythm_atoms WHERE artifactId = ? AND atomId = ?").get("artifact_function_slot", "R001");
    const packaging = db.prepare("SELECT proofType, visualHierarchy, visualElementsJson FROM function_packaging_atoms WHERE artifactId = ? AND atomId = ?").get("artifact_function_slot", "P001");
    assert.equal(script.claimType, "problem_to_action");
    assert.equal(script.proofNeed, "proof 1");
    assert.equal(rhythm.pace, "fast_staccato");
    assert.equal(rhythm.densityType, "cut_density");
    assert.equal(packaging.proofType, "direct_visual_problem_and_action_proof");
    assert.equal(packaging.visualHierarchy, "hierarchy 1");
    assert.deepEqual(JSON.parse(packaging.visualElementsJson), ["circle", "subtitle"]);
  } finally {
    db.close();
  }

  assert.ok(store.runtimeRoot);
});

test("function slot projection is idempotent per artifactId and queryable by source artifact", async () => {
  const { projectionStore } = await createTempProjectionStore("bd-function-slot-projection-idempotent-");
  const artifact = buildArtifact();

  await projectionStore.projectArtifact(artifact);
  await projectionStore.projectArtifact(artifact);

  const counts = await projectionStore.countRows();
  assert.equal(counts.artifacts, 1);
  assert.equal(counts.slots, 5);
  assert.equal(counts.atoms, 15);
  assert.equal(counts.bindings, 7);

  const rules = await projectionStore.queryRules({ sourceArtifactId: "artifact_script" });
  assert.equal(rules.length, 6);
});

test("function slot projection service rebuilds from Runtime artifacts", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-function-slot-projection-rebuild-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const artifact = buildArtifact();
  const sampleDir = await store.ensureSampleDirs(artifact.sampleVideoId);
  await store.writeJson(path.join(sampleDir, "artifact.json"), artifact);
  const service = createFunctionSlotProjectionService({ store });

  await service.store.projectArtifact({
    sampleVideoId: "stale_sample",
    functionSlotAtomizationAnalysis: {
      ...artifact.functionSlotAtomizationAnalysis,
      artifactId: "artifact_stale_projection",
      sampleVideoId: "stale_sample",
    },
  });
  const result = await service.rebuildFromRuntimeArtifacts();

  assert.equal(result.projectedArtifactCount, 1);
  assert.equal((await service.querySlots({ sampleVideoId: "sample_projection" })).length, 5);
  assert.equal((await service.querySlots({ sampleVideoId: "stale_sample" })).length, 0);
});

test("materialize runtime records projection success without changing artifact registration", async () => {
  const events = [];
  const artifact = buildArtifact();
  const runtime = createMaterializeRuntime({
    artifactIndex: {
      registerSampleArtifact: async () => ({ ok: true }),
    },
    resolveExistingFileHash: async () => "file_hash",
    projectionService: {
      projectArtifact: async () => ({ slotCount: 5, atomCount: 15 }),
    },
    logger: {
      writeStageLog: async (event) => events.push(event),
      writeDebugSnapshot: async () => ({ uri: "/runtime/snapshot.json" }),
    },
  });

  const result = await runtime.registerSampleArtifact(buildContext(), artifact);

  assert.equal(result, artifact);
  assert.deepEqual(events.map((event) => event.event), ["stage.start", "stage.end"]);
  assert.equal(events[0].stageName, "function_slot_projection.materialize");
});

test("materialize runtime isolates projection failure and writes debug snapshot", async () => {
  const events = [];
  const snapshots = [];
  const artifact = buildArtifact();
  const runtime = createMaterializeRuntime({
    artifactIndex: {
      registerSampleArtifact: async () => ({ ok: true }),
    },
    resolveExistingFileHash: async () => "file_hash",
    projectionService: {
      projectArtifact: async () => {
        throw new Error("sqlite write failed");
      },
    },
    logger: {
      writeStageLog: async (event) => events.push(event),
      writeDebugSnapshot: async (snapshot) => {
        snapshots.push(snapshot);
        return { uri: "/runtime/snapshot.json" };
      },
    },
  });

  const result = await runtime.registerSampleArtifact(buildContext(), artifact);

  assert.equal(result, artifact);
  assert.deepEqual(events.map((event) => event.event), ["stage.start", "stage.fail"]);
  assert.equal(events[1].errorSummary.code, "function_slot_projection_failed");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].debugPayload.message, "sqlite write failed");
});

test("function slot projection API exposes query and rebuild routes", async () => {
  const calls = [];
  const server = createServer({
    functionSlotProjectionService: {
      querySlots: async (filters) => {
        calls.push({ method: "querySlots", filters });
        return [{ artifactId: "artifact_function_slot", sampleVideoId: "sample_projection", traceId: "trace_projection" }];
      },
      queryAtoms: async () => [],
      queryBindings: async () => [],
      queryRules: async () => [],
      rebuildFromRuntimeArtifacts: async () => ({ projectedArtifactCount: 1 }),
    },
    staticWorkbench: { handle: () => false },
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/snapshot.json" }),
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const slots = await makeRequest(server, "GET", "/api/function-slot-projection/slots?slotType=problem_activation");
    assert.equal(slots.statusCode, 200);
    assert.equal(slots.body.items[0].traceId, "trace_projection");
    assert.deepEqual(calls[0], { method: "querySlots", filters: { slotType: "problem_activation" } });

    const rebuild = await makeRequest(server, "POST", "/api/function-slot-projection/rebuild");
    assert.equal(rebuild.statusCode, 200);
    assert.equal(rebuild.body.projectedArtifactCount, 1);
  } finally {
    await closeServer(server);
  }
});

function makeRequest(server, method, requestPath) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method,
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: { connection: "close" },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function createTempProjectionStore(prefix) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  return {
    store,
    projectionStore: createFunctionSlotProjectionStore({ store }),
  };
}

function buildContext() {
  return {
    sampleVideoId: "sample_projection",
    traceContext: { runId: "run_projection", traceId: "trace_projection", stageId: "stage_projection" },
    nextStage: (traceContext) => ({ ...traceContext, stageId: "stage_projection_next" }),
  };
}

function buildArtifact() {
  const validation = validateFunctionSlotAtomization(buildAgentPayload());
  assert.equal(validation.ok, true);
  return {
    sampleVideoId: "sample_projection",
    trace: { traceId: "trace_sample" },
    functionSlotAtomizationAnalysis: {
      artifactId: "artifact_function_slot",
      parentArtifactId: "artifact_packaging",
      traceId: "trace_projection",
      type: "function-slot-atomization-analysis",
      status: "processed",
      stageName: "function_slot_atomization.materialize",
      sampleVideoId: "sample_projection",
      sourceScriptSegmentArtifactId: "artifact_script",
      sourceRhythmStructureArtifactId: "artifact_rhythm",
      sourcePackagingStructureArtifactId: "artifact_packaging",
      sourceShotBoundaryArtifactId: "artifact_shot",
      atomInventory: validation.analysis.atomInventory,
      slotMap: validation.analysis.slotMap,
      bindingGraph: validation.analysis.bindingGraph,
      conflictChecks: validation.analysis.conflictChecks,
      recombinationRules: validation.analysis.recombinationRules,
      recompositionTemplates: validation.analysis.recompositionTemplates,
      validation: { status: "passed" },
      agent: { role: "function-slot-atomization-analyzer" },
      createdAt: "2026-05-26T00:00:00.000Z",
    },
  };
}

function buildAgentPayload() {
  const slotTypes = ["problem_activation", "mechanism_credibility", "low_barrier_operation", "result_confirmation", "long_term_trust_close"];
  return {
    atom_inventory: {
      script_atoms: slotTypes.map((slot, index) => ({
        id: `S${String(index + 1).padStart(3, "0")}`,
        slot,
        label: `script ${index + 1}`,
        semantic_function: `script function ${index + 1}`,
        claim_type: index === 0 ? "problem_to_action" : "claim",
        proof_need: `proof ${index + 1}`,
        must_keep: ["must"],
        replaceable_variables: ["replace"],
        source_refs: { script_segment_labels: [`segment ${index + 1}`], shot_refs: [`shot_${index + 1}`] },
        confidence: 0.9,
        need_review: false,
      })),
      rhythm_atoms: slotTypes.map((slot, index) => ({
        id: `R${String(index + 1).padStart(3, "0")}`,
        slot,
        label: `rhythm ${index + 1}`,
        attention_function: `rhythm function ${index + 1}`,
        pace: index === 0 ? "fast_staccato" : "steady",
        density_type: index === 0 ? "cut_density" : "explanation_density",
        beat_shape: `beat ${index + 1}`,
        avoid_for: ["avoid"],
        sync_points: ["sync"],
        source_refs: { rhythm_section_labels: [`section ${index + 1}`], shot_refs: [`shot_${index + 1}`] },
        confidence: 0.9,
        need_review: false,
      })),
      packaging_atoms: slotTypes.map((slot, index) => ({
        id: `P${String(index + 1).padStart(3, "0")}`,
        slot,
        label: `packaging ${index + 1}`,
        packaging_function: `packaging function ${index + 1}`,
        visual_elements: ["circle", "subtitle"],
        visual_hierarchy: `hierarchy ${index + 1}`,
        proof_type: index === 0 ? "direct_visual_problem_and_action_proof" : "proof_type",
        replaceable_style: ["style"],
        risk: `risk ${index + 1}`,
        source_refs: { packaging_block_labels: [`block ${index + 1}`], shot_refs: [`shot_${index + 1}`] },
        confidence: 0.9,
        need_review: false,
      })),
    },
    slot_map: {
      slots: slotTypes.map((slot, index) => ({
        slot_id: `F${String(index + 1).padStart(3, "0")}`,
        slot_order: index + 1,
        slot_name: `slot ${index + 1}`,
        slot_type: slot,
        viewer_state_before: `before ${index + 1}`,
        viewer_state_after: `after ${index + 1}`,
        persuasion_task: `task ${index + 1}`,
        script_atom_ids: [`S${String(index + 1).padStart(3, "0")}`],
        rhythm_atom_ids: [`R${String(index + 1).padStart(3, "0")}`],
        packaging_atom_ids: [`P${String(index + 1).padStart(3, "0")}`],
        source_refs: { shot_refs: [`shot_${index + 1}`] },
        confidence: 0.9,
        need_review: false,
      })),
    },
    binding_graph: {
      bindings: Array.from({ length: 7 }, (_, index) => ({
        id: `B${String(index + 1).padStart(3, "0")}`,
        type: index === 1 ? "require" : "sync",
        slot_ids: [`F${String((index % 5) + 1).padStart(3, "0")}`],
        atom_ids: [`S${String((index % 5) + 1).padStart(3, "0")}`],
        rule: `binding rule ${index + 1}`,
        risk_if_broken: `binding risk ${index + 1}`,
        confidence: 0.9,
      })),
    },
    conflict_checks: Array.from({ length: 3 }, (_, index) => ({
      id: `C${String(index + 1).padStart(3, "0")}`,
      slot_ids: [`F${String(index + 1).padStart(3, "0")}`],
      reason: `conflict ${index + 1}`,
      fix: `fix ${index + 1}`,
    })),
    recombination_rules: Array.from({ length: 3 }, (_, index) => ({
      id: `RULE${String(index + 1).padStart(3, "0")}`,
      rule: `recombination ${index + 1}`,
      applies_to: [slotTypes[index]],
      source_binding_ids: [`B${String(index + 1).padStart(3, "0")}`],
    })),
    recomposition_templates: [{
      template_id: "T001",
      template_name: "template",
      sequence: slotTypes,
    }],
  };
}
