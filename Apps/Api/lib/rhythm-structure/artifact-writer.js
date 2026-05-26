const { createAnalysisArtifactAttacher } = require("../analysis-runtime-v2/artifact-writer");
const { appendRhythmStructureHistory } = require("./history");

const attachRhythmStructureAnalysis = createAnalysisArtifactAttacher({
  analysisKey: "rhythmStructureAnalysis",
  analysisRefKey: "rhythmStructureAnalysisRef",
  historyKey: "rhythmStructureAnalysisHistory",
  resultKind: "rhythm_structure",
  appendHistory: appendRhythmStructureHistory,
  resolveSourceArtifactId: (analysis) => analysis?.sourceRhythmStructureArtifactId ?? null,
});

module.exports = {
  attachRhythmStructureAnalysis,
};
