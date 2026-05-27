const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("analysis runtime v2 exposes modular runtime contracts", () => {
  const root = path.resolve(__dirname, "../..");
  const index = read(root, "Apps/Api/lib/analysis-runtime-v2/index.js");
  const stage = read(root, "Apps/Api/lib/analysis-runtime-v2/stage-runtime.js");
  const job = read(root, "Apps/Api/lib/analysis-runtime-v2/job-runtime.js");
  const cache = read(root, "Apps/Api/lib/analysis-runtime-v2/cache-runtime.js");
  const shared = read(root, "Apps/Api/lib/compatibility/analysis-service-shared.js");

  assert.match(index, /createAnalysisRuntimeV2/);
  assert.match(index, /createStageRuntime/);
  assert.match(index, /createJobRuntime/);
  assert.match(index, /createThreadRuntime/);
  assert.match(index, /createMaterializeRuntime/);
  assert.match(index, /createAnalysisFinalOutputStore/);
  assert.match(stage, /stage\.start/);
  assert.match(stage, /stage\.end/);
  assert.match(stage, /stage\.fail/);
  assert.match(job, /markCacheWaiting/);
  assert.match(job, /resumeProcessing/);
  assert.match(job, /complete/);
  assert.match(cache, /buildUnifiedCachePrompt/);
  assert.match(cache, /dependencies/);
  assert.match(cache, /analysisOptions/);
  assert.match(shared, /createAnalysisRuntimeV2/);
});

test("materialize runtime writes final output for the current analysis kind", async () => {
  const { createMaterializeRuntime } = require("../../Apps/Api/lib/analysis-runtime-v2/materialize-runtime");
  const writes = [];
  const runtime = createMaterializeRuntime({
    artifactIndex: {
      registerSampleArtifact: async () => undefined,
    },
    resolveExistingFileHash: async () => "file_hash",
    finalOutputStore: {
      writeFinalOutput: async (payload) => {
        writes.push(payload);
        return payload;
      },
    },
  });

  await runtime.registerSampleArtifact({
    sampleVideoId: "sample_1",
    cacheKind: "packaging_structure",
    finalOutputText: "packaging final",
    traceContext: { traceId: "trace_packaging" },
    activeStage: { stageName: "packaging_structure.materialize" },
  }, {
    scriptSegmentAnalysis: { artifactId: "artifact_script", type: "script-segment-analysis" },
    packagingStructureAnalysis: { artifactId: "artifact_packaging", type: "packaging-structure-analysis" },
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].analysis.artifactId, "artifact_packaging");
  assert.equal(writes[0].finalOutputText, "packaging final");
  assert.equal(writes[0].stageName, "packaging_structure.materialize");
});

test("materialize runtime writes function slot atomization final output", async () => {
  const { createMaterializeRuntime } = require("../../Apps/Api/lib/analysis-runtime-v2/materialize-runtime");
  const writes = [];
  const runtime = createMaterializeRuntime({
    artifactIndex: {
      registerSampleArtifact: async () => undefined,
    },
    resolveExistingFileHash: async () => "file_hash",
    finalOutputStore: {
      writeFinalOutput: async (payload) => {
        writes.push(payload);
        return payload;
      },
    },
  });

  await runtime.registerSampleArtifact({
    sampleVideoId: "sample_1",
    cacheKind: null,
    finalOutputText: "{\"atom_inventory\":{\"scriptAtoms\":[]}}",
    traceContext: { traceId: "trace_atomization" },
    activeStage: { stageName: "function_slot_atomization.materialize" },
  }, {
    packagingStructureAnalysis: { artifactId: "artifact_packaging", type: "packaging-structure-analysis" },
    functionSlotAtomizationAnalysis: {
      artifactId: "artifact_atomization",
      parentArtifactId: "artifact_packaging",
      type: "function-slot-atomization-analysis",
    },
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].analysis.artifactId, "artifact_atomization");
  assert.equal(writes[0].finalOutputText, "{\"atom_inventory\":{\"scriptAtoms\":[]}}");
  assert.equal(writes[0].stageName, "function_slot_atomization.materialize");
});

