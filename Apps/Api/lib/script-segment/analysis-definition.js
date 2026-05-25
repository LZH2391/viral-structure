const { createShotBoundaryDependentRoleDefinition } = require("../analysis-role-definition");
const { createScriptSegmentPipelineDescriptor } = require("./pipeline-descriptor");
const { buildScriptSegmentContentFingerprint } = require("../script-segment-analysis/cache-params");
const { prepareInput } = require("../script-segment-analysis/input");
const { buildFailedArtifact } = require("../script-segment-analysis/result-builder");
const { codedError, safeError, sanitizeDebugPayload, ROLE, SKILL_PATH, STAGES, resolveSkillHash } = require("../script-segment-analysis/shared");
const { attachScriptSegmentAnalysis } = require("./artifact-writer");

function createScriptSegmentAnalysisDefinition() {
  return createShotBoundaryDependentRoleDefinition({
    analysisId: "script-segments",
    stageKind: "scriptSegment",
    serviceKey: "scriptSegmentService",
    legacyPathSegment: "script-segments",
    cacheKind: "script_segment",
    artifactKey: "scriptSegmentAnalysis",
    historyKey: "scriptSegmentAnalysisHistory",
    artifactType: "script-segment-analysis",
    role: ROLE,
    skillPath: SKILL_PATH,
    stages: STAGES,
    ui: {
      label: "script-segments",
      displayName: "脚本段落",
      stageId: "script.segment.analyze",
      completeReason: "结构理解完成",
      refreshReason: "脚本段落重新生成",
      reuseReason: "脚本段落复用缓存",
      invalidResultMessage: "脚本段落分析未返回有效产物",
      failureMessage: "脚本段落分析失败",
      timeoutMessage: "脚本段落分析超时",
    },
    createDescriptor: createScriptSegmentPipelineDescriptor,
    prepareInput,
    buildContentFingerprint: buildScriptSegmentContentFingerprint,
    buildFailedArtifact,
    attachAnalysis: attachScriptSegmentAnalysis,
    codedError,
    safeError,
    sanitizeDebugPayload,
    resolveSkillHash,
    cacheDecisionInvalidJobMessage: "只能对等待缓存选择的脚本段落任务执行该操作",
    staleDependencyCode: "script_segment_shot_boundary_stale",
    staleDependencyMessage: "切镜结果已更新，请刷新后再运行脚本段落分析",
  });
}

module.exports = {
  createScriptSegmentAnalysisDefinition,
};
