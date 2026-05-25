const { assertExpectedArtifact } = require("./analysis-service-shared");
const { createRoleAnalysisService } = require("./analysis-runtime-v2/role-service");
const { createPackagingStructurePipelineDescriptor } = require("./packaging-structure/pipeline-descriptor");
const { buildPackagingStructureContentFingerprint } = require("./packaging-structure-analysis/cache-params");
const { prepareInput } = require("./packaging-structure-analysis/input");
const { buildFailedArtifact } = require("./packaging-structure-analysis/result-builder");
const { codedError, safeError, sanitizeDebugPayload, ROLE, SKILL_PATH, STAGES, resolveSkillHash } = require("./packaging-structure-analysis/shared");
const { attachPackagingStructureAnalysis } = require("./packaging-structure/artifact-writer");

function createPackagingStructureService(options = {}) {
  return createRoleAnalysisService({
    ...options,
    role: ROLE,
    skillPath: SKILL_PATH,
    stages: STAGES,
    safeError,
    sanitizeDebugPayload,
    buildFailedArtifact,
    attachFailedAnalysis: (sampleVideoId, failedArtifact) => attachPackagingStructures(sampleVideoId, failedArtifact, options.store),
    defaultFailedStageName: STAGES.analyzed,
    resolveDefaultParentArtifactId: (context) => (
      context.input?.parentArtifactId
      ?? context.artifact?.shotBoundaryAnalysis?.artifactId
      ?? context.artifact?.sampleVideo?.artifactId
      ?? null
    ),
    createDescriptor: createPackagingStructurePipelineDescriptor,
    prepareInput,
    buildContentFingerprint: buildPackagingStructureContentFingerprint,
    resolveSkillHash,
    cacheKind: "packaging_structure",
    cacheDecisionInvalidJobMessage: "只能对等待缓存选择的包装结构任务执行该操作",
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
    code: "packaging_structure_shot_boundary_stale",
    message: "切镜结果已更新，请刷新后再运行包装结构分析",
    expectedKey: "expectedShotBoundaryArtifactId",
    actualKey: "actualShotBoundaryArtifactId",
  });
}

function conflictError(code, message, debugPayload = null) {
  const error = codedError(code, message, debugPayload, false);
  error.statusCode = 409;
  return error;
}

async function attachPackagingStructures(sampleVideoId, packagingStructureAnalysis, store, traceMeta = {}) {
  return attachPackagingStructureAnalysis(sampleVideoId, packagingStructureAnalysis, store, traceMeta);
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  createPackagingStructureService,
  prepareInput,
};
