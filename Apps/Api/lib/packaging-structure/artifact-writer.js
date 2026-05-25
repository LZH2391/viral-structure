const path = require("path");
const { writeAnalysisResult } = require("../analysis-result-store");
const { appendPackagingStructureHistory } = require("./history");

async function attachPackagingStructureAnalysis(sampleVideoId, analysis, store, traceMeta = {}) {
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  const artifact = await store.readJson(artifactPath);
  const resultRef = await writeAnalysisResult({ store, sampleVideoId, kind: "packaging_structure", analysis });
  artifact.packagingStructureAnalysis = analysis;
  artifact.packagingStructureAnalysisRef = resultRef;
  artifact.packagingStructureAnalysisHistory = appendPackagingStructureHistory(artifact.packagingStructureAnalysisHistory, analysis, {
    traceId: analysis?.traceId ?? traceMeta.traceId ?? artifact?.trace?.traceId ?? null,
    sourceTraceId: traceMeta.sourceTraceId ?? artifact?.trace?.traceId ?? null,
    resultUri: resultRef.uri,
    sourceArtifactId: analysis?.sourcePackagingStructureArtifactId ?? null,
  });
  await store.writeJson(artifactPath, artifact);
  return artifact;
}

module.exports = {
  attachPackagingStructureAnalysis,
};

