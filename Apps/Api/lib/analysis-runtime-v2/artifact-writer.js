const path = require("path");
const { writeAnalysisResult } = require("../stores/analysis-result-store");

function createAnalysisArtifactAttacher({
  analysisKey,
  analysisRefKey,
  historyKey,
  resultKind,
  appendHistory,
  resolveSourceArtifactId,
}) {
  return async function attachAnalysis(sampleVideoId, analysis, store, traceMeta = {}) {
    const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
    const artifact = await store.readJson(artifactPath);
    const resultRef = await writeAnalysisResult({ store, sampleVideoId, kind: resultKind, analysis });
    artifact[analysisKey] = analysis;
    artifact[analysisRefKey] = resultRef;
    artifact[historyKey] = appendHistory(artifact[historyKey], analysis, {
      traceId: analysis?.traceId ?? traceMeta.traceId ?? artifact?.trace?.traceId ?? null,
      sourceTraceId: traceMeta.sourceTraceId ?? artifact?.trace?.traceId ?? null,
      resultUri: resultRef.uri,
      sourceArtifactId: resolveSourceArtifactId?.(analysis) ?? null,
    });
    await store.writeJson(artifactPath, artifact);
    return artifact;
  };
}

module.exports = {
  createAnalysisArtifactAttacher,
};
