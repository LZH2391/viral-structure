const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { once } = require("node:events");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createFunctionSlotProjectionStore } = require("../../Infrastructure/FunctionSlotProjection/function-slot-projection-store");
const { createFunctionSlotProjectionService } = require("../../Apps/Api/lib/function-slot-projection/service");
const { createFunctionSlotLibraryService, FILES, SCHEMA_VERSION } = require("../../Apps/Api/lib/function-slot-library/service");
const { buildFunctionSlotGovernanceGraph } = require("../../Apps/Api/lib/function-slot-library/governance-graph");
const { createServer } = require("../../Apps/Api/server");

test("function slot library exports fixed json files with manifest counts and hash", async () => {
  const { store, service, libraryRoot } = await createTempLibraryService();
  const artifact = buildArtifact();
  await writeRuntimeArtifact(store, artifact);

  const result = await service.exportSampleArtifact("sample_library");
  const itemDir = path.join(libraryRoot, "artifact_function_slot");
  const files = await fs.readdir(itemDir);
  const manifest = await readJson(path.join(itemDir, FILES.manifest));
  const rhythmAtoms = await readJson(path.join(itemDir, FILES.rhythmAtoms));

  assert.equal(result.exported, true);
  assert.equal(result.itemPath, "Artifacts/FunctionSlotLibrary/artifact_function_slot");
  assert.deepEqual(files.sort(), Object.values(FILES).sort());
  assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
  assert.equal(manifest.sampleVideoId, "sample_library");
  assert.equal(manifest.sourceVideoName, "source-library.mp4");
  assert.equal(manifest.traceId, "trace_library");
  assert.equal(manifest.counts.slotCount, 2);
  assert.equal(manifest.counts.atomCount, 6);
  assert.equal(manifest.counts.bindingCount, 2);
  assert.equal(manifest.counts.ruleCount, 2);
  assert.equal(manifest.counts.templateCount, 1);
  assert.match(manifest.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(rhythmAtoms[0].timingEvidence.shotCount, 1);
  assert.equal(rhythmAtoms[0].timingEvidence.totalDurationSec, 1.2);
  assert.equal(rhythmAtoms[0].timingEvidence.shotTimings[0].subtitleText, "这是字幕");
});

test("function slot library export supports skip-existing and replace", async () => {
  const { store, service, libraryRoot } = await createTempLibraryService();
  await writeRuntimeArtifact(store, buildArtifact({ createdAt: "2026-05-26T00:00:00.000Z" }));

  await service.exportSampleArtifact("sample_library", { mode: "replace" });
  const firstManifest = await readJson(path.join(libraryRoot, "artifact_function_slot", FILES.manifest));
  await writeRuntimeArtifact(store, buildArtifact({ createdAt: "2026-05-27T00:00:00.000Z", extraSlot: true }));

  const skipped = await service.exportSampleArtifact("sample_library", { mode: "skip-existing" });
  const afterSkip = await readJson(path.join(libraryRoot, "artifact_function_slot", FILES.manifest));
  const replaced = await service.exportSampleArtifact("sample_library", { mode: "replace" });
  const afterReplace = await readJson(path.join(libraryRoot, "artifact_function_slot", FILES.manifest));

  assert.equal(skipped.exported, false);
  assert.equal(skipped.skipped, true);
  assert.equal(afterSkip.contentHash, firstManifest.contentHash);
  assert.equal(replaced.exported, true);
  assert.notEqual(afterReplace.contentHash, firstManifest.contentHash);
  assert.equal(afterReplace.counts.slotCount, 3);
});

test("function slot library lists manifests in stable order", async () => {
  const { store, service } = await createTempLibraryService();
  await writeRuntimeArtifact(store, buildArtifact({ artifactId: "artifact_old", exportedAt: "unused", traceId: "trace_old" }));
  await service.exportSampleArtifact("sample_library", { mode: "replace" });
  await writeRuntimeArtifact(store, buildArtifact({ artifactId: "artifact_new", traceId: "trace_new" }));
  await service.exportSampleArtifact("sample_library", { mode: "replace" });

  const items = await service.listLibraryItems();
  assert.deepEqual(items.map((item) => item.artifactId), ["artifact_new", "artifact_old"]);
  assert.equal(items[0].sourceVideoName, "source-library.mp4");
});

test("function slot library rejects failed or empty atomization exports", async () => {
  const { store, service } = await createTempLibraryService();
  await writeRuntimeArtifact(store, buildArtifact({ status: "failed", emptyAtomization: true }));

  await assert.rejects(
    service.exportSampleArtifact("sample_library", { mode: "replace" }),
    (error) => {
      assert.equal(error.code, "function_slot_library_unpublishable_atomization");
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});

test("function slot library hides existing failed or empty items from lists and graphs", async () => {
  const { libraryRoot, service } = await createTempLibraryService();
  const itemDir = path.join(libraryRoot, "artifact_empty");
  await fs.mkdir(itemDir, { recursive: true });
  await fs.writeFile(path.join(itemDir, FILES.manifest), `${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    artifactId: "artifact_empty",
    sampleVideoId: "sample_empty",
    traceId: "trace_empty",
    status: "failed",
    counts: { slotCount: 0, atomCount: 0 },
  }, null, 2)}\n`, "utf8");
  await Promise.all([
    fs.writeFile(path.join(itemDir, FILES.slots), "[]\n", "utf8"),
    fs.writeFile(path.join(itemDir, FILES.scriptAtoms), "[]\n", "utf8"),
    fs.writeFile(path.join(itemDir, FILES.rhythmAtoms), "[]\n", "utf8"),
    fs.writeFile(path.join(itemDir, FILES.packagingAtoms), "[]\n", "utf8"),
    fs.writeFile(path.join(itemDir, FILES.bindings), "[]\n", "utf8"),
    fs.writeFile(path.join(itemDir, FILES.rules), "{\"conflictChecks\":[],\"recombinationRules\":[]}\n", "utf8"),
    fs.writeFile(path.join(itemDir, FILES.templates), "[]\n", "utf8"),
  ]);

  const items = await service.listLibraryItems();
  const artifact = await service.readLibraryArtifact("artifact_empty");

  assert.deepEqual(items, []);
  assert.equal(artifact, null);
});

test("function slot library projects one item into projection without deleting library item", async () => {
  const { store, service, projectionService, libraryRoot } = await createTempLibraryService();
  await writeRuntimeArtifact(store, buildArtifact());
  const exported = await service.exportSampleArtifact("sample_library");

  const projected = await service.projectLibraryArtifact(exported.manifest.artifactId);
  const slots = await projectionService.querySlots({ artifactId: "artifact_function_slot" });
  const atoms = await projectionService.queryAtoms({ artifactId: "artifact_function_slot" });
  const deleted = await service.deleteLibraryItem("artifact_function_slot");
  const stillProjected = await projectionService.getArtifactProjectionSummary("artifact_function_slot");

  assert.equal(projected.slotCount, exported.manifest.counts.slotCount);
  assert.equal(projected.atomCount, exported.manifest.counts.atomCount);
  assert.equal(slots.length, 2);
  assert.equal(atoms.length, 6);
  assert.equal(deleted.deleted, true);
  await assert.rejects(fs.stat(path.join(libraryRoot, "artifact_function_slot")));
  assert.equal(stillProjected.slotCount, 2);
});

test("function slot library API exposes export, list, project and delete routes", async () => {
  const calls = [];
  const server = createServer({
    functionSlotLibraryService: {
      exportSampleArtifact: async (sampleVideoId, options) => {
        calls.push({ method: "exportSampleArtifact", sampleVideoId, options });
        return { exported: true, manifest: { artifactId: "artifact_function_slot", sampleVideoId, traceId: "trace_library", counts: { slotCount: 2 }, contentHash: "hash" } };
      },
      listLibraryItems: async () => [{ artifactId: "artifact_function_slot", sampleVideoId: "sample_library", sourceVideoName: "source-library.mp4", traceId: "trace_library" }],
      projectLibraryArtifact: async (artifactId) => {
        calls.push({ method: "projectLibraryArtifact", artifactId });
        return { projected: true, artifactId, sampleVideoId: "sample_library", slotCount: 2 };
      },
      readLibraryArtifact: async (artifactId) => ({
        sampleVideoId: "sample_library",
        functionSlotAtomizationAnalysis: buildArtifact({ artifactId }).functionSlotAtomizationAnalysis,
      }),
      deleteLibraryItem: async (artifactId) => {
        calls.push({ method: "deleteLibraryItem", artifactId });
        return { deleted: true, manifest: { artifactId, sampleVideoId: "sample_library" } };
      },
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
    const exported = await makeRequest(server, "POST", "/api/sample-videos/sample_library/function-slot-library/export?mode=skip-existing");
    const listed = await makeRequest(server, "GET", "/api/function-slot-library");
    const graph = await makeRequest(server, "GET", "/api/function-slot-library/artifact_function_slot/graph");
    const projected = await makeRequest(server, "POST", "/api/function-slot-library/artifact_function_slot/project");
    const deleted = await makeRequest(server, "DELETE", "/api/function-slot-library/artifact_function_slot");

    assert.equal(exported.statusCode, 200);
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.body.items[0].traceId, "trace_library");
    assert.equal(listed.body.items[0].sourceVideoName, "source-library.mp4");
    assert.equal(graph.statusCode, 200);
    assert.equal(graph.body.schemaVersion, "function_slot_library_graph.v1");
    assert.equal(graph.body.summary.slotCount, 2);
    assert.ok(graph.body.nodes.some((node) => node.type === "slotInstance" && node.data.stableId === "artifact_function_slot:F1"));
    assert.equal(projected.body.projected, true);
    assert.equal(deleted.body.deleted, true);
    assert.deepEqual(calls, [
      { method: "exportSampleArtifact", sampleVideoId: "sample_library", options: { mode: "skip-existing" } },
      { method: "projectLibraryArtifact", artifactId: "artifact_function_slot" },
      { method: "deleteLibraryItem", artifactId: "artifact_function_slot" },
    ]);
  } finally {
    await closeServer(server);
  }
});

test("function slot library builder refresh route returns index and governance outputs", async () => {
  const calls = [];
  const server = createServer({
    functionSlotLibraryBuilderService: {
      refresh: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          traceId: "trace_builder",
          runId: "run_builder",
          stageId: "stage_builder",
          exported: { sampleCount: 2, exportedCount: 1, skippedCount: 1, items: [] },
          validation: { exitCode: 0, path: "Runtime/Temp/FunctionSlotLibrary/validation.json" },
          slotIndex: { path: "Runtime/Temp/FunctionSlotLibrary/slot_index.json" },
          governance: { path: "Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json" },
        };
      },
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeJsonRequest(server, "POST", "/api/function-slot-library/builder/refresh", { mode: "replace", updateGovernance: true });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.traceId, "trace_builder");
    assert.equal(response.body.exported.exportedCount, 1);
    assert.equal(response.body.slotIndex.path, "Runtime/Temp/FunctionSlotLibrary/slot_index.json");
    assert.deepEqual(calls, [{ mode: "replace", updateGovernance: true }]);
  } finally {
    await closeServer(server);
  }
});

test("storyboard prep auto-run requires confirmed restructure source", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "bd-storyboard-auto-run-"));
  const calls = [];
  const materialPackPath = path.join(rootDir, "Runtime", "Artifacts", "sample_1", "analysis-results", "user_material_pack", "artifact_pack.json");
  await fs.mkdir(path.dirname(materialPackPath), { recursive: true });
  await fs.writeFile(materialPackPath, JSON.stringify({ type: "user-material-pack", schemaVersion: "user-material-pack.stable" }), "utf8");
  const server = createServer({
    rootDir,
    shotStoryboardAutoPipelineService: {
      enqueue: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          processingJobId: "job_storyboard",
          sampleVideoId: payload.sampleVideoId,
          traceId: "trace_storyboard",
          runId: "run_storyboard",
          stageId: "stage_storyboard",
          artifactId: "artifact_storyboard",
          parentArtifactId: payload.parentArtifactId,
          status: "processing",
          role: "shot-storyboard-prep",
          message: "pipeline started",
        };
      },
    },
    agentConversationStore: {
      get: async (conversationId) => ({
        conversationId,
        confirmedPlan: {
          sourceRestructurePath: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md",
          sourceShotDesignPath: "Artifacts/FunctionSlotRestructure/demo/shot-design.final.md",
        },
        messages: [
          { role: "user", text: `${materialPackPath}, 一个素材包` },
        ],
      }),
    },
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/snapshot.json" }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const missing = await makeJsonRequest(server, "POST", "/api/function-slot-workflow/storyboard-prep/auto-run", { sampleVideoId: "sample_1" });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.body.code, "storyboard_prep_restructure_required");

    const artifactOnly = await makeJsonRequest(server, "POST", "/api/function-slot-workflow/storyboard-prep/auto-run", {
      sampleVideoId: "sample_1",
      restructureArtifactId: "artifact_restructure",
    });
    assert.equal(artifactOnly.statusCode, 400);
    assert.equal(artifactOnly.body.code, "storyboard_prep_restructure_required");

    const response = await makeJsonRequest(server, "POST", "/api/function-slot-workflow/storyboard-prep/auto-run", {
      sampleVideoId: "sample_1",
      conversationId: "conversation_confirmed",
      parentArtifactId: "artifact_restructure",
      confirmationId: "confirm_1",
      runImageGeneration: true,
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.status, "processing");
    assert.equal(response.body.role, "shot-storyboard-prep");
    assert.equal(response.body.processingJobId, "job_storyboard");
    assert.equal(response.body.artifactId, "artifact_storyboard");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sampleVideoId, "sample_1");
    assert.equal(calls[0].restructureFinalPath, "Artifacts/FunctionSlotRestructure/demo/restructure.final.md");
    assert.equal(calls[0].shotDesignFinalPath, "Artifacts/FunctionSlotRestructure/demo/shot-design.final.md");
    assert.equal(calls[0].userMaterialPackPath, materialPackPath);
    assert.equal(calls[0].parentArtifactId, "artifact_restructure");
    assert.equal(calls[0].confirmationId, "confirm_1");
  } finally {
    await closeServer(server);
  }
});

