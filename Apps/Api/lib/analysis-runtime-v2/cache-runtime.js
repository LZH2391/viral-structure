function buildAnalysisOptions(options = {}) {
  return { ...options };
}

function buildDependencyRefs(dependencies = {}) {
  return Object.fromEntries(
    Object.entries(dependencies)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, value ?? null]),
  );
}

function buildUnifiedCachePrompt({
  cacheKind,
  cachedItem,
  sourceSampleVideoId,
  sourceArtifactId = null,
  sourceTurnId = null,
  sourceTraceId = null,
  sourceCreatedAt = null,
  cacheKey = null,
  artifactId = null,
  skillPath = null,
  skillHash = null,
  profileVersion = null,
  promptTemplateId = null,
  promptTemplateVersion = null,
  promptTemplateHash = null,
  dependencies = {},
  analysisOptions = {},
  legacy = {},
}) {
  return {
    cacheKind,
    cachedItem,
    sourceSampleVideoId: sourceSampleVideoId ?? cachedItem?.sourceSampleVideoId ?? cachedItem?.sampleVideoId ?? null,
    sourceArtifactId,
    sourceTurnId,
    sourceTraceId,
    sourceCreatedAt,
    cacheKey,
    artifactId,
    skillPath,
    skillHash,
    profileVersion,
    promptTemplateId,
    promptTemplateVersion,
    promptTemplateHash,
    dependencies: buildDependencyRefs(dependencies),
    analysisOptions: buildAnalysisOptions(analysisOptions),
    ...legacy,
  };
}

function readCacheDependency(cachePrompt, key, legacyKey = key) {
  return cachePrompt?.dependencies?.[key] ?? cachePrompt?.analysisOptions?.[key] ?? cachePrompt?.[legacyKey] ?? null;
}

function readCacheOption(cachePrompt, key, legacyKey = key) {
  return cachePrompt?.analysisOptions?.[key] ?? cachePrompt?.[legacyKey] ?? null;
}

function resolveCacheSourceSampleVideoId(cachePrompt) {
  return cachePrompt?.sourceSampleVideoId
    ?? cachePrompt?.cachedItem?.sourceSampleVideoId
    ?? cachePrompt?.cachedItem?.sampleVideoId
    ?? null;
}

module.exports = {
  buildAnalysisOptions,
  buildDependencyRefs,
  buildUnifiedCachePrompt,
  readCacheDependency,
  readCacheOption,
  resolveCacheSourceSampleVideoId,
};
