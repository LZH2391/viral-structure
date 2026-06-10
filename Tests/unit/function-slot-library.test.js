const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { once } = require("node:events");
const { FILES, SCHEMA_VERSION } = require("../../Apps/Api/lib/function-slot-library/service");
const { createServer } = require("../../Apps/Api/server");
const {
  buildArtifact,
  buildGovernance,
  closeServer,
  createTempLibraryService,
  hasGovernanceStatusFields,
  makeJsonRequest,
  makeRequest,
  readJson,
  writeRuntimeArtifact,
} = require("./function-slot-library.helpers");

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
  assert.equal(manifest.sourceVideoName, "source-library");
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

test("function slot library lists the latest manifest per sample video", async () => {
  const { store, service } = await createTempLibraryService();
  await writeRuntimeArtifact(store, buildArtifact({ artifactId: "artifact_old", exportedAt: "unused", traceId: "trace_old" }));
  await service.exportSampleArtifact("sample_library", { mode: "replace" });
  await writeRuntimeArtifact(store, buildArtifact({ artifactId: "artifact_new", traceId: "trace_new" }));
  await service.exportSampleArtifact("sample_library", { mode: "replace" });

  const items = await service.listLibraryItems();
  assert.deepEqual(items.map((item) => item.artifactId), ["artifact_new"]);
  assert.equal(items[0].sourceVideoName, "source-library");
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
        { artifactId: "artifact_a", sampleVideoId: "sample_a", sourceVideoName: "search-source-a.mp4", traceId: "trace_a", contentHash: "hash_a", counts: { slotCount: 1, atomCount: 3 } },
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
    assert.equal(graph.body.nodes.find((node) => node.id === "sourceSample:sample_a")?.data.sourceVideoName, "search-source-a");
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

test("function slot API exposes plan trace records, graph, and preview routes", async () => {
  const previewGraph = {
    schemaVersion: "confirmed_plan_trace_graph.v1",
    artifactId: "plan-trace-preview:plan-a",
    nodes: [{ id: "plan-a:plan", type: "confirmedPlan", label: "plan-a", group: "plan", data: { planId: "plan-a" } }],
    edges: [],
    summary: { planCount: 1, slotCount: 0, atomCount: 0, bindingCount: 0, conceptCount: 0 },
  };
  const server = createServer({
    restructureDisplayOverlayService: {
      listPlanTraceRecords: async ({ bucket }) => ({
        schemaVersion: "plan_trace_records.v1",
        bucket,
        generatedAt: "2026-06-10T00:00:00.000Z",
        recentWindowHours: 24,
        records: [{ schemaVersion: "plan_trace_record.v1", recordId: "plan-a", planSetId: "plan-a", title: "plan-a", mode: "single", status: "draft", createdAt: "2026-06-10T00:00:00.000Z", updatedAt: "2026-06-10T00:00:00.000Z", variants: [] }],
      }),
      readPlanTraceRecordGraph: async (recordId) => recordId === "plan-a" ? previewGraph : null,
      previewPlanTraceGraph: async () => ({ schemaVersion: "plan_trace_preview.v1", ok: true, record: null, graph: previewGraph }),
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
    const records = await makeRequest(server, "GET", "/api/function-slot-restructure/plan-trace/records?bucket=recent");
    const graph = await makeRequest(server, "GET", "/api/function-slot-restructure/plan-trace/records/plan-a/graph");
    const preview = await makeJsonRequest(server, "POST", "/api/function-slot-restructure/plan-trace/preview", {
      restructureFinalPath: "Artifacts/FunctionSlotRestructure/plan-a/restructure.final.md",
    });

    assert.equal(records.statusCode, 200);
    assert.equal(records.body.records[0].recordId, "plan-a");
    assert.equal(graph.statusCode, 200);
    assert.equal(graph.body.summary.planCount, 1);
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body.ok, true);
    assert.equal(preview.body.graph.summary.planCount, 1);
  } finally {
    await closeServer(server);
  }
});