test("function slot library API exposes semantic governance graph route", async () => {
  const server = createServer({
    functionSlotLibraryService: {
      readSemanticGovernance: async () => ({
        ...buildGovernance(),
        sourceSnapshot: [{ artifactId: "artifact_a", sampleVideoId: "sample_a", traceId: "trace_a", contentHash: "hash_a" }],
      }),
      listLibraryItems: async () => [
        { artifactId: "artifact_a", sampleVideoId: "sample_a", traceId: "trace_a", contentHash: "hash_a", counts: { slotCount: 1, atomCount: 3 } },
        { artifactId: "artifact_missing", sampleVideoId: "sample_missing", traceId: "trace_missing", contentHash: "hash_missing", counts: { slotCount: 1, atomCount: 3 } },
      ],
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
    const graph = await makeRequest(server, "GET", "/api/function-slot-library/governance/graph");

    assert.equal(graph.statusCode, 200);
    assert.equal(graph.body.schemaVersion, "function_slot_governance_graph.v1");
    assert.equal(graph.body.summary.sampleCount, 4);
    assert.equal(graph.body.summary.atomizedSampleCount, 2);
    assert.equal(graph.body.summary.governedSampleCount, 1);
    assert.equal(graph.body.summary.ungovernedSampleCount, 1);
    assert.equal(graph.body.summary.ungovernedSamples[0].reason, "missing_from_source_snapshot");
    assert.ok(graph.body.nodes.some((node) => node.type === "slotFamily"));
    assert.equal(graph.body.nodes.some((node) => hasGovernanceStatusFields(node.data)), false);
    assert.ok(graph.body.nodes.some((node) => node.type === "unmappedVariant" && node.data.reason === "single_sample"));
    assert.ok(graph.body.edges.some((edge) => edge.type === "archetype_to_subtype"));
  } finally {
    await closeServer(server);
  }
});

test("function slot API exposes confirmed plan trace graph route", async () => {
  const server = createServer({
    restructureDisplayOverlayService: {
      readConfirmedPlanTraceGraph: async () => ({
        schemaVersion: "confirmed_plan_trace_graph.v1",
        artifactId: "confirmed-plan-trace",
        nodes: [{ id: "plan_a:plan", type: "confirmedPlan", label: "plan_a", group: "plan", data: { planId: "plan_a" } }],
        edges: [],
        summary: { planCount: 1, slotCount: 0, atomCount: 0, bindingCount: 0, conceptCount: 0 },
      }),
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
    const graph = await makeRequest(server, "GET", "/api/function-slot-restructure/confirmed-plan-trace/graph");

    assert.equal(graph.statusCode, 200);
    assert.equal(graph.body.schemaVersion, "confirmed_plan_trace_graph.v1");
    assert.equal(graph.body.summary.planCount, 1);
    assert.ok(graph.body.nodes.some((node) => node.type === "confirmedPlan"));
  } finally {
    await closeServer(server);
  }
});

test("function slot governance graph builder maps relationships and evidence gaps", () => {
  const graph = buildFunctionSlotGovernanceGraph(buildGovernance());

  assert.ok(graph.nodes.some((node) => node.type === "implementationBundle"));
  assert.ok(graph.nodes.some((node) => node.type === "sourceVariant"));
  assert.equal(graph.nodes.some((node) => node.type === "needReviewItem"), false);
  assert.equal(graph.nodes.some((node) => hasGovernanceStatusFields(node.data)), false);
  assert.equal(Object.prototype.hasOwnProperty.call(graph.summary, "needReviewCount"), false);
  assert.ok(graph.edges.some((edge) => edge.type === "bundle_to_atom_pattern"));
  assert.deepEqual([...new Set(graph.edges.filter((edge) => edge.source === graph.nodes.find((node) => node.type === "governanceRoot")?.id).map((edge) => edge.type))], ["governance_contains_family"]);
});

test("function slot governance graph builder derives subtype to atom archetype links through patterns", () => {
  const graph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    slotSubtypes: [
      { id: "SUB_a", archetypeId: "ARCH_hook", name: "A" },
      { id: "SUB_b", archetypeId: "ARCH_hook", name: "B" },
    ],
    atomArchetypes: [{ id: "ATOM_ARCH_script", name: "script", atomLayer: "script" }],
    atomPatterns: [
      { id: "SCRIPT_pattern_a", name: "script A", atomLayer: "script", parentAtomArchetype: "ATOM_ARCH_script", forSlotSubtypeIds: ["SUB_a"], sourceVariantIds: [] },
      { id: "SCRIPT_pattern_a_alt", name: "script A alt", atomLayer: "script", parentAtomArchetype: "ATOM_ARCH_script", forSlotSubtypeIds: ["SUB_a"], sourceVariantIds: [] },
      { id: "SCRIPT_pattern_b", name: "script B", atomLayer: "script", parentAtomArchetype: "ATOM_ARCH_script", forSlotSubtypeIds: ["SUB_b"], sourceVariantIds: [] },
    ],
  });
  const subtypeToArchetypeEdges = graph.edges.filter((edge) => edge.type === "subtype_to_atom_archetype");

  assert.equal(graph.nodes.some((node) => node.type === "atomLayer"), false);
  assert.equal(graph.edges.some((edge) => edge.type.includes("atom_layer")), false);
  assert.equal(subtypeToArchetypeEdges.filter((edge) => edge.source === "slotSubtype:SUB_a" && edge.target === "atomArchetype:ATOM_ARCH_script").length, 1);
  assert.equal(subtypeToArchetypeEdges.filter((edge) => edge.source === "slotSubtype:SUB_b" && edge.target === "atomArchetype:ATOM_ARCH_script").length, 1);
  assert.equal(graph.edges.some((edge) => edge.source.startsWith("slotSubtype:") && edge.target.startsWith("atomPattern:")), false);
  assert.ok(graph.edges.some((edge) => edge.source === "atomArchetype:ATOM_ARCH_script" && edge.target === "atomPattern:SCRIPT_pattern_a" && edge.type === "atom_archetype_to_pattern"));
  assert.ok(graph.edges.some((edge) => edge.source === "atomArchetype:ATOM_ARCH_script" && edge.target === "atomPattern:SCRIPT_pattern_b" && edge.type === "atom_archetype_to_pattern"));
});

test("function slot governance graph builder derives subtype to atom archetype links from slot atom variants", () => {
  const graph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    slotSubtypes: [
      { id: "SUB_a", archetypeId: "ARCH_hook", name: "A", sourceVariantIds: ["sample_a::F001"] },
      { id: "SUB_b", archetypeId: "ARCH_hook", name: "B", sourceVariantIds: ["sample_a::F002"] },
    ],
    atomArchetypes: [{ id: "ATOM_ARCH_script", name: "script", atomLayer: "script", sourcePatternIds: ["SCRIPT_pattern_a"] }],
    atomPatterns: [
      { id: "SCRIPT_pattern_a", name: "script A", atomLayer: "script", forSlotSubtypeIds: [], sourceVariantIds: ["sample_a::script::S001"] },
    ],
  }, {
    libraryItems: [{
      sampleVideoId: "sample_a",
      functionSlotAtomizationAnalysis: {
        sampleVideoId: "sample_a",
        slotMap: {
          slots: [
            { slotId: "F001", scriptAtomIds: ["S001"], rhythmAtomIds: [], packagingAtomIds: [] },
            { slotId: "F002", scriptAtomIds: ["S002"], rhythmAtomIds: [], packagingAtomIds: [] },
          ],
        },
      },
    }],
  });

  assert.ok(graph.edges.some((edge) => edge.source === "slotSubtype:SUB_a" && edge.target === "atomArchetype:ATOM_ARCH_script" && edge.type === "subtype_to_atom_archetype"));
  assert.equal(graph.edges.some((edge) => edge.source === "slotSubtype:SUB_b" && edge.target === "atomArchetype:ATOM_ARCH_script"), false);
  assert.deepEqual(graph.nodes.find((node) => node.id === "slotSubtype:SUB_a")?.data.sourceAtomVariantIds, ["sample_a::script::S001"]);
  assert.deepEqual(graph.nodes.find((node) => node.id === "slotSubtype:SUB_b")?.data.sourceAtomVariantIds, ["sample_a::script::S002"]);
  assert.ok(graph.edges.some((edge) => edge.source === "atomArchetype:ATOM_ARCH_script" && edge.target === "atomPattern:SCRIPT_pattern_a" && edge.type === "atom_archetype_to_pattern"));
});

