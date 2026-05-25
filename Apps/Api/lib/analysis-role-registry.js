const { buildShotBoundaryDependentStartOptions } = require("./analysis-role-definition");
const { createScriptSegmentAnalysisDefinition } = require("./script-segment/analysis-definition");
const { createRhythmStructureAnalysisDefinition } = require("./rhythm-structure/analysis-definition");
const { createPackagingStructureAnalysisDefinition } = require("./packaging-structure/analysis-definition");

const ANALYSIS_ROLE_DEFINITIONS = [
  createScriptSegmentAnalysisDefinition(),
  createRhythmStructureAnalysisDefinition(),
  createPackagingStructureAnalysisDefinition(),
];

function createAnalysisRoleRegistry(options = {}) {
  const serviceOverrides = options.serviceOverrides ?? {};
  const entries = ANALYSIS_ROLE_DEFINITIONS.map((definition) => {
    const service = serviceOverrides[definition.serviceKey] ?? createServiceForDefinition(definition, options);
    return { ...definition, service };
  });
  const byAnalysisId = indexBy(entries, "analysisId");
  const byLegacyPathSegment = indexBy(entries, "legacyPathSegment");
  const byCacheKind = indexBy(entries, "cacheKind");

  return {
    list: () => entries.map(toPublicEntry),
    getByAnalysisId: (analysisId) => byAnalysisId.get(analysisId) ?? null,
    getByLegacyPathSegment: (legacyPathSegment) => byLegacyPathSegment.get(legacyPathSegment) ?? null,
    getByCacheKind: (cacheKind) => byCacheKind.get(cacheKind) ?? null,
    startAnalysis: ({ analysisId, sampleVideoId, body = {} }) => {
      const entry = byAnalysisId.get(analysisId);
      if (!entry) throw notFoundError("analysis_not_found", "未知分析能力", { analysisId });
      return entry.service.enqueue(entry.startOptionsFromBody({ sampleVideoId, body }));
    },
    startLegacyAnalysis: ({ legacyPathSegment, sampleVideoId, body = {} }) => {
      const entry = byLegacyPathSegment.get(legacyPathSegment);
      if (!entry) throw notFoundError("analysis_not_found", "未知分析能力", { legacyPathSegment });
      return entry.service.enqueue(entry.startOptionsFromBody({ sampleVideoId, body }));
    },
    resolveAnalysisCacheDecision: ({ cacheKind, jobId, decision }) => {
      const entry = byCacheKind.get(cacheKind);
      if (!entry) return null;
      return entry.service.resolveCacheDecision({ jobId, decision });
    },
  };
}

function createServiceForDefinition(definition, options) {
  if (definition.executorKind === "role-service" && typeof definition.createService === "function") {
    return definition.createService(options);
  }
  if (definition.executorKind === "custom-service" && typeof definition.createService === "function") {
    return definition.createService(options);
  }
  throw new Error(`Unsupported analysis executor: ${definition.executorKind ?? "unknown"}`);
}

function indexBy(entries, key) {
  return new Map(entries.map((entry) => [entry[key], entry]));
}

function toPublicEntry(entry) {
  return {
    analysisId: entry.analysisId,
    stageKind: entry.stageKind,
    cacheKind: entry.cacheKind,
    artifactKey: entry.artifact?.key ?? null,
    artifactType: entry.artifact?.type ?? null,
    route: entry.route,
    legacyRoute: entry.legacyRoute,
    dependencies: entry.dependencies,
    ui: entry.ui,
    stages: entry.stages,
  };
}

function notFoundError(code, message, debugPayload = {}) {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = false;
  return error;
}

module.exports = {
  ANALYSIS_ROLE_DEFINITIONS,
  buildShotBoundaryDependentStartOptions,
  createAnalysisRoleRegistry,
};
