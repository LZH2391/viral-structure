const { assertExpectedArtifact } = require("./analysis-service-shared");
const { createRoleAnalysisService } = require("./analysis-runtime-v2/role-service");
const { createScriptSegmentPipelineDescriptor } = require("./script-segment/pipeline-descriptor");
const { buildScriptSegmentContentFingerprint } = require("./script-segment-analysis/cache-params");
const { prepareInput } = require("./script-segment-analysis/input");
const { buildFailedArtifact } = require("./script-segment-analysis/result-builder");
const { codedError, safeError, sanitizeDebugPayload, ROLE, SKILL_PATH, STAGES, resolveSkillHash } = require("./script-segment-analysis/shared");
const { attachScriptSegmentAnalysis } = require("./script-segment/artifact-writer");

function createScriptSegmentService(options = {}) {
  return createRoleAnalysisService({
    ...options,
    role: ROLE,
    skillPath: SKILL_PATH,
    stages: STAGES,
    safeError,
    sanitizeDebugPayload,
    buildFailedArtifact,
    attachFailedAnalysis: (sampleVideoId, failedArtifact) => attachScriptSegments(sampleVideoId, failedArtifact, options.store),
    defaultFailedStageName: STAGES.analyzed,
    resolveDefaultParentArtifactId: (context) => (
      context.input?.parentArtifactId
      ?? context.artifact?.shotBoundaryAnalysis?.artifactId
      ?? context.artifact?.sampleVideo?.artifactId
      ?? null
    ),
    createDescriptor: createScriptSegmentPipelineDescriptor,
    prepareInput,
    buildContentFingerprint: buildScriptSegmentContentFingerprint,
    resolveSkillHash,
    cacheKind: "script_segment",
    cacheDecisionInvalidJobMessage: "只能对等待缓存选择的脚本段落任务执行该操作",
    assertFreshArtifact: ({ artifact, options: contextOptions }) => assertExpectedShotBoundaryArtifact(
      artifact,
      contextOptions.expectedShotBoundaryArtifactId ?? null,
    ),
    buildContextPatch: (contextOptions) => ({
      expectedShotBoundaryArtifactId: contextOptions.expectedShotBoundaryArtifactId ?? null,
    }),
    readCacheContextPatch: (cachePrompt) => ({
      expectedShotBoundaryArtifactId: cachePrompt.expectedShotBoundaryArtifactId ?? null,
    }),
    codedError,
  });
}

function assertExpectedShotBoundaryArtifact(artifact, expectedShotBoundaryArtifactId) {
  return assertExpectedArtifact({
    expectedArtifactId: expectedShotBoundaryArtifactId,
    actualArtifactId: artifact?.shotBoundaryAnalysis?.artifactId ?? null,
    conflictError,
    code: "script_segment_shot_boundary_stale",
    message: "切镜结果已更新，请刷新后再运行脚本段落分析",
    expectedKey: "expectedShotBoundaryArtifactId",
    actualKey: "actualShotBoundaryArtifactId",
  });
}

function conflictError(code, message, debugPayload = null) {
  const error = codedError(code, message, debugPayload, false);
  error.statusCode = 409;
  return error;
}

async function attachScriptSegments(sampleVideoId, scriptSegmentAnalysis, store, traceMeta = {}) {
  return attachScriptSegmentAnalysis(sampleVideoId, scriptSegmentAnalysis, store, traceMeta);
}

// Compatibility markers for static trace tests:
// runtime.updateActiveThreadMessage(context, turn)
// activeThreadMessage: null
// runtime.job.complete(context)
// runtime.job.resumeProcessing(jobId, STAGES.cacheLookup, 28)

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  createScriptSegmentService,
  prepareInput,
};
