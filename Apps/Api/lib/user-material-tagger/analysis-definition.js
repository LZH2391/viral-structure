const { createShotBoundaryDependentRoleDefinition } = require("../compatibility/analysis-role-definition");
const { createUserMaterialTaggerPipelineDescriptor } = require("./pipeline-descriptor");
const { buildUserMaterialTaggerCacheParams, buildUserMaterialTaggerContentFingerprint } = require("../user-material-tagger-analysis/cache-params");
const { prepareInput } = require("../user-material-tagger-analysis/input");
const { buildFailedArtifact } = require("../user-material-tagger-analysis/result-builder");
const { codedError, safeError, sanitizeDebugPayload, ROLE, SKILL_PATH, STAGES, resolveSkillHash } = require("../user-material-tagger-analysis/shared");
const { attachUserMaterialPack } = require("./artifact-writer");

function createUserMaterialTaggerAnalysisDefinition() {
  return createShotBoundaryDependentRoleDefinition({
    moduleId: "user-material-tagger",
    moduleKind: "material-understanding",
    serviceKey: "userMaterialTaggerService",
    legacyPathSegment: "user-material-tagger",
    cacheKind: "user_material_pack",
    artifactKey: "userMaterialPack",
    historyKey: "userMaterialPackHistory",
    artifactType: "user-material-pack",
    role: ROLE,
    skillPath: SKILL_PATH,
    stages: STAGES,
    ui: {
      label: "user-material-tagger",
      stageKind: "userMaterialTagger",
      displayName: "素材识别",
      stageId: "user.material_tagger.analyze",
      completeReason: "素材识别完成",
      refreshReason: "素材识别重新生成",
      reuseReason: "素材识别复用缓存",
      invalidResultMessage: "素材识别未返回有效产物",
      failureMessage: "素材识别失败",
      timeoutMessage: "素材识别超时",
    },
    createDescriptor: createUserMaterialTaggerPipelineDescriptor,
    prepareInput,
    buildContentFingerprint: buildUserMaterialTaggerContentFingerprint,
    getArtifact: (artifact) => artifact?.userMaterialPack ?? null,
    buildCacheParams: (artifact) => buildUserMaterialTaggerCacheParams({
      inputFingerprint: artifact?.userMaterialPack?.cacheKey ?? null,
      sourceShotArtifactId: artifact?.userMaterialPack?.sourceShotBoundaryArtifactId ?? null,
      profileVersion: artifact?.userMaterialPack?.agent?.profileVersion ?? null,
      promptTemplateId: artifact?.userMaterialPack?.agent?.promptTemplateId ?? null,
      promptTemplateVersion: artifact?.userMaterialPack?.agent?.promptTemplateVersion ?? null,
      promptTemplateHash: artifact?.userMaterialPack?.agent?.promptTemplateHash ?? null,
      skillHash: artifact?.userMaterialPack?.agent?.skillHash ?? null,
    }),
    buildFailedArtifact,
    attachAnalysis: attachUserMaterialPack,
    codedError,
    safeError,
    sanitizeDebugPayload,
    resolveSkillHash,
    cacheDecisionInvalidJobMessage: "只能对等待缓存选择的素材识别任务执行该操作",
    staleDependencyCode: "user_material_tagger_shot_boundary_stale",
    staleDependencyMessage: "切镜结果已更新，请刷新后再运行素材识别",
  });
}

module.exports = {
  createUserMaterialTaggerAnalysisDefinition,
};
