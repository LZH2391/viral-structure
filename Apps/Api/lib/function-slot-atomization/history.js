function appendFunctionSlotAtomizationHistory(history, analysis, traceMeta) {
  const entries = Array.isArray(history) ? history : [];
  const next = {
    artifactId: analysis?.artifactId ?? null,
    status: analysis?.status ?? "failed",
    resultOrigin: analysis?.resultOrigin ?? "new_turn",
    slotCount: analysis?.slotMap?.slots?.length ?? 0,
    scriptAtomCount: analysis?.atomInventory?.scriptAtoms?.length ?? 0,
    rhythmAtomCount: analysis?.atomInventory?.rhythmAtoms?.length ?? 0,
    packagingAtomCount: analysis?.atomInventory?.packagingAtoms?.length ?? 0,
    bindingCount: analysis?.bindingGraph?.bindings?.length ?? 0,
    turnId: analysis?.agent?.turnId ?? null,
    traceId: traceMeta?.traceId ?? null,
    sourceTraceId: traceMeta?.sourceTraceId ?? null,
    sourceSampleVideoId: analysis?.sourceSampleVideoId ?? null,
    sourceArtifactId: traceMeta?.sourceArtifactId ?? analysis?.sourceFunctionSlotAtomizationArtifactId ?? null,
    sourceScriptSegmentArtifactId: analysis?.sourceScriptSegmentArtifactId ?? null,
    sourceRhythmStructureArtifactId: analysis?.sourceRhythmStructureArtifactId ?? null,
    sourcePackagingStructureArtifactId: analysis?.sourcePackagingStructureArtifactId ?? null,
    sourceTurnId: analysis?.sourceTurnId ?? null,
    cacheKey: analysis?.cacheKey ?? null,
    resultUri: traceMeta?.resultUri ?? null,
    createdAt: analysis?.createdAt ?? new Date().toISOString(),
    validatorCode: analysis?.validation?.validatorCode ?? null,
  };
  return [...entries, next];
}

module.exports = {
  appendFunctionSlotAtomizationHistory,
};
