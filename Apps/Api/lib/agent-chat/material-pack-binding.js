function materialPackRefFromArtifact(artifact, fallback = {}) {
  const pack = artifact?.userMaterialPack ?? null;
  const resultUri = artifact?.userMaterialPackRef?.uri ?? pack?.resultUri ?? fallback.resultUri ?? null;
  if (pack?.type !== "user-material-pack" || pack?.schemaVersion !== "user-material-pack.stable" || !resultUri) return null;
  return {
    sampleVideoId: artifact?.sampleVideoId ?? fallback.sampleVideoId ?? null,
    artifactId: pack.artifactId ?? fallback.artifactId ?? null,
    title: artifact?.sampleVideo?.original?.summary ?? fallback.title ?? null,
    traceId: pack.traceId ?? fallback.traceId ?? null,
    resultUri,
    shotCardCount: Array.isArray(pack.shotCards) ? pack.shotCards.length : fallback.shotCardCount ?? null,
    materialGroupCount: Array.isArray(pack.materialGroups) ? pack.materialGroups.length : fallback.materialGroupCount ?? null,
    proofCoverageCount: Array.isArray(pack.proofCoverage) ? pack.proofCoverage.length : fallback.proofCoverageCount ?? null,
  };
}

async function bindConversationDefaultMaterialPack({ handlers, conversationId, artifact, binding = {}, traceContext = null }) {
  if (!conversationId || !artifact || typeof handlers.agentConversationStore?.bindDefaultMaterialPack !== "function") return null;
  const materialPackRef = materialPackRefFromArtifact(artifact, binding);
  if (!materialPackRef) return null;
  return handlers.agentConversationStore.bindDefaultMaterialPack({
    conversationId,
    materialPackRef,
    binding: {
      source: binding.source ?? "material-recognition",
      workflowKey: binding.workflowKey ?? "material-recognition",
      workflowRunId: binding.workflowRunId ?? null,
      batchRunId: binding.batchRunId ?? null,
      queueItemId: binding.queueItemId ?? null,
      sampleVideoId: materialPackRef.sampleVideoId,
      traceId: traceContext?.traceId ?? binding.traceId ?? materialPackRef.traceId ?? null,
      runId: traceContext?.runId ?? binding.runId ?? null,
      stageId: traceContext?.stageId ?? binding.stageId ?? null,
    },
    traceId: traceContext?.traceId ?? binding.traceId ?? null,
    runId: traceContext?.runId ?? binding.runId ?? null,
    stageId: traceContext?.stageId ?? binding.stageId ?? null,
  });
}

module.exports = {
  bindConversationDefaultMaterialPack,
  materialPackRefFromArtifact,
};
