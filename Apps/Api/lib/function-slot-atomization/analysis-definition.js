const { createRoleAnalysisService } = require("../analysis-runtime-v2/role-service");
const { createModuleDefinition } = require("../modules/definition");
const { createFunctionSlotAtomizationPipelineDescriptor } = require("./pipeline-descriptor");
const { buildFunctionSlotAtomizationCacheParams, buildFunctionSlotAtomizationContentFingerprint } = require("../function-slot-atomization-analysis/cache-params");
const { prepareInput } = require("../function-slot-atomization-analysis/input");
const { buildFailedArtifact } = require("../function-slot-atomization-analysis/result-builder");
const { codedError, safeError, sanitizeDebugPayload, ROLE, SKILL_PATH, STAGES, resolveSkillHash } = require("../function-slot-atomization-analysis/shared");
const { attachFunctionSlotAtomizationAnalysis } = require("./artifact-writer");
const { assertExpectedThreeArtifacts } = require("./pipeline-descriptor");

const DEPENDENCIES = [
  {
    key: "scriptSegmentArtifactId",
    artifactKey: "scriptSegmentAnalysis",
    requestKey: "expectedScriptSegmentArtifactId",
    label: "脚本段落",
  },
  {
    key: "rhythmStructureArtifactId",
    artifactKey: "rhythmStructureAnalysis",
    requestKey: "expectedRhythmStructureArtifactId",
    label: "节奏结构",
  },
  {
    key: "packagingStructureArtifactId",
    artifactKey: "packagingStructureAnalysis",
    requestKey: "expectedPackagingStructureArtifactId",
    label: "包装结构",
  },
];

