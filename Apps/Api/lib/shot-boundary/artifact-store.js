const path = require("path");
const { appendShotBoundaryHistory } = require("./history");

async function loadSampleArtifact(store, sampleVideoId) {
  return store.readJson(path.join(store.sampleDir(sampleVideoId), "artifact.json"));
}

async function attachAnalysis({ store, sampleVideoId, analysis, traceMeta = {} }) {
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  const artifact = await store.readJson(artifactPath);
  artifact.shotBoundaryAnalysis = analysis;
  artifact.shotBoundaryAnalysisHistory = appendShotBoundaryHistory(artifact.shotBoundaryAnalysisHistory, analysis, {
    traceId: traceMeta.traceId ?? artifact.trace?.traceId ?? null,
    sourceTraceId: traceMeta.sourceTraceId ?? artifact.trace?.traceId ?? null,
  });
  await store.writeJson(artifactPath, artifact);
  return artifact;
}

module.exports = {
  loadSampleArtifact,
  attachAnalysis,
};