test("function slot governance graph builder links source samples to slot subtypes through slot variants only", () => {
  const graph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    slotSubtypes: [
      { id: "SUB_a", archetypeId: "ARCH_hook", name: "A", sourceVariantIds: ["sample_a::F001"] },
      { id: "SUB_b", archetypeId: "ARCH_hook", name: "B", sourceVariantIds: ["sample_b::F002"] },
      { id: "SUB_atom_only", archetypeId: "ARCH_hook", name: "Atom only", sourceVariantIds: ["sample_a::script::S001"] },
    ],
    sourceVariants: [
      { variantId: "sample_a::F001", sampleId: "sample_a", kind: "slot", sourceId: "F001", label: "slot A" },
      { variantId: "sample_b::F002", sampleId: "sample_b", kind: "slot", sourceId: "F002", label: "slot B" },
      { variantId: "sample_a::script::S001", sampleId: "sample_a", kind: "script", sourceId: "S001", label: "script atom" },
    ],
    sourceSnapshot: [
      { sampleVideoId: "sample_a" },
      { sampleVideoId: "sample_b" },
    ],
  });
  const evidenceEdges = graph.edges.filter((edge) => edge.type === "source_sample_slot_variant_to_subtype");

  assert.ok(evidenceEdges.some((edge) => edge.source === "sourceSample:sample_a" && edge.target === "slotSubtype:SUB_a"));
  assert.ok(evidenceEdges.some((edge) => edge.source === "sourceSample:sample_b" && edge.target === "slotSubtype:SUB_b"));
  assert.equal(evidenceEdges.some((edge) => edge.target === "slotSubtype:SUB_atom_only"), false);
});