function createFunctionSlotAtomizationAnalysisDefinition() {
  return createModuleDefinition({
    moduleId: "function-slot-atomization",
    moduleKind: "structure-analysis",
    serviceKey: "functionSlotAtomizationService",
    executorKind: "role-service",
    legacyPathSegment: "function-slot-atomization",
    cacheKind: null,
    route: "/api/sample-videos/:sampleVideoId/analyses/function-slot-atomization",
    legacyRoute: "/api/sample-videos/:sampleVideoId/function-slot-atomization",
    dependencies: DEPENDENCIES,
    artifact: {
      key: "functionSlotAtomizationAnalysis",
      historyKey: "functionSlotAtomizationAnalysisHistory",
      type: "function-slot-atomization-analysis",
    },
    getArtifact: (artifact) => artifact?.functionSlotAtomizationAnalysis ?? null,
    buildCacheParams: (artifact) => buildFunctionSlotAtomizationCacheParams({
      inputFingerprint: artifact?.functionSlotAtomizationAnalysis?.cacheKey ?? null,
      sourceScriptSegmentArtifactId: artifact?.functionSlotAtomizationAnalysis?.sourceScriptSegmentArtifactId ?? null,
      sourceRhythmStructureArtifactId: artifact?.functionSlotAtomizationAnalysis?.sourceRhythmStructureArtifactId ?? null,
      sourcePackagingStructureArtifactId: artifact?.functionSlotAtomizationAnalysis?.sourcePackagingStructureArtifactId ?? null,
      profileVersion: artifact?.functionSlotAtomizationAnalysis?.agent?.profileVersion ?? null,
      promptTemplateId: artifact?.functionSlotAtomizationAnalysis?.agent?.promptTemplateId ?? null,
      promptTemplateVersion: artifact?.functionSlotAtomizationAnalysis?.agent?.promptTemplateVersion ?? null,
      promptTemplateHash: artifact?.functionSlotAtomizationAnalysis?.agent?.promptTemplateHash ?? null,
      skillHash: artifact?.functionSlotAtomizationAnalysis?.agent?.skillHash ?? null,
    }),
    role: ROLE,
    stages: STAGES,
    ui: {
      label: "function-slot-atomization",
      stageKind: "functionSlotAtomization",
      displayName: "功能槽位原子化",
      stageId: "function.slot.atomization.analyze",
      completeReason: "功能槽位原子化完成",
      refreshReason: "功能槽位原子化重新生成",
      reuseReason: "功能槽位原子化复用缓存",
      invalidResultMessage: "功能槽位原子化未返回有效产物",
      failureMessage: "功能槽位原子化失败",
      timeoutMessage: "功能槽位原子化超时",
    },
    startOptionsFromBody: buildFunctionSlotAtomizationStartOptions,
    createService: (options = {}) => createRoleAnalysisService({
      ...options,
      role: ROLE,
      skillPath: SKILL_PATH,
      stages: STAGES,
      safeError,
      sanitizeDebugPayload,
      buildFailedArtifact,
      attachFailedAnalysis: (sampleVideoId, failedArtifact) => attachFunctionSlotAtomizationAnalysis(sampleVideoId, failedArtifact, options.store),
      defaultFailedStageName: STAGES.analyzed,
      resolveDefaultParentArtifactId,
      createDescriptor: createFunctionSlotAtomizationPipelineDescriptor,
      prepareInput,
      buildContentFingerprint: buildFunctionSlotAtomizationContentFingerprint,
      resolveSkillHash,
      cacheKind: null,
      cacheDecisionInvalidJobMessage: "原子化分析暂不支持缓存选择",
      assertFreshArtifact: ({ artifact, options: contextOptions }) => assertExpectedThreeArtifacts({
        latestArtifact: artifact,
        context: {
          input: null,
          expectedScriptSegmentArtifactId: contextOptions.expectedScriptSegmentArtifactId ?? null,
          expectedRhythmStructureArtifactId: contextOptions.expectedRhythmStructureArtifactId ?? null,
          expectedPackagingStructureArtifactId: contextOptions.expectedPackagingStructureArtifactId ?? null,
        },
        conflictCode: "function_slot_atomization_dependency_stale",
        conflictMessage: "上游脚本/节奏/包装结果已更新，请刷新后再运行原子化分析",
      }),
      buildContextPatch: (contextOptions) => ({
        expectedScriptSegmentArtifactId: contextOptions.expectedScriptSegmentArtifactId ?? null,
        expectedRhythmStructureArtifactId: contextOptions.expectedRhythmStructureArtifactId ?? null,
        expectedPackagingStructureArtifactId: contextOptions.expectedPackagingStructureArtifactId ?? null,
      }),
      readCacheContextPatch: () => ({}),
      codedError,
    }),
    supportsCacheReuse: false,
  });
}

function buildFunctionSlotAtomizationStartOptions({ sampleVideoId, body = {} }) {
  const dependencies = body?.dependencies && typeof body.dependencies === "object" ? body.dependencies : {};
  return {
    sampleVideoId,
    cacheDecision: "refresh",
    expectedScriptSegmentArtifactId: dependencies.scriptSegmentArtifactId ?? body?.expectedScriptSegmentArtifactId ?? null,
    expectedRhythmStructureArtifactId: dependencies.rhythmStructureArtifactId ?? body?.expectedRhythmStructureArtifactId ?? null,
    expectedPackagingStructureArtifactId: dependencies.packagingStructureArtifactId ?? body?.expectedPackagingStructureArtifactId ?? null,
  };
}

function resolveDefaultParentArtifactId(context) {
  return context.input?.parentArtifactId
    ?? context.artifact?.packagingStructureAnalysis?.artifactId
    ?? context.artifact?.rhythmStructureAnalysis?.artifactId
    ?? context.artifact?.scriptSegmentAnalysis?.artifactId
    ?? context.artifact?.sampleVideo?.artifactId
    ?? null;
}

module.exports = {
  DEPENDENCIES,
  createFunctionSlotAtomizationAnalysisDefinition,
  buildFunctionSlotAtomizationStartOptions,
};
