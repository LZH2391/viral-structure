const { assertExpectedArtifact } = require("./analysis-service-shared");
const { createRoleAnalysisService } = require("../analysis-runtime-v2/role-service");
const { createModuleDefinition } = require("../modules/definition");

const SHOT_BOUNDARY_DEPENDENCY = {
  key: "shotBoundaryArtifactId",
  artifactKey: "shotBoundaryAnalysis",
  requestKey: "expectedShotBoundaryArtifactId",
  label: "切镜结果",
};

function createShotBoundaryDependentRoleDefinition(config) {
  return createModuleDefinition({
    moduleId: config.moduleId,
    moduleKind: config.moduleKind,
    serviceKey: config.serviceKey,
    executorKind: "role-service",
    legacyPathSegment: config.legacyPathSegment,
    cacheKind: config.cacheKind,
    route: `/api/sample-videos/:sampleVideoId/analyses/${config.moduleId}`,
    legacyRoute: `/api/sample-videos/:sampleVideoId/${config.legacyPathSegment}`,
    dependencies: [SHOT_BOUNDARY_DEPENDENCY],
    artifact: {
      key: config.artifactKey,
      historyKey: config.historyKey,
      type: config.artifactType,
    },
    getArtifact: config.getArtifact,
    buildCacheParams: config.buildCacheParams,
    role: config.role,
    stages: config.stages,
    ui: config.ui,
    startOptionsFromBody: buildShotBoundaryDependentStartOptions,
    createService: (options = {}) => createRoleAnalysisService({
      ...options,
      role: config.role,
      skillPath: config.skillPath,
      stages: config.stages,
      safeError: config.safeError,
      sanitizeDebugPayload: config.sanitizeDebugPayload,
      buildFailedArtifact: config.buildFailedArtifact,
      attachFailedAnalysis: (sampleVideoId, failedArtifact) => config.attachAnalysis(sampleVideoId, failedArtifact, options.store),
      defaultFailedStageName: config.stages.analyzed,
      resolveDefaultParentArtifactId: config.resolveDefaultParentArtifactId ?? defaultShotBoundaryParentArtifactId,
      createDescriptor: config.createDescriptor,
      prepareInput: config.prepareInput,
      buildContentFingerprint: config.buildContentFingerprint,
      resolveSkillHash: config.resolveSkillHash,
      cacheKind: config.cacheKind,
      cacheDecisionInvalidJobMessage: config.cacheDecisionInvalidJobMessage,
      assertFreshArtifact: ({ artifact, options: contextOptions }) => assertExpectedShotBoundaryArtifact({
        artifact,
        expectedShotBoundaryArtifactId: contextOptions.expectedShotBoundaryArtifactId ?? null,
        codedError: config.codedError,
        code: config.staleDependencyCode,
        message: config.staleDependencyMessage,
      }),
      buildContextPatch: (contextOptions) => ({
        expectedShotBoundaryArtifactId: contextOptions.expectedShotBoundaryArtifactId ?? null,
      }),
      readCacheContextPatch: (cachePrompt) => ({
        expectedShotBoundaryArtifactId: cachePrompt.expectedShotBoundaryArtifactId ?? null,
      }),
      codedError: config.codedError,
    }),
  });
}

function buildShotBoundaryDependentStartOptions({ sampleVideoId, body = {} }) {
  const dependencies = body?.dependencies && typeof body.dependencies === "object" ? body.dependencies : {};
  return {
    sampleVideoId,
    cacheDecision: body?.cacheDecision ?? "ask",
    expectedShotBoundaryArtifactId: dependencies.shotBoundaryArtifactId ?? body?.expectedShotBoundaryArtifactId ?? null,
  };
}

function defaultShotBoundaryParentArtifactId(context) {
  return context.input?.parentArtifactId
    ?? context.artifact?.shotBoundaryAnalysis?.artifactId
    ?? context.artifact?.sampleVideo?.artifactId
    ?? null;
}

function assertExpectedShotBoundaryArtifact({ artifact, expectedShotBoundaryArtifactId, codedError, code, message }) {
  return assertExpectedArtifact({
    expectedArtifactId: expectedShotBoundaryArtifactId,
    actualArtifactId: artifact?.shotBoundaryAnalysis?.artifactId ?? null,
    conflictError: (errorCode, errorMessage, debugPayload) => {
      const error = codedError(errorCode, errorMessage, debugPayload, false);
      error.statusCode = 409;
      return error;
    },
    code,
    message,
    expectedKey: "expectedShotBoundaryArtifactId",
    actualKey: "actualShotBoundaryArtifactId",
  });
}

module.exports = {
  SHOT_BOUNDARY_DEPENDENCY,
  buildShotBoundaryDependentStartOptions,
  createShotBoundaryDependentRoleDefinition,
};
