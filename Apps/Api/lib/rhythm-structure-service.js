const { assertExpectedArtifact } = require("./analysis-service-shared");
const { createRoleAnalysisService } = require("./analysis-runtime-v2/role-service");
const { createRhythmStructurePipelineDescriptor } = require("./rhythm-structure/pipeline-descriptor");
const { buildRhythmStructureContentFingerprint } = require("./rhythm-structure-analysis/cache-params");
const { prepareInput } = require("./rhythm-structure-analysis/input");
const { buildFailedArtifact } = require("./rhythm-structure-analysis/result-builder");
const { codedError, safeError, sanitizeDebugPayload, ROLE, SKILL_PATH, STAGES, resolveSkillHash } = require("./rhythm-structure-analysis/shared");
const { attachRhythmStructureAnalysis } = require("./rhythm-structure/artifact-writer");

function createRhythmStructureService(options = {}) {
  return createRoleAnalysisService({
    ...options,
    role: ROLE,
    skillPath: SKILL_PATH,
    stages: STAGES,
    safeError,
    sanitizeDebugPayload,
    buildFailedArtifact,
    attachFailedAnalysis: (sampleVideoId, failedArtifact) => attachRhythmStructures(sampleVideoId, failedArtifact, options.store),
    defaultFailedStageName: STAGES.analyzed,
    resolveDefaultParentArtifactId: (context) => (
      context.input?.parentArtifactId
      ?? context.artifact?.shotBoundaryAnalysis?.artifactId
      ?? context.artifact?.sampleVideo?.artifactId
      ?? null
    ),
    createDescriptor: createRhythmStructurePipelineDescriptor,
    prepareInput,
    buildContentFingerprint: buildRhythmStructureContentFingerprint,
    resolveSkillHash,
    cacheKind: "rhythm_structure",
    cacheDecisionInvalidJobMessage: "只能对等待缓存选择的节奏结构任务执行该操作",
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
    code: "rhythm_structure_shot_boundary_stale",
    message: "切镜结果已更新，请刷新后再运行节奏结构分析",
    expectedKey: "expectedShotBoundaryArtifactId",
    actualKey: "actualShotBoundaryArtifactId",
  });
}

function conflictError(code, message, debugPayload = null) {
  const error = codedError(code, message, debugPayload, false);
  error.statusCode = 409;
  return error;
}

async function attachRhythmStructures(sampleVideoId, rhythmStructureAnalysis, store, traceMeta = {}) {
  return attachRhythmStructureAnalysis(sampleVideoId, rhythmStructureAnalysis, store, traceMeta);
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  createRhythmStructureService,
  prepareInput,
};
