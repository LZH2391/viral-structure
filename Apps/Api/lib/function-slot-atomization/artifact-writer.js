const { createAnalysisArtifactAttacher } = require("../analysis-runtime-v2/artifact-writer");
const { appendFunctionSlotAtomizationHistory } = require("./history");

const attachFunctionSlotAtomizationAnalysis = createAnalysisArtifactAttacher({
  analysisKey: "functionSlotAtomizationAnalysis",
  analysisRefKey: "functionSlotAtomizationAnalysisRef",
  historyKey: "functionSlotAtomizationAnalysisHistory",
  resultKind: "function_slot_atomization",
  appendHistory: appendFunctionSlotAtomizationHistory,
  resolveSourceArtifactId: (analysis) => analysis?.sourceFunctionSlotAtomizationArtifactId ?? null,
});

module.exports = {
  attachFunctionSlotAtomizationAnalysis,
};
