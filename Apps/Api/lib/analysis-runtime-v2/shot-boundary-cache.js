const {
  buildUnifiedCachePrompt,
  readCacheDependency,
  resolveCacheSourceSampleVideoId,
} = require("./cache-runtime");

function createShotBoundaryDependentCacheHandlers({
  cacheKind,
  cacheTag,
  buildCacheParams,
  selectAnalysis,
  buildCounts,
  buildInputSummaryExtra = () => ({}),
  missingSourceCode,
  missingSourceMessage,
  notReusableCode,
  notReusableMessage,
}) {
  async function findCachedArtifact({
    context,
    input,
    artifactIndex,
    stageName,
    evaluateCacheEligibility,
    resolveExistingFileHash,
  }) {
    if (context.cacheDecision === "refresh") return null;
    const fileHash = await resolveExistingFileHash(context.sampleVideoId);
    if (!fileHash) {
      return { cache: null, analysis: null, cacheEligibility: null, summary: cacheLookupSummary(context, { cacheLookup: "miss", reason: "file_hash_missing" }) };
    }
    const params = buildCacheParams({
      inputFingerprint: context.cacheKey,
      sourceShotArtifactId: input?.parentArtifactId ?? null,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
      skillHash: context.skillHash ?? null,
    });
    const cache = await artifactIndex.findCacheEntry({
      fileHash,
      stageName,
      params,
    });
    if (!cache?.sampleVideoId) {
      return { cache: null, analysis: null, cacheEligibility: null, summary: cacheLookupSummary(context, { cacheLookup: "miss", reason: "key_miss" }) };
    }
    const artifact = await artifactIndex.loadItem(cache.sampleVideoId);
    const analysis = selectAnalysis(artifact);
    const cacheEligibility = evaluateCacheEligibility(analysis, { cacheKey: context.cacheKey });
    if (!cacheEligibility.eligible) {
      return {
        cache,
        analysis,
        cacheEligibility,
        summary: cacheLookupSummary(context, {
          cacheLookup: "miss",
          reason: "eligibility_rejected",
          sourceSampleVideoId: cache.sampleVideoId,
          cacheKey: cache.cacheKey ?? context.cacheKey ?? null,
          eligibility: cacheEligibility,
        }),
      };
    }
    return {
      cache,
      analysis,
      cacheEligibility,
      summary: cacheLookupSummary(context, {
        cacheLookup: "hit",
        reason: "eligible",
        sourceSampleVideoId: cache.sampleVideoId,
        cacheKey: cache.cacheKey ?? context.cacheKey ?? null,
        sourceTurnId: analysis?.agent?.turnId ?? null,
        sourceTraceId: analysis?.traceId ?? analysis?.agent?.traceId ?? null,
        ...buildCounts(analysis),
      }),
    };
  }

  async function runCacheLookup({ context, input, runStage, stageName, findCached }) {
    if (context.cacheDecision === "refresh") return null;
    const result = await runStage(context, stageName, 28, {
      artifactId: context.artifactId,
      parentArtifactId: input.parentArtifactId,
      inputSummary: {
        sampleVideoId: context.sampleVideoId,
        sourceShotBoundaryArtifactId: input.parentArtifactId,
        shotCount: input.shots.length,
        ...buildInputSummaryExtra(context, input),
        cacheKey: context.cacheKey ?? null,
        skillHash: context.skillHash ?? null,
        profileVersion: context.roleProfile?.profileVersion ?? null,
        promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
        promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
        promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
      },
      action: () => findCached(),
      outputSummary: (lookup) => lookup.summary,
    });
    return result?.cache && result?.analysis && result?.cacheEligibility?.eligible ? result : null;
  }

  async function resolveCachedPrompt({ cachePrompt, artifactIndex, evaluateCacheEligibility, codedError, expectedCacheKey }) {
    const sampleVideoId = resolveCacheSourceSampleVideoId(cachePrompt);
    if (!sampleVideoId) throw codedError(missingSourceCode, missingSourceMessage, null, false);
    const artifact = await artifactIndex.loadItem(sampleVideoId);
    const analysis = selectAnalysis(artifact);
    const cacheEligibility = evaluateCacheEligibility(analysis, { cacheKey: expectedCacheKey ?? null });
    if (!cacheEligibility.eligible) {
      throw codedError(notReusableCode, notReusableMessage, { eligibility: cacheEligibility }, false);
    }
    return {
      cache: {
        sampleVideoId,
        cacheKey: cachePrompt?.cacheKey ?? expectedCacheKey ?? null,
      },
      analysis,
      cacheEligibility,
    };
  }

  function markCacheWaiting({ context, cached, jobStore, sampleStatus, stageName }) {
    jobStore.updateJob(context.job.jobId, {
      status: sampleStatus.cacheWaiting,
      stage: stageName,
      progress: 28,
      cachePrompt: buildCachePrompt(context, cached),
      errorSummary: null,
    });
  }

  function buildCachePrompt(context, cached) {
    const item = buildCachedItem(context, cached);
    const expectedShotBoundaryArtifactId = context.input?.parentArtifactId ?? context.expectedShotBoundaryArtifactId ?? null;
    return buildUnifiedCachePrompt({
      cacheKind,
      cachedItem: item,
      sourceSampleVideoId: cached.cache.sampleVideoId,
      sourceArtifactId: cached.analysis?.artifactId ?? null,
      sourceTurnId: cached.analysis?.agent?.turnId ?? null,
      sourceTraceId: cached.analysis?.traceId ?? cached.analysis?.agent?.traceId ?? null,
      sourceCreatedAt: cached.analysis?.createdAt ?? null,
      cacheKey: context.cacheKey ?? cached.cache.cacheKey ?? null,
      artifactId: context.artifactId,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
      skillPath: context.skillPath ?? null,
      skillHash: context.skillHash ?? null,
      dependencies: {
        shotBoundaryArtifactId: expectedShotBoundaryArtifactId,
      },
      legacy: {
        expectedShotBoundaryArtifactId,
      },
    });
  }

  function buildCachedItem(context, cached) {
    return {
      sampleVideoId: cached.cache.sampleVideoId,
      filename: context.artifact.sampleVideo?.original?.summary ?? "样例视频",
      durationSeconds: context.artifact.metadata?.durationSeconds ?? null,
      width: context.artifact.metadata?.width ?? null,
      height: context.artifact.metadata?.height ?? null,
      updatedAt: cached.cache.updatedAt ?? null,
      tags: [cacheTag],
      cacheAvailable: true,
      cacheKind,
      traceId: cached.analysis?.traceId ?? cached.analysis?.agent?.traceId ?? null,
      sourceSampleVideoId: cached.cache.sampleVideoId,
      sourceArtifactId: cached.analysis?.artifactId ?? null,
      sourceTraceId: cached.analysis?.traceId ?? cached.analysis?.agent?.traceId ?? null,
      sourceTurnId: cached.analysis?.agent?.turnId ?? null,
      sourceCreatedAt: cached.analysis?.createdAt ?? null,
      cacheKey: context.cacheKey ?? cached.cache.cacheKey ?? null,
      ...buildCounts(cached.analysis),
      profileVersion: cached.analysis?.agent?.profileVersion ?? null,
      promptTemplateId: cached.analysis?.agent?.promptTemplateId ?? null,
      promptTemplateVersion: cached.analysis?.agent?.promptTemplateVersion ?? null,
    };
  }

  function cacheLookupSummary(context, details) {
    return {
      cacheKey: context.cacheKey ?? null,
      skillHash: context.skillHash ?? null,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
      ...details,
    };
  }

  async function reuseCachedAnalysis({
    context,
    cachePrompt,
    runStage,
    stageName,
    resolvePrompt,
    buildCacheReuseAnalysis,
    attachAnalysis,
    registerArtifact,
  }) {
    return runStage(context, stageName, 92, {
      artifactId: context.artifactId,
      parentArtifactId: context.input?.parentArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? null,
      inputSummary: {
        sampleVideoId: context.sampleVideoId,
        sourceSampleVideoId: cachePrompt?.sourceSampleVideoId ?? cachePrompt?.cachedItem?.sourceSampleVideoId ?? cachePrompt?.cachedItem?.sampleVideoId ?? null,
        sourceShotBoundaryArtifactId: context.input?.parentArtifactId
          ?? readCacheDependency(cachePrompt, "shotBoundaryArtifactId", "expectedShotBoundaryArtifactId")
          ?? context.artifact?.shotBoundaryAnalysis?.artifactId
          ?? null,
        cacheKey: context.cacheKey ?? cachePrompt?.cacheKey ?? null,
        promptTemplateVersion: cachePrompt?.promptTemplateVersion ?? null,
      },
      action: async () => {
        const cached = await resolvePrompt();
        const analysis = buildCacheReuseAnalysis({
          cachedAnalysis: cached.analysis,
          context,
        });
        const artifact = await attachAnalysis(context.sampleVideoId, analysis, {
          traceId: context.traceContext.traceId,
          sourceTraceId: context.artifact?.trace?.traceId ?? null,
        });
        await registerArtifact?.(artifact);
        return { cached, analysis, artifact };
      },
      outputSummary: ({ cached, analysis }) => ({
        sourceSampleVideoId: cached.cache.sampleVideoId,
        cacheKey: analysis.cacheKey ?? cached.cache.cacheKey ?? null,
        sourceTurnId: analysis.sourceTurnId ?? analysis.agent?.turnId ?? null,
        sourceCreatedAt: analysis.sourceCreatedAt ?? null,
        ...buildCounts(analysis),
        cacheEligibility: cached.cacheEligibility ?? null,
      }),
    });
  }

  return {
    findCachedArtifact,
    runCacheLookup,
    resolveCachedPrompt,
    markCacheWaiting,
    buildCachePrompt,
    cacheLookupSummary,
    reuseCachedAnalysis,
  };
}

module.exports = {
  createShotBoundaryDependentCacheHandlers,
};