test("function slot governance graph builder shows source snapshot samples without requiring atom patterns", () => {
  const governance = {
    ...buildGovernance(),
    coverage: { ...buildGovernance().coverage, sampleCount: 2 },
    sourceSnapshot: [
      {
        artifactId: "artifact_a",
        sampleVideoId: "sample_a",
        traceId: "trace_a",
        contentHash: "hash_a",
        counts: { slotCount: 1, atomCount: 1, bindingCount: 0, ruleCount: 0, templateCount: 0 },
      },
      {
        artifactId: "artifact_unpatterned",
        sampleVideoId: "sample_unpatterned",
        traceId: "trace_unpatterned",
        contentHash: "hash_unpatterned",
        counts: { slotCount: 1, atomCount: 3, bindingCount: 1, ruleCount: 1, templateCount: 1 },
      },
    ],
  };
  const graph = buildFunctionSlotGovernanceGraph(governance);
  const samples = graph.nodes.filter((node) => node.type === "sourceSample");
  const root = graph.nodes.find((node) => node.type === "governanceRoot");

  assert.ok(samples.some((node) => node.data.sampleVideoId === "sample_unpatterned"));
  assert.ok(graph.edges.some((edge) => edge.source === root.id && edge.target === "sourceSample:sample_unpatterned" && edge.type === "governance_contains_source_sample"));
  assert.ok(graph.edges.some((edge) => edge.type === "source_variant_to_sample"));
});

