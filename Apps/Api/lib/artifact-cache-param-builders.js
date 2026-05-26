const { buildShotBoundaryCacheParams } = require("./shot-boundary-analysis");
const { MODULE_DEFINITIONS } = require("./module-catalog");

function createArtifactCacheParamBuilders() {
  return {
    "shot.boundary_merge": buildShotBoundaryStageParams,
    "agent.shotBoundary.resultWritten": buildShotBoundaryStageParams,
    ...Object.fromEntries(MODULE_DEFINITIONS.flatMap((module) => {
      if (!module.stages?.materialized || typeof module.buildCacheParams !== "function") return [];
      return [[module.stages.materialized, module.buildCacheParams]];
    })),
  };
}

function buildShotBoundaryStageParams(artifact) {
  return buildShotBoundaryCacheParams({
    sourceArtifactId: artifact?.shotBoundaryAnalysis?.parentArtifactId ?? artifact?.sampleVideo?.artifactId ?? null,
    extractSampling: artifact?.shotBoundaryAnalysis?.extractSampling ?? null,
    analysisSampling: artifact?.shotBoundaryAnalysis?.analysisSampling ?? null,
    frameDimensions: {
      width: artifact?.metadata?.width ?? null,
      height: artifact?.metadata?.height ?? null,
    },
    contactSheets: artifact?.shotBoundaryAnalysis?.contactSheets ?? null,
    subtitleContextSummary: artifact?.shotBoundaryAnalysis?.subtitleContextSummary ?? null,
    profileVersion: artifact?.shotBoundaryAnalysis?.agent?.profileVersion ?? null,
    promptTemplateId: artifact?.shotBoundaryAnalysis?.agent?.promptTemplateId ?? null,
    promptTemplateVersion: artifact?.shotBoundaryAnalysis?.agent?.promptTemplateVersion ?? null,
    promptTemplateHash: artifact?.shotBoundaryAnalysis?.agent?.promptTemplateHash ?? null,
    initFingerprint: artifact?.shotBoundaryAnalysis?.agent?.initFingerprint ?? null,
    reviewMode: artifact?.shotBoundaryAnalysis?.agent?.reviewMode ?? (artifact?.shotBoundaryAnalysis?.agent?.enableReview === false ? "unreviewed" : "reviewed"),
    skillHash: artifact?.shotBoundaryAnalysis?.agent?.skillHash ?? null,
  });
}

module.exports = {
  createArtifactCacheParamBuilders,
};
