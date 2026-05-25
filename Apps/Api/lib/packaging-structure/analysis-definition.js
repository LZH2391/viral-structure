const { createShotBoundaryDependentRoleDefinition } = require("../analysis-role-definition");
const { createPackagingStructurePipelineDescriptor } = require("./pipeline-descriptor");
const { buildPackagingStructureContentFingerprint } = require("../packaging-structure-analysis/cache-params");
const { prepareInput } = require("../packaging-structure-analysis/input");
const { buildFailedArtifact } = require("../packaging-structure-analysis/result-builder");
const { codedError, safeError, sanitizeDebugPayload, ROLE, SKILL_PATH, STAGES, resolveSkillHash } = require("../packaging-structure-analysis/shared");
const { attachPackagingStructureAnalysis } = require("./artifact-writer");

function createPackagingStructureAnalysisDefinition() {
  return createShotBoundaryDependentRoleDefinition({
    analysisId: "packaging-structure",
    stageKind: "packagingStructure",
    serviceKey: "packagingStructureService",
    legacyPathSegment: "packaging-structure",
    cacheKind: "packaging_structure",
    artifactKey: "packagingStructureAnalysis",
    historyKey: "packagingStructureAnalysisHistory",
    artifactType: "packaging-structure-analysis",
    role: ROLE,
    skillPath: SKILL_PATH,
    stages: STAGES,
    ui: {
      label: "packaging-structure",
      displayName: "包装结构",
      stageId: "packaging.structure.analyze",
      completeReason: "包装结构完成",
      refreshReason: "包装结构重新生成",
      reuseReason: "包装结构复用缓存",
      invalidResultMessage: "包装结构分析未返回有效产物",
      failureMessage: "包装结构分析失败",
      timeoutMessage: "包装结构分析超时",
    },
    createDescriptor: createPackagingStructurePipelineDescriptor,
    prepareInput,
    buildContentFingerprint: buildPackagingStructureContentFingerprint,
    buildFailedArtifact,
    attachAnalysis: attachPackagingStructureAnalysis,
    codedError,
    safeError,
    sanitizeDebugPayload,
    resolveSkillHash,
    cacheDecisionInvalidJobMessage: "只能对等待缓存选择的包装结构任务执行该操作",
    staleDependencyCode: "packaging_structure_shot_boundary_stale",
    staleDependencyMessage: "切镜结果已更新，请刷新后再运行包装结构分析",
  });
}

module.exports = {
  createPackagingStructureAnalysisDefinition,
};
