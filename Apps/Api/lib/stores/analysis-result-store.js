const path = require("path");
const { randomUUID } = require("crypto");

const RESULT_KIND_TO_ARTIFACT_TYPE = {
  script_segment: "script-segment-analysis",
  rhythm_structure: "rhythm-structure-analysis",
  packaging_structure: "packaging-structure-analysis",
};

async function writeAnalysisResult({ store, sampleVideoId, kind, analysis }) {
  const artifactId = analysis?.artifactId ?? `artifact_${randomUUID()}`;
  const artifactType = analysis?.type ?? RESULT_KIND_TO_ARTIFACT_TYPE[kind] ?? String(kind ?? "analysis");
  const resultDir = path.join(store.sampleDir(sampleVideoId), "analysis-results", String(kind));
  const resultPath = path.join(resultDir, `${artifactId}.json`);
  await store.writeJson(resultPath, analysis);
  return {
    artifactId,
    artifactType,
    uri: store.runtimeUri(resultPath),
    current: true,
    createdAt: analysis?.createdAt ?? new Date().toISOString(),
    parentArtifactId: analysis?.parentArtifactId ?? null,
  };
}

module.exports = {
  writeAnalysisResult,
};
