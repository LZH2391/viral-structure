const { MODULE_ARTIFACTS } = require("../module-artifact-catalog");

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
  const module = MODULE_ARTIFACTS.find((entry) => entry.cacheKind === cacheKind);
  if (module?.getArtifact) return module.getArtifact(artifact);
  for (const entry of MODULE_ARTIFACTS) {
    const analysis = entry.getArtifact?.(artifact);
    if (analysis) return analysis;
  }
  return null;
}

module.exports = {
  createMaterializeRuntime,
};
