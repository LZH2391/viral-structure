function createMaterializeRuntime({ artifactIndex, resolveExistingFileHash, finalOutputStore = null }) {
  async function registerSampleArtifact(context, artifact) {
    await artifactIndex.registerSampleArtifact({
      artifact,
      fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
      traceId: context.traceContext.traceId,
    });
    await writeLatestFinalOutput(context, artifact);
    return artifact;
  }

  async function writeLatestFinalOutput(context, artifact) {
    if (!finalOutputStore?.writeFinalOutput) return null;
    const analysis = latestAnalysisFromArtifact(artifact, context.cacheKind);
    if (!analysis) return null;
    return finalOutputStore.writeFinalOutput({
      sampleVideoId: context.sampleVideoId,
      analysis,
      finalOutputText: context.finalOutputText ?? null,
      traceId: context.traceContext?.traceId ?? null,
      stageName: context.activeStage?.stageName ?? analysis?.stageName ?? null,
    });
  }

  return {
    registerSampleArtifact,
  };
}

function latestAnalysisFromArtifact(artifact, cacheKind) {
  if (cacheKind === "script_segment") return artifact?.scriptSegmentAnalysis ?? null;
  if (cacheKind === "rhythm_structure") return artifact?.rhythmStructureAnalysis ?? null;
  if (cacheKind === "packaging_structure") return artifact?.packagingStructureAnalysis ?? null;
  return artifact?.scriptSegmentAnalysis
    ?? artifact?.rhythmStructureAnalysis
    ?? artifact?.packagingStructureAnalysis
    ?? null;
}

module.exports = {
  createMaterializeRuntime,
};
