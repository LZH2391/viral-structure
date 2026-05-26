function appendAnalysisHistory(history, analysis, traceMeta, buildSummary = () => ({})) {
  const entries = Array.isArray(history) ? history : [];
  const next = {
    artifactId: analysis?.artifactId ?? null,
    status: analysis?.status ?? "failed",
    resultOrigin: analysis?.resultOrigin ?? "new_turn",
    ...buildSummary(analysis),
    turnId: analysis?.agent?.turnId ?? null,
    traceId: traceMeta?.traceId ?? null,
    sourceTraceId: traceMeta?.sourceTraceId ?? null,
    sourceSampleVideoId: analysis?.sourceSampleVideoId ?? null,
    sourceArtifactId: traceMeta?.sourceArtifactId ?? null,
    sourceTurnId: analysis?.sourceTurnId ?? null,
    cacheKey: analysis?.cacheKey ?? null,
    resultUri: traceMeta?.resultUri ?? null,
    createdAt: analysis?.createdAt ?? new Date().toISOString(),
    validatorCode: analysis?.validation?.validatorCode ?? null,
  };
  return [...entries, next];
}

module.exports = {
  appendAnalysisHistory,
};
