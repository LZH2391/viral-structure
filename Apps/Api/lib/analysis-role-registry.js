const { createScriptSegmentService } = require("./script-segment-service");
const { createRhythmStructureService } = require("./rhythm-structure-service");
const { createPackagingStructureService } = require("./packaging-structure-service");

const ANALYSIS_ROLE_DEFINITIONS = [
  {
    analysisId: "script-segments",
    serviceKey: "scriptSegmentService",
    legacyPathSegment: "script-segments",
    cacheKind: "script_segment",
    createService: createScriptSegmentService,
    route: "/api/sample-videos/:sampleVideoId/analyses/script-segments",
    legacyRoute: "/api/sample-videos/:sampleVideoId/script-segments",
    ui: { label: "script-segments", artifactKey: "scriptSegmentAnalysis" },
    startOptionsFromBody: buildShotBoundaryDependentStartOptions,
  },
  {
    analysisId: "rhythm-structure",
    serviceKey: "rhythmStructureService",
    legacyPathSegment: "rhythm-structure",
    cacheKind: "rhythm_structure",
    createService: createRhythmStructureService,
    route: "/api/sample-videos/:sampleVideoId/analyses/rhythm-structure",
    legacyRoute: "/api/sample-videos/:sampleVideoId/rhythm-structure",
    ui: { label: "rhythm-structure", artifactKey: "rhythmStructureAnalysis" },
    startOptionsFromBody: buildShotBoundaryDependentStartOptions,
  },
  {
    analysisId: "packaging-structure",
    serviceKey: "packagingStructureService",
    legacyPathSegment: "packaging-structure",
    cacheKind: "packaging_structure",
    createService: createPackagingStructureService,
    route: "/api/sample-videos/:sampleVideoId/analyses/packaging-structure",
    legacyRoute: "/api/sample-videos/:sampleVideoId/packaging-structure",
    ui: { label: "packaging-structure", artifactKey: "packagingStructureAnalysis" },
    startOptionsFromBody: buildShotBoundaryDependentStartOptions,
  },
];

function createAnalysisRoleRegistry(options = {}) {
  const serviceOverrides = options.serviceOverrides ?? {};
  const entries = ANALYSIS_ROLE_DEFINITIONS.map((definition) => {
    const service = serviceOverrides[definition.serviceKey] ?? definition.createService(options);
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

function buildShotBoundaryDependentStartOptions({ sampleVideoId, body = {} }) {
  const dependencies = body?.dependencies && typeof body.dependencies === "object" ? body.dependencies : {};
  return {
    sampleVideoId,
    cacheDecision: body?.cacheDecision ?? "ask",
    expectedShotBoundaryArtifactId: dependencies.shotBoundaryArtifactId ?? body?.expectedShotBoundaryArtifactId ?? null,
  };
}

function indexBy(entries, key) {
  return new Map(entries.map((entry) => [entry[key], entry]));
}

function toPublicEntry(entry) {
  return {
    analysisId: entry.analysisId,
    serviceKey: entry.serviceKey,
    legacyPathSegment: entry.legacyPathSegment,
    cacheKind: entry.cacheKind,
    route: entry.route,
    legacyRoute: entry.legacyRoute,
    ui: entry.ui,
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
