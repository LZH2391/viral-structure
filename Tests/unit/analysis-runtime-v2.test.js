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
  const shared = read(root, "Apps/Api/lib/analysis-service-shared.js");

  assert.match(index, /createAnalysisRuntimeV2/);
  assert.match(index, /createStageRuntime/);
  assert.match(index, /createJobRuntime/);
  assert.match(index, /createThreadRuntime/);
  assert.match(index, /createMaterializeRuntime/);
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

test("script cache prompts expose unified dependencies while rhythm depends only on shots", () => {
  const root = path.resolve(__dirname, "../..");
  const scriptCache = read(root, "Apps/Api/lib/script-segment/cache.js");
  const rhythmCache = read(root, "Apps/Api/lib/rhythm-structure/cache.js");
  const scriptService = read(root, "Apps/Api/lib/script-segment-service.js");
  const rhythmService = read(root, "Apps/Api/lib/rhythm-structure-service.js");
  const roleService = read(root, "Apps/Api/lib/analysis-runtime-v2/role-service.js");

  assert.match(scriptCache, /buildUnifiedCachePrompt/);
  assert.match(scriptCache, /dependencies:\s*\{[\s\S]*shotBoundaryArtifactId/);
  assert.match(scriptCache, /legacy:\s*\{[\s\S]*expectedShotBoundaryArtifactId/);
  assert.match(rhythmCache, /buildUnifiedCachePrompt/);
  assert.match(rhythmCache, /dependencies:\s*\{[\s\S]*shotBoundaryArtifactId/);
  assert.doesNotMatch(rhythmCache, /scriptSegmentArtifactId/);
  assert.doesNotMatch(rhythmCache, /expectedScriptSegmentArtifactId/);
  assert.match(scriptService, /createRoleAnalysisService/);
  assert.match(rhythmService, /createRoleAnalysisService/);
  assert.match(roleService, /runtime\.job\.complete\(context\)/);
  assert.match(roleService, /runtime\.job\.resumeProcessing\(jobId, stages\.cacheLookup, descriptor\.progress\.cacheLookup\)/);
});

test("frontend and API accept unified analysis dependencies while preserving legacy fields", () => {
  const root = path.resolve(__dirname, "../..");
  const server = read(root, "Apps/Api/server.js");
  const client = read(root, "Apps/Workbench/src/api/client.ts");
  const types = read(root, "Apps/Workbench/src/types.ts");

  assert.match(server, /body\.dependencies\?\.shotBoundaryArtifactId \?\? body\.expectedShotBoundaryArtifactId/);
  assert.doesNotMatch(server, /body\.dependencies\?\.scriptSegmentArtifactId \?\? body\.expectedScriptSegmentArtifactId/);
  assert.match(client, /const dependencies = \{ shotBoundaryArtifactId: options\.expectedShotBoundaryArtifactId \?\? null \}/);
  assert.doesNotMatch(client, /scriptSegmentArtifactId: options\.expectedScriptSegmentArtifactId \?\? null/);
  assert.match(client, /expectedShotBoundaryArtifactId: options\.expectedShotBoundaryArtifactId \?\? null/);
  assert.match(types, /dependencies\?: \{/);
  assert.match(types, /analysisOptions\?: Record/);
  assert.match(types, /sourceArtifactId\?: string \| null/);
  assert.match(types, /sourceTraceId\?: string \| null/);
});
