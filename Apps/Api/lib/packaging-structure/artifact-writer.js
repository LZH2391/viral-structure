const { createAnalysisArtifactAttacher } = require("../analysis-runtime-v2/artifact-writer");
const { appendPackagingStructureHistory } = require("./history");

const attachPackagingStructureAnalysis = createAnalysisArtifactAttacher({
  analysisKey: "packagingStructureAnalysis",
  analysisRefKey: "packagingStructureAnalysisRef",
  historyKey: "packagingStructureAnalysisHistory",
  resultKind: "packaging_structure",
  appendHistory: appendPackagingStructureHistory,
  resolveSourceArtifactId: (analysis) => analysis?.sourcePackagingStructureArtifactId ?? null,
});

module.exports = {
  attachPackagingStructureAnalysis,
};
