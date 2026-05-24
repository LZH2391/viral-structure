function createMaterializeRuntime({ artifactIndex, resolveExistingFileHash }) {
  async function registerSampleArtifact(context, artifact) {
    await artifactIndex.registerSampleArtifact({
      artifact,
      fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
      traceId: context.traceContext.traceId,
    });
    return artifact;
  }

  return {
    registerSampleArtifact,
  };
}

module.exports = {
  createMaterializeRuntime,
};