test("function slot governance graph builder tracks atomized samples missing semantic governance", () => {
  const graph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    sourceSnapshot: [{ artifactId: "artifact_a", sampleVideoId: "sample_a", traceId: "trace_a", contentHash: "hash_a" }],
  }, {
    libraryItems: [
      { artifactId: "artifact_a", sampleVideoId: "sample_a", traceId: "trace_a", contentHash: "hash_a" },
      { artifactId: "artifact_stale", sampleVideoId: "sample_stale", traceId: "trace_stale", contentHash: "hash_new" },
      { artifactId: "artifact_missing", sampleVideoId: "sample_missing", traceId: "trace_missing", contentHash: "hash_missing" },
    ],
  });

  assert.equal(graph.summary.atomizedSampleCount, 3);
  assert.equal(graph.summary.governedSampleCount, 1);
  assert.equal(graph.summary.ungovernedSampleCount, 2);
  assert.deepEqual(graph.summary.ungovernedSamples.map((item) => item.reason), ["missing_from_source_snapshot", "missing_from_source_snapshot"]);

  const staleGraph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    sourceSnapshot: [{ artifactId: "artifact_stale", sampleVideoId: "sample_stale", traceId: "trace_stale", contentHash: "hash_old" }],
  }, {
    libraryItems: [{ artifactId: "artifact_stale", sampleVideoId: "sample_stale", traceId: "trace_stale", contentHash: "hash_new" }],
  });

  assert.equal(staleGraph.summary.ungovernedSampleCount, 1);
  assert.equal(staleGraph.summary.ungovernedSamples[0].reason, "content_hash_mismatch");
});

