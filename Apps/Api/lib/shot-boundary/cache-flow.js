const {
  findCachedArtifact: findCachedArtifactImpl,
  runCacheLookup: runCacheLookupImpl,
  resolveCachedPrompt: resolveCachedPromptImpl,
  resolveExistingFileHash: resolveExistingFileHashImpl,
  reuseCachedAnalysis: reuseCachedAnalysisImpl,
} = require("./cache");

async function runShotBoundaryCacheLookup({
  context,
  prepared,
  contactSheets,
  runStage,
  stageName,
  artifactIndex,
  cacheParams,
  splitPredecessorCacheParams,
  legacyCacheParams,
  evaluateCacheEligibility,
}) {
  const cacheContext = {
    ...context,
    roleProfile: context.reviewRoleProfile ?? context.roleProfile,
    skillHash: context.reviewSkillHash ?? context.skillHash,
  };
  return runCacheLookupImpl({
    context: cacheContext,
    prepared,
    contactSheets,
    runStage,
    stageName,
    findCached: () => findCachedArtifactImpl({
      context: cacheContext,
      prepared,
      contactSheets,
      artifactIndex,
      stageName: context.stages.resultWritten,
      cacheParams,
      compatibleCacheParams: [
        { mode: "split_predecessor", build: splitPredecessorCacheParams },
        { mode: "legacy_promptless", build: legacyCacheParams },
      ],
      evaluateCacheEligibility,
      resolveExistingFileHash: (sampleVideoId) => resolveExistingFileHashImpl(sampleVideoId, artifactIndex),
    }),
  });
}

async function reuseShotBoundaryCachedAnalysis({
  context,
  cachePrompt,
  runStage,
  stageName,
  artifactIndex,
  evaluateCacheEligibility,
  codedError,
  buildCacheReuseAnalysis,
  attachAnalysis,
  jobStore,
  sampleStatus,
}) {
  await reuseCachedAnalysisImpl({
    context,
    cachePrompt,
    runStage,
    stageName,
    resolvePrompt: () => resolveCachedPromptImpl({ cachePrompt, artifactIndex, evaluateCacheEligibility, codedError }),
    buildCacheReuseAnalysis,
    attachAnalysis,
  });
  jobStore.updateJob(context.job.jobId, {
    stage: sampleStatus.processed,
    status: sampleStatus.processed,
    progress: 100,
    cachePrompt: null,
    errorSummary: null,
    activeThreadMessage: null,
  });
}

module.exports = {
  runShotBoundaryCacheLookup,
  reuseShotBoundaryCachedAnalysis,
};