test("script cache prompts expose unified dependencies while rhythm depends only on shots", () => {
  const root = path.resolve(__dirname, "../..");
  const scriptCache = read(root, "Apps/Api/lib/script-segment/cache.js");
  const rhythmCache = read(root, "Apps/Api/lib/rhythm-structure/cache.js");
  const sharedShotBoundaryCache = read(root, "Apps/Api/lib/analysis-runtime-v2/shot-boundary-cache.js");
  const scriptService = read(root, "Apps/Api/lib/script-segment/service.js");
  const rhythmService = read(root, "Apps/Api/lib/rhythm-structure/service.js");
  const roleDefinition = read(root, "Apps/Api/lib/compatibility/analysis-role-definition.js");
  const roleService = read(root, "Apps/Api/lib/analysis-runtime-v2/role-service.js");

  assert.match(sharedShotBoundaryCache, /buildUnifiedCachePrompt/);
  assert.match(sharedShotBoundaryCache, /dependencies:\s*\{[\s\S]*shotBoundaryArtifactId/);
  assert.match(sharedShotBoundaryCache, /legacy:\s*\{[\s\S]*expectedShotBoundaryArtifactId/);
  assert.match(scriptCache, /createShotBoundaryDependentCacheHandlers/);
  assert.match(scriptCache, /cacheKind:\s*"script_segment"/);
  assert.match(rhythmCache, /createShotBoundaryDependentCacheHandlers/);
  assert.match(rhythmCache, /cacheKind:\s*"rhythm_structure"/);
  assert.doesNotMatch(rhythmCache, /scriptSegmentArtifactId/);
  assert.doesNotMatch(rhythmCache, /expectedScriptSegmentArtifactId/);
  assert.match(roleDefinition, /createRoleAnalysisService/);
  assert.match(scriptService, /createScriptSegmentAnalysisDefinition/);
  assert.match(rhythmService, /createRhythmStructureAnalysisDefinition/);
  assert.match(roleService, /runtime\.job\.complete\(context\)/);
  assert.match(roleService, /runtime\.job\.resumeProcessing\(jobId, stages\.cacheLookup, descriptor\.progress\.cacheLookup\)/);
});

test("frontend and API accept unified analysis dependencies while preserving legacy fields", () => {
  const root = path.resolve(__dirname, "../..");
  const server = read(root, "Apps/Api/server.js");
  const registry = read(root, "Apps/Api/lib/compatibility/analysis-role-registry.js");
  const roleDefinition = read(root, "Apps/Api/lib/compatibility/analysis-role-definition.js");
  const client = read(root, "Apps/Workbench/src/api/client.ts");
  const types = read(root, "Apps/Workbench/src/types.ts");

  assert.match(server, /startAnalysis/);
  assert.match(roleDefinition, /\/analyses\/\$\{config\.moduleId\}/);
  assert.match(roleDefinition, /dependencies\.shotBoundaryArtifactId \?\? body\?\.expectedShotBoundaryArtifactId/);
  assert.match(registry, /createModuleRegistry/);
  assert.doesNotMatch(server, /body\.dependencies\?\.scriptSegmentArtifactId \?\? body\.expectedScriptSegmentArtifactId/);
  assert.match(client, /startAnalysisRole/);
  assert.match(client, /\/analyses\/\$\{encodeURIComponent\(analysisId\)\}/);
  assert.match(client, /shotBoundaryArtifactId: options\.expectedShotBoundaryArtifactId \?\? null/);
  assert.match(client, /scriptSegmentArtifactId: options\.expectedScriptSegmentArtifactId \?\? null/);
  assert.match(client, /rhythmStructureArtifactId: options\.expectedRhythmStructureArtifactId \?\? null/);
  assert.match(client, /packagingStructureArtifactId: options\.expectedPackagingStructureArtifactId \?\? null/);
  assert.match(client, /expectedShotBoundaryArtifactId: options\.expectedShotBoundaryArtifactId \?\? null/);
  assert.match(client, /expectedScriptSegmentArtifactId: options\.expectedScriptSegmentArtifactId \?\? null/);
  assert.match(types, /dependencies\?: \{/);
  assert.match(types, /analysisOptions\?: Record/);
  assert.match(types, /sourceArtifactId\?: string \| null/);
  assert.match(types, /sourceTraceId\?: string \| null/);
});

test("analysis role registry maps route ids, legacy paths, and cache kinds", async () => {
  const { createAnalysisRoleRegistry } = require("../../Apps/Api/lib/compatibility/analysis-role-registry");
  const calls = [];
  const fakeService = {
    enqueue: async (payload) => {
      calls.push({ type: "enqueue", payload });
      return { processingJobId: "job_analysis", sampleVideoId: payload.sampleVideoId, traceId: "trace_analysis" };
    },
    resolveCacheDecision: async (payload) => {
      calls.push({ type: "cache", payload });
      return { jobId: payload.jobId, status: "processed" };
    },
  };
  const registry = createAnalysisRoleRegistry({
    serviceOverrides: {
      scriptSegmentService: fakeService,
      rhythmStructureService: fakeService,
      packagingStructureService: fakeService,
    },
  });

  assert.equal(registry.getByAnalysisId("script-segments").cacheKind, "script_segment");
  assert.equal(registry.getByLegacyPathSegment("rhythm-structure").moduleId, "rhythm-structure");
  assert.equal(registry.getByCacheKind("packaging_structure").moduleId, "packaging-structure");
  assert.equal(registry.getByAnalysisId("missing"), null);
  const publicEntry = registry.list().find((entry) => entry.analysisId === "packaging-structure");
  assert.equal(publicEntry.artifactKey, "packagingStructureAnalysis");
  assert.equal(publicEntry.artifactType, "packaging-structure-analysis");
  assert.equal(publicEntry.createService, undefined);
  assert.equal(publicEntry.skillPath, undefined);
  assert.equal(publicEntry.serviceKey, undefined);
  assert.equal(publicEntry.executorKind, undefined);

  const started = await registry.startAnalysis({
    analysisId: "packaging-structure",
    sampleVideoId: "sample_1",
    body: { cacheDecision: "refresh", dependencies: { shotBoundaryArtifactId: "artifact_shot_1" } },
  });
  assert.equal(started.processingJobId, "job_analysis");
  assert.deepEqual(calls[0], {
    type: "enqueue",
    payload: {
      sampleVideoId: "sample_1",
      cacheDecision: "refresh",
      expectedShotBoundaryArtifactId: "artifact_shot_1",
    },
  });

  await registry.resolveAnalysisCacheDecision({ cacheKind: "packaging_structure", jobId: "job_1", decision: "reuse" });
  assert.deepEqual(calls[1], { type: "cache", payload: { jobId: "job_1", decision: "reuse" } });
  assert.equal(await registry.resolveAnalysisCacheDecision({ cacheKind: "shot_boundary", jobId: "job_2", decision: "reuse" }), null);
  const atomization = registry.getByAnalysisId("function-slot-atomization");
  assert.equal(atomization.artifact.key, "functionSlotAtomizationAnalysis");
  assert.equal(atomization.cacheKind, "function_slot_atomization");
  assert.equal(atomization.supportsCacheReuse, true);
  assert.throws(
    () => registry.startAnalysis({ analysisId: "missing", sampleVideoId: "sample_1", body: {} }),
    (error) => error.statusCode === 404 && error.code === "module_not_found",
  );
});
