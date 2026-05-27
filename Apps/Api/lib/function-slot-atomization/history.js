const { appendAnalysisHistory } = require("../analysis-runtime-v2/analysis-history");

function appendFunctionSlotAtomizationHistory(history, analysis, traceMeta) {
  return appendAnalysisHistory(history, analysis, {
    ...traceMeta,
    sourceArtifactId: traceMeta?.sourceArtifactId ?? analysis?.sourceFunctionSlotAtomizationArtifactId ?? null,
  }, (item) => ({
    slotCount: item?.slotMap?.slots?.length ?? 0,
    scriptAtomCount: item?.atomInventory?.scriptAtoms?.length ?? 0,
    rhythmAtomCount: item?.atomInventory?.rhythmAtoms?.length ?? 0,
    packagingAtomCount: item?.atomInventory?.packagingAtoms?.length ?? 0,
    bindingCount: item?.bindingGraph?.bindings?.length ?? 0,
    boundaryReviewDecision: item?.boundaryReview?.decision ?? null,
    boundaryReviewIssueCount: item?.boundaryReview?.issues?.length ?? 0,
    boundaryReworkAttemptCount: item?.validation?.boundaryReworkAttemptCount ?? 0,
    sourceScriptSegmentArtifactId: item?.sourceScriptSegmentArtifactId ?? null,
    sourceRhythmStructureArtifactId: item?.sourceRhythmStructureArtifactId ?? null,
    sourcePackagingStructureArtifactId: item?.sourcePackagingStructureArtifactId ?? null,
  }));
}

module.exports = {
  appendFunctionSlotAtomizationHistory,
};
