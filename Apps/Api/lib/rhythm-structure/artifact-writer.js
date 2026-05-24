const path = require("path");
const { writeAnalysisResult } = require("../analysis-result-store");
const { appendRhythmStructureHistory } = require("./history");

async function attachRhythmStructureAnalysis(sampleVideoId, analysis, store, traceMeta = {}) {
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  const artifact = await store.readJson(artifactPath);
  const resultRef = await writeAnalysisResult({ store, sampleVideoId, kind: "rhythm_structure", analysis });
  artifact.rhythmStructureAnalysis = analysis;
  artifact.rhythmStructureAnalysisRef = resultRef;
  artifact.rhythmStructureAnalysisHistory = appendRhythmStructureHistory(artifact.rhythmStructureAnalysisHistory, analysis, {
    traceId: analysis?.traceId ?? traceMeta.traceId ?? artifact?.trace?.traceId ?? null,
    sourceTraceId: traceMeta.sourceTraceId ?? artifact?.trace?.traceId ?? null,
    resultUri: resultRef.uri,
    sourceArtifactId: analysis?.sourceRhythmStructureArtifactId ?? null,
  });
  await store.writeJson(artifactPath, artifact);
  return artifact;
}

module.exports = {
  attachRhythmStructureAnalysis,
};