test("function slot governance graph builder normalizes value-object ids and labels", () => {
  const graph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    slotFamilies: [{
      id: { value: "FAM_value_object" },
      name: { value: "对象值 family" },
    }],
    slotArchetypes: [{ id: "ARCH_value_object", familyId: "FAM_value_object", name: "对象值 archetype" }],
    slotSubtypes: [{ id: "SUB_value_object", archetypeId: "ARCH_value_object", name: "对象值 subtype" }],
    atomArchetypes: [],
    atomPatterns: [{ id: "SCRIPT_value_object", name: "对象值 pattern", atomLayer: "script", forSlotSubtypeIds: ["SUB_value_object"], sourceVariantIds: [{ value: "sample_value::script::S001" }] }],
    bindingPrinciples: [],
    bindingPatterns: [],
    recompositionPolicies: [],
    rulePatterns: [],
    implementationBundles: [],
    sourceVariants: [{ variantId: "sample_value::script::S001", sampleId: "sample_value", kind: "script", sourceId: "S001", label: "对象值来源槽" }],
    unmappedAtomVariants: [{ variantId: { value: "sample_value::A001" }, reason: "single_sample" }],
    unmappedBindingVariants: [],
    unmappedRuleVariants: [],
  });

  assert.ok(graph.nodes.some((node) => node.id === "slotFamily:FAM_value_object" && node.label === "对象值 family"));
  assert.ok(graph.nodes.some((node) => node.type === "sourceVariant" && node.label === "对象值来源槽"));
  assert.ok(graph.nodes.some((node) => node.type === "sourceSample" && node.data.sampleVideoId === "sample_value"));
  assert.ok(graph.nodes.some((node) => node.type === "unmappedVariant" && node.label === "sample_value::A001"));
  assert.equal(graph.nodes.some((node) => JSON.stringify(node).includes("{\"value\"")), false);
});

