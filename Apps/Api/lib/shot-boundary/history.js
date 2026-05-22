function appendShotBoundaryHistory(history, analysis, traceMeta) {
  const entries = Array.isArray(history) ? history : [];
  const next = {
    artifactId: analysis?.artifactId ?? null,
    status: analysis?.status ?? "failed",
    resultOrigin: analysis?.resultOrigin ?? "new_turn",
    analysisFps: analysis?.analysisSampling?.fps ?? null,
    boundaryCount: analysis?.boundaries?.length ?? 0,
    shotCount: analysis?.shots?.length ?? 0,
    turnId: analysis?.agent?.turnId ?? null,
    traceId: traceMeta?.traceId ?? null,
    sourceTraceId: traceMeta?.sourceTraceId ?? null,
    createdAt: analysis?.createdAt ?? new Date().toISOString(),
    validatorCode: analysis?.validation?.validatorCode ?? null,
  };
  return [...entries, next];
}

module.exports = {
  appendShotBoundaryHistory,
};
