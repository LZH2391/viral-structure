const { buildShotBoundaryCacheParams } = require("./shot-boundary-analysis");
const { buildScriptSegmentCacheParams } = require("./script-segment-analysis/cache-params");
const { buildRhythmStructureCacheParams } = require("./rhythm-structure-analysis/cache-params");
const { buildPackagingStructureCacheParams } = require("./packaging-structure-analysis/cache-params");

function createArtifactCacheParamBuilders() {
  return {
    "shot.boundary_merge": buildShotBoundaryStageParams,
    "agent.shotBoundary.resultWritten": buildShotBoundaryStageParams,
    "script_segment.materialize": buildScriptSegmentStageParams,
    "rhythm_structure.materialize": buildRhythmStructureStageParams,
    "packaging_structure.materialize": buildPackagingStructureStageParams,
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

function buildScriptSegmentStageParams(artifact) {
  return buildScriptSegmentCacheParams({
    inputFingerprint: artifact?.scriptSegmentAnalysis?.cacheKey ?? null,
    sourceShotArtifactId: artifact?.scriptSegmentAnalysis?.sourceShotBoundaryArtifactId ?? null,
    profileVersion: artifact?.scriptSegmentAnalysis?.agent?.profileVersion ?? null,
    promptTemplateId: artifact?.scriptSegmentAnalysis?.agent?.promptTemplateId ?? null,
    promptTemplateVersion: artifact?.scriptSegmentAnalysis?.agent?.promptTemplateVersion ?? null,
    promptTemplateHash: artifact?.scriptSegmentAnalysis?.agent?.promptTemplateHash ?? null,
    skillHash: artifact?.scriptSegmentAnalysis?.agent?.skillHash ?? null,
  });
}

function buildRhythmStructureStageParams(artifact) {
  return buildRhythmStructureCacheParams({
    inputFingerprint: artifact?.rhythmStructureAnalysis?.cacheKey ?? null,
    sourceShotArtifactId: artifact?.rhythmStructureAnalysis?.sourceShotBoundaryArtifactId ?? null,
    profileVersion: artifact?.rhythmStructureAnalysis?.agent?.profileVersion ?? null,
    promptTemplateId: artifact?.rhythmStructureAnalysis?.agent?.promptTemplateId ?? null,
    promptTemplateVersion: artifact?.rhythmStructureAnalysis?.agent?.promptTemplateVersion ?? null,
    promptTemplateHash: artifact?.rhythmStructureAnalysis?.agent?.promptTemplateHash ?? null,
    skillHash: artifact?.rhythmStructureAnalysis?.agent?.skillHash ?? null,
  });
}

function buildPackagingStructureStageParams(artifact) {
  return buildPackagingStructureCacheParams({
    inputFingerprint: artifact?.packagingStructureAnalysis?.cacheKey ?? null,
    sourceShotArtifactId: artifact?.packagingStructureAnalysis?.sourceShotBoundaryArtifactId ?? null,
    profileVersion: artifact?.packagingStructureAnalysis?.agent?.profileVersion ?? null,
    promptTemplateId: artifact?.packagingStructureAnalysis?.agent?.promptTemplateId ?? null,
    promptTemplateVersion: artifact?.packagingStructureAnalysis?.agent?.promptTemplateVersion ?? null,
    promptTemplateHash: artifact?.packagingStructureAnalysis?.agent?.promptTemplateHash ?? null,
    skillHash: artifact?.packagingStructureAnalysis?.agent?.skillHash ?? null,
  });
}

module.exports = {
  createArtifactCacheParamBuilders,
};
