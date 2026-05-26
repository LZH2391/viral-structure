const path = require("path");
const { writeAnalysisResult } = require("../stores/analysis-result-store");
const { appendFunctionSlotAtomizationHistory } = require("./history");

async function attachFunctionSlotAtomizationAnalysis(sampleVideoId, analysis, store, traceMeta = {}) {
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  const artifact = await store.readJson(artifactPath);
  const resultRef = await writeAnalysisResult({ store, sampleVideoId, kind: "function_slot_atomization", analysis });
  artifact.functionSlotAtomizationAnalysis = analysis;
  artifact.functionSlotAtomizationAnalysisRef = resultRef;
  artifact.functionSlotAtomizationAnalysisHistory = appendFunctionSlotAtomizationHistory(artifact.functionSlotAtomizationAnalysisHistory, analysis, {
    traceId: analysis?.traceId ?? traceMeta.traceId ?? artifact?.trace?.traceId ?? null,
    sourceTraceId: traceMeta.sourceTraceId ?? artifact?.trace?.traceId ?? null,
    resultUri: resultRef.uri,
    sourceArtifactId: analysis?.sourceFunctionSlotAtomizationArtifactId ?? null,
  });
  await store.writeJson(artifactPath, artifact);
  return artifact;
}

module.exports = {
  attachFunctionSlotAtomizationAnalysis,
};
