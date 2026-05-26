function createModuleDefinition(config) {
  return {
    moduleId: config.moduleId,
    moduleKind: config.moduleKind,
    executorKind: config.executorKind,
    serviceKey: config.serviceKey,
    legacyPathSegment: config.legacyPathSegment ?? null,
    cacheKind: config.cacheKind ?? null,
    route: config.route,
    legacyRoute: config.legacyRoute ?? null,
    dependencies: Array.isArray(config.dependencies) ? config.dependencies : [],
    artifact: config.artifact ?? null,
    getArtifact: typeof config.getArtifact === "function" ? config.getArtifact : defaultGetArtifact(config.artifact?.key),
    buildCacheParams: typeof config.buildCacheParams === "function" ? config.buildCacheParams : null,
    role: config.role ?? null,
    stages: config.stages ?? null,
    ui: config.ui ?? null,
    startOptionsFromBody: typeof config.startOptionsFromBody === "function" ? config.startOptionsFromBody : null,
    createService: typeof config.createService === "function" ? config.createService : null,
    supportsCacheReuse: config.supportsCacheReuse ?? Boolean(config.cacheKind),
    supportsRerun: config.supportsRerun ?? false,
    artifactPolicy: config.artifactPolicy ?? (config.artifact ? "required" : "none"),
  };
}

function defaultGetArtifact(artifactKey) {
  if (!artifactKey) return () => null;
  return (artifact) => artifact?.[artifactKey] ?? null;
}

function toPublicModuleEntry(module) {
  return {
    moduleId: module.moduleId,
    moduleKind: module.moduleKind,
    cacheKind: module.cacheKind,
    artifactKey: module.artifact?.key ?? null,
    artifactType: module.artifact?.type ?? null,
    route: module.route,
    legacyRoute: module.legacyRoute,
    dependencies: module.dependencies,
    ui: module.ui,
    stages: module.stages,
    executorKind: module.executorKind,
    supportsCacheReuse: module.supportsCacheReuse,
    supportsRerun: module.supportsRerun,
    artifactPolicy: module.artifactPolicy,
  };
}

module.exports = {
  createModuleDefinition,
  toPublicModuleEntry,
};
