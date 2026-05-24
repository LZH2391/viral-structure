const path = require("path");
const { writeAnalysisResult } = require("../analysis-result-store");
const { appendScriptSegmentHistory } = require("./history");

async function attachScriptSegmentAnalysis(sampleVideoId, analysis, store, traceMeta = {}) {
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  const artifact = await store.readJson(artifactPath);
  const resultRef = await writeAnalysisResult({ store, sampleVideoId, kind: "script_segment", analysis });
  artifact.scriptSegmentAnalysis = analysis;
  artifact.scriptSegmentAnalysisRef = resultRef;
  artifact.scriptSegmentAnalysisHistory = appendScriptSegmentHistory(artifact.scriptSegmentAnalysisHistory, analysis, {
    traceId: analysis?.traceId ?? traceMeta.traceId ?? artifact?.trace?.traceId ?? null,
    sourceTraceId: traceMeta.sourceTraceId ?? artifact?.trace?.traceId ?? null,
    resultUri: resultRef.uri,
    sourceArtifactId: analysis?.sourceScriptSegmentArtifactId ?? null,
  });
  await store.writeJson(artifactPath, artifact);
  return artifact;
}

module.exports = {
  attachScriptSegmentAnalysis,
};