test("function slot library API returns safe 404 payloads for missing source and item", async () => {
  const server = createServer({
    functionSlotLibraryService: {
      exportSampleArtifact: async () => null,
      listLibraryItems: async () => [],
      projectLibraryArtifact: async () => null,
      readLibraryArtifact: async () => null,
      deleteLibraryItem: async () => null,
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
    const exported = await makeRequest(server, "POST", "/api/sample-videos/missing/function-slot-library/export");
    const graph = await makeRequest(server, "GET", "/api/function-slot-library/missing/graph");
    const projected = await makeRequest(server, "POST", "/api/function-slot-library/missing/project");

    assert.equal(exported.statusCode, 404);
    assert.equal(exported.body.code, "function_slot_library_source_missing");
    assert.equal(graph.statusCode, 404);
    assert.equal(projected.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});

test("function slot library API returns 400 for invalid export mode", async () => {
  const server = createServer({
    functionSlotLibraryService: {
      exportSampleArtifact: async () => {
        const error = new Error("mode 只支持 replace 或 skip-existing");
        error.statusCode = 400;
        error.code = "function_slot_library_invalid_mode";
        throw error;
      },
      listLibraryItems: async () => [],
      projectLibraryArtifact: async () => null,
      deleteLibraryItem: async () => null,
    },
    staticWorkbench: { handle: () => false },
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/snapshot.json" }),
    },
    recordApiRequestFailure: async () => ({
      traceContext: { traceId: "trace_invalid_mode" },
      snapshot: { uri: "/runtime/debug-snapshots/invalid-mode.json" },
      errorSummary: { stageName: "api.request.handle" },
    }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/sample-videos/sample_library/function-slot-library/export?mode=oops");
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "function_slot_library_invalid_mode");
  } finally {
    await closeServer(server);
  }
});

test("function slot library service rejects invalid export mode", async () => {
  const { service } = await createTempLibraryService();
  await assert.rejects(
    service.exportSampleArtifact("sample_library", { mode: "oops" }),
    /mode 只支持 replace 或 skip-existing/,
  );
});

async function createTempLibraryService() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-function-slot-library-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const projectionStore = createFunctionSlotProjectionStore({ store });
  const projectionService = createFunctionSlotProjectionService({ store, projectionStore });
  const libraryRoot = path.join(tempRoot, "Artifacts", "FunctionSlotLibrary");
  return {
    store,
    projectionService,
    libraryRoot,
    service: createFunctionSlotLibraryService({
      rootDir: tempRoot,
      store,
      projectionService,
      libraryRoot,
      now: makeClock(),
    }),
  };
}

function makeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-05-26T00:00:0${tick}.000Z`;
  };
}

async function writeRuntimeArtifact(store, artifact) {
  const sampleDir = await store.ensureSampleDirs(artifact.sampleVideoId);
  await store.writeJson(path.join(sampleDir, "artifact.json"), artifact);
}

function buildArtifact({ artifactId = "artifact_function_slot", traceId = "trace_library", createdAt = "2026-05-26T00:00:00.000Z", extraSlot = false, status = "processed", emptyAtomization = false } = {}) {
  const slotTypes = emptyAtomization ? [] : extraSlot ? ["problem_activation", "result_confirmation", "trust_close"] : ["problem_activation", "result_confirmation"];
  return {
    sampleVideoId: "sample_library",
    trace: { traceId: "trace_sample" },
    sampleVideo: {
      original: {
        summary: "source-library.mp4",
      },
    },
      functionSlotAtomizationAnalysis: {
      artifactId,
      parentArtifactId: "artifact_packaging",
      traceId,
      type: "function-slot-atomization-analysis",
      status,
      stageName: "function_slot_atomization.materialize",
      sampleVideoId: "sample_library",
      sourceScriptSegmentArtifactId: "artifact_script",
      sourceRhythmStructureArtifactId: "artifact_rhythm",
      sourcePackagingStructureArtifactId: "artifact_packaging",
      sourceShotBoundaryArtifactId: "artifact_shot",
      atomInventory: {
        scriptAtoms: slotTypes.map((slot, index) => buildAtom("S", slot, index)),
        rhythmAtoms: slotTypes.map((slot, index) => buildAtom("R", slot, index)),
        packagingAtoms: slotTypes.map((slot, index) => buildAtom("P", slot, index)),
      },
      slotMap: {
        slots: slotTypes.map((slot, index) => ({
          slotId: `F${index + 1}`,
          slotOrder: index + 1,
          slotName: `slot ${index + 1}`,
          slotType: slot,
          viewerStateBefore: `before ${index + 1}`,
          viewerStateAfter: `after ${index + 1}`,
          persuasionTask: `task ${index + 1}`,
          scriptAtomIds: [`S${index + 1}`],
          rhythmAtomIds: [`R${index + 1}`],
          packagingAtomIds: [`P${index + 1}`],
          sourceRefs: { shotRefs: [`shot_${index + 1}`] },
          confidence: 0.9,
          needReview: false,
        })),
      },
      bindingGraph: {
        bindings: [1, 2].map((value) => ({
          id: `B${value}`,
          type: "sync",
          slotIds: [`F${value}`],
          atomIds: [`S${value}`, `R${value}`, `P${value}`],
          rule: `binding rule ${value}`,
          riskIfBroken: `risk ${value}`,
          confidence: 0.9,
        })),
      },
      conflictChecks: [{ id: "C1", slotIds: ["F1"], reason: "conflict", fix: "fix" }],
      recombinationRules: [{ id: "RULE1", reason: "rule", appliesTo: ["problem_activation"], sourceBindingIds: ["B1"] }],
      recompositionTemplates: [{ templateId: "T1", templateName: "template", sequence: slotTypes }],
      createdAt,
    },
    shotBoundaryAnalysis: {
      shots: slotTypes.map((slot, index) => ({
        id: `shot_${index + 1}`,
        shotNo: `S${String(index + 1).padStart(3, "0")}`,
        start: index * 1.2,
        end: (index + 1) * 1.2,
      })),
    },
    subtitles: {
      segments: slotTypes.map((slot, index) => ({
        id: `subtitle_${index + 1}`,
        start: index * 1.2,
        end: (index + 1) * 1.2,
        text: index === 0 ? "这是字幕" : `字幕${index + 1}`,
      })),
    },
  };
}

function buildGovernance() {
  return {
    schemaVersion: "function_slot_semantic_governance.v1",
    governanceId: "governance_test",
    coverage: {
      sampleCount: 4,
      slotVariantCount: 21,
      atomVariantCount: 64,
      bindingCount: 33,
      ruleCount: 39,
      validationOk: true,
    },
    slotFamilies: [{ id: "FAM_attention", name: "attention", sourceVariantIds: ["sample_a::F001"], support: { variantCount: 1, sampleCount: 1 } }],
    slotArchetypes: [{ id: "ARCH_hook", familyId: "FAM_attention", name: "hook", sourceVariantIds: ["sample_a::F001"], support: { variantCount: 1, sampleCount: 1 } }],
    slotSubtypes: [{ id: "SUB_visible_hook", archetypeId: "ARCH_hook", name: "visible hook", sourceVariantIds: ["sample_a::F001"], support: { variantCount: 1, sampleCount: 1 } }],
    atomArchetypes: [{ id: "ATOM_ARCH_script", name: "script", atomLayer: "script" }],
    atomPatterns: [{ id: "SCRIPT_pattern_hook", name: "script hook", atomLayer: "script", parentAtomArchetype: "ATOM_ARCH_script", forSlotSubtypeIds: ["SUB_visible_hook"], sourceVariantIds: ["sample_a::script::S001"], support: { variantCount: 1, sampleCount: 1 } }],
    bindingPrinciples: [{ id: "PRINCIPLE_close", name: "close", sourcePatternIds: ["BIND_pattern_close"] }],
    bindingPatterns: [{ id: "BIND_pattern_close", name: "binding close" }],
    recompositionPolicies: [{ id: "POLICY_close", name: "policy close", sourceRulePatternIds: ["RULE_pattern_close"] }],
    rulePatterns: [{ id: "RULE_pattern_close", name: "rule close" }],
    implementationBundles: [{ id: "BUNDLE_hook", name: "bundle hook", slotSubtypeIds: ["SUB_visible_hook"], scriptPatternIds: ["SCRIPT_pattern_hook"], rhythmPatternIds: [], packagingPatternIds: [], sourceVariantIds: ["sample_a::F001"] }],
    sourceVariants: [
      { variantId: "sample_a::F001", sampleId: "sample_a", kind: "slot", sourceId: "F001", label: "attention source" },
      { variantId: "sample_a::script::S001", sampleId: "sample_a", kind: "script", sourceId: "S001", label: "script hook source" },
    ],
    unmappedAtomVariants: [{ variantId: "sample_a::script::S002", reason: "single_sample", suggestedAction: "keep" }],
    unmappedBindingVariants: [],
    unmappedRuleVariants: [],
  };
}

function hasGovernanceStatusFields(data) {
  return Boolean(data && (
    Object.prototype.hasOwnProperty.call(data, "status")
    || Object.prototype.hasOwnProperty.call(data, "reviewStatus")
    || Object.prototype.hasOwnProperty.call(data, "maturityStatus")
    || Object.prototype.hasOwnProperty.call(data, "needReview")
  ));
}

function buildAtom(prefix, slot, index) {
  const id = `${prefix}${index + 1}`;
  return {
    id,
    slot,
    label: `${prefix} atom ${index + 1}`,
    function: `${prefix} function ${index + 1}`,
    claimType: prefix === "P" ? "visual_proof" : "claim",
    proofType: prefix === "P" ? "visual_proof" : "",
    packagingFunction: prefix === "P" ? `${prefix} function ${index + 1}` : "",
    proofNeed: prefix === "S" ? "proof" : "",
    pace: prefix === "R" ? "fast" : "",
    densityType: prefix === "R" ? "cut_density" : "",
    beatShape: prefix === "R" ? "beat" : "",
    visualHierarchy: prefix === "P" ? "hero_first" : "",
    visualElements: prefix === "P" ? ["subtitle"] : [],
    replaceableForms: prefix === "P" ? ["badge"] : [],
    risk: prefix === "P" ? "visual risk" : "",
    mustKeep: prefix === "S" ? ["claim"] : [],
    replaceableVariables: ["variable"],
    syncPoints: prefix === "R" ? ["cut"] : [],
    avoidFor: prefix === "R" ? ["slow"] : [],
    sourceRefs: { shotRefs: [`shot_${index + 1}`] },
    confidence: 0.9,
    needReview: false,
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

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

function makeJsonRequest(server, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method,
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        "content-type": "application/json",
      },
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
    request.write(JSON.stringify(body));
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
