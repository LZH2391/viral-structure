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
const { createServer } = require("../../Apps/Api/server");

test("function slot library exports fixed json files with manifest counts and hash", async () => {
  const { store, service, libraryRoot } = await createTempLibraryService();
  const artifact = buildArtifact();
  await writeRuntimeArtifact(store, artifact);

  const result = await service.exportSampleArtifact("sample_library");
  const itemDir = path.join(libraryRoot, "artifact_function_slot");
  const files = await fs.readdir(itemDir);
  const manifest = await readJson(path.join(itemDir, FILES.manifest));

  assert.equal(result.exported, true);
  assert.equal(result.itemPath, "Artifacts/FunctionSlotLibrary/artifact_function_slot");
  assert.deepEqual(files.sort(), Object.values(FILES).sort());
  assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
  assert.equal(manifest.sampleVideoId, "sample_library");
  assert.equal(manifest.traceId, "trace_library");
  assert.equal(manifest.counts.slotCount, 2);
  assert.equal(manifest.counts.atomCount, 6);
  assert.equal(manifest.counts.bindingCount, 2);
  assert.equal(manifest.counts.ruleCount, 2);
  assert.equal(manifest.counts.templateCount, 1);
  assert.match(manifest.contentHash, /^[a-f0-9]{64}$/);
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
      listLibraryItems: async () => [{ artifactId: "artifact_function_slot", sampleVideoId: "sample_library", traceId: "trace_library" }],
      projectLibraryArtifact: async (artifactId) => {
        calls.push({ method: "projectLibraryArtifact", artifactId });
        return { projected: true, artifactId, sampleVideoId: "sample_library", slotCount: 2 };
      },
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
    const projected = await makeRequest(server, "POST", "/api/function-slot-library/artifact_function_slot/project");
    const deleted = await makeRequest(server, "DELETE", "/api/function-slot-library/artifact_function_slot");

    assert.equal(exported.statusCode, 200);
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.body.items[0].traceId, "trace_library");
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

test("function slot library API returns safe 404 payloads for missing source and item", async () => {
  const server = createServer({
    functionSlotLibraryService: {
      exportSampleArtifact: async () => null,
      listLibraryItems: async () => [],
      projectLibraryArtifact: async () => null,
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
    const projected = await makeRequest(server, "POST", "/api/function-slot-library/missing/project");

    assert.equal(exported.statusCode, 404);
    assert.equal(exported.body.code, "function_slot_library_source_missing");
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

function buildArtifact({ artifactId = "artifact_function_slot", traceId = "trace_library", createdAt = "2026-05-26T00:00:00.000Z", extraSlot = false } = {}) {
  const slotTypes = extraSlot ? ["problem_activation", "result_confirmation", "trust_close"] : ["problem_activation", "result_confirmation"];
  return {
    sampleVideoId: "sample_library",
    trace: { traceId: "trace_sample" },
    functionSlotAtomizationAnalysis: {
      artifactId,
      parentArtifactId: "artifact_packaging",
      traceId,
      type: "function-slot-atomization-analysis",
      status: "processed",
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
  };
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
