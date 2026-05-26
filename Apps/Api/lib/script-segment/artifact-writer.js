const { createAnalysisArtifactAttacher } = require("../analysis-runtime-v2/artifact-writer");
const { appendScriptSegmentHistory } = require("./history");

const attachScriptSegmentAnalysis = createAnalysisArtifactAttacher({
  analysisKey: "scriptSegmentAnalysis",
  analysisRefKey: "scriptSegmentAnalysisRef",
  historyKey: "scriptSegmentAnalysisHistory",
  resultKind: "script_segment",
  appendHistory: appendScriptSegmentHistory,
  resolveSourceArtifactId: (analysis) => analysis?.sourceScriptSegmentArtifactId ?? null,
});

module.exports = {
  attachScriptSegmentAnalysis,
};
