const { buildShotBoundaryDependentStartOptions } = require("./analysis-role-definition");
const { MODULE_DEFINITIONS } = require("./module-catalog");
const { createModuleRegistry } = require("./module-registry");

const ANALYSIS_ROLE_DEFINITIONS = MODULE_DEFINITIONS.filter((definition) => definition.moduleKind === "structure-analysis");

function createAnalysisRoleRegistry(options = {}) {
  const moduleRegistry = options.moduleRegistry ?? createModuleRegistry(options);
  const analysisCacheKinds = new Set(ANALYSIS_ROLE_DEFINITIONS.map((definition) => definition.cacheKind).filter(Boolean));

  return {
    list: () => moduleRegistry.list().filter((entry) => entry.moduleKind === "structure-analysis").map(toPublicEntry),
    getByAnalysisId: (analysisId) => moduleRegistry.getByModuleId(analysisId),
    getByLegacyPathSegment: (legacyPathSegment) => moduleRegistry.getByLegacyPathSegment(legacyPathSegment),
    getByCacheKind: (cacheKind) => moduleRegistry.getByCacheKind(cacheKind),
    startAnalysis: ({ analysisId, sampleVideoId, body = {} }) => moduleRegistry.startModule({ moduleId: analysisId, sampleVideoId, body }),
    startLegacyAnalysis: ({ legacyPathSegment, sampleVideoId, body = {} }) => moduleRegistry.startLegacyModule({ legacyPathSegment, sampleVideoId, body }),
    resolveAnalysisCacheDecision: ({ cacheKind, jobId, decision }) => {
      if (!analysisCacheKinds.has(cacheKind)) return null;
      return moduleRegistry.resolveModuleCacheDecision({ cacheKind, jobId, decision });
    },
  };
}

function toPublicEntry(entry) {
  return {
    analysisId: entry.moduleId,
    stageKind: entry.ui?.stageKind ?? null,
    cacheKind: entry.cacheKind,
    artifactKey: entry.artifactKey ?? null,
    artifactType: entry.artifactType ?? null,
    route: entry.route,
    legacyRoute: entry.legacyRoute,
    dependencies: entry.dependencies,
    ui: entry.ui,
    stages: entry.stages,
  };
}

module.exports = {
  ANALYSIS_ROLE_DEFINITIONS,
  buildShotBoundaryDependentStartOptions,
  createAnalysisRoleRegistry,
};
