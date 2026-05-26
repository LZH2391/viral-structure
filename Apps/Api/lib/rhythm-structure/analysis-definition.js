const { createShotBoundaryDependentRoleDefinition } = require("../analysis-role-definition");
const { createRhythmStructurePipelineDescriptor } = require("./pipeline-descriptor");
const { buildRhythmStructureCacheParams, buildRhythmStructureContentFingerprint } = require("../rhythm-structure-analysis/cache-params");
const { prepareInput } = require("../rhythm-structure-analysis/input");
const { buildFailedArtifact } = require("../rhythm-structure-analysis/result-builder");
const { codedError, safeError, sanitizeDebugPayload, ROLE, SKILL_PATH, STAGES, resolveSkillHash } = require("../rhythm-structure-analysis/shared");
const { attachRhythmStructureAnalysis } = require("./artifact-writer");

function createRhythmStructureAnalysisDefinition() {
  return createShotBoundaryDependentRoleDefinition({
    moduleId: "rhythm-structure",
    moduleKind: "structure-analysis",
    serviceKey: "rhythmStructureService",
    legacyPathSegment: "rhythm-structure",
    cacheKind: "rhythm_structure",
    artifactKey: "rhythmStructureAnalysis",
    historyKey: "rhythmStructureAnalysisHistory",
    artifactType: "rhythm-structure-analysis",
    role: ROLE,
    skillPath: SKILL_PATH,
    stages: STAGES,
    ui: {
      label: "rhythm-structure",
      stageKind: "rhythmStructure",
      displayName: "节奏结构",
      stageId: "rhythm.structure.analyze",
      completeReason: "节奏结构完成",
      refreshReason: "节奏结构重新生成",
      reuseReason: "节奏结构复用缓存",
      invalidResultMessage: "节奏结构分析未返回有效产物",
      failureMessage: "节奏结构分析失败",
      timeoutMessage: "节奏结构分析超时",
    },
    createDescriptor: createRhythmStructurePipelineDescriptor,
    prepareInput,
    buildContentFingerprint: buildRhythmStructureContentFingerprint,
    getArtifact: (artifact) => artifact?.rhythmStructureAnalysis ?? null,
    buildCacheParams: (artifact) => buildRhythmStructureCacheParams({
      inputFingerprint: artifact?.rhythmStructureAnalysis?.cacheKey ?? null,
      sourceShotArtifactId: artifact?.rhythmStructureAnalysis?.sourceShotBoundaryArtifactId ?? null,
      profileVersion: artifact?.rhythmStructureAnalysis?.agent?.profileVersion ?? null,
      promptTemplateId: artifact?.rhythmStructureAnalysis?.agent?.promptTemplateId ?? null,
      promptTemplateVersion: artifact?.rhythmStructureAnalysis?.agent?.promptTemplateVersion ?? null,
      promptTemplateHash: artifact?.rhythmStructureAnalysis?.agent?.promptTemplateHash ?? null,
      skillHash: artifact?.rhythmStructureAnalysis?.agent?.skillHash ?? null,
    }),
    buildFailedArtifact,
    attachAnalysis: attachRhythmStructureAnalysis,
    codedError,
    safeError,
    sanitizeDebugPayload,
    resolveSkillHash,
    cacheDecisionInvalidJobMessage: "只能对等待缓存选择的节奏结构任务执行该操作",
    staleDependencyCode: "rhythm_structure_shot_boundary_stale",
    staleDependencyMessage: "切镜结果已更新，请刷新后再运行节奏结构分析",
  });
}

module.exports = {
  createRhythmStructureAnalysisDefinition,
};
