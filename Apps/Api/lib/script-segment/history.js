function appendScriptSegmentHistory(history, analysis, traceMeta) {
  const entries = Array.isArray(history) ? history : [];
  const next = {
    artifactId: analysis?.artifactId ?? null,
    status: analysis?.status ?? "failed",
    resultOrigin: analysis?.resultOrigin ?? "new_turn",
    segmentCount: analysis?.segments?.length ?? 0,
    turnId: analysis?.agent?.turnId ?? null,
    traceId: traceMeta?.traceId ?? null,
    sourceTraceId: traceMeta?.sourceTraceId ?? null,
    sourceSampleVideoId: analysis?.sourceSampleVideoId ?? null,
    sourceTurnId: analysis?.sourceTurnId ?? null,
    cacheKey: analysis?.cacheKey ?? null,
    createdAt: analysis?.createdAt ?? new Date().toISOString(),
    validatorCode: analysis?.validation?.validatorCode ?? null,
  };
  return [...entries, next];
}

module.exports = {
  appendScriptSegmentHistory,
};
