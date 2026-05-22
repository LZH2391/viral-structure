async function findCachedArtifact({
  context,
  prepared,
  contactSheets,
  artifactIndex,
  stageName,
  cacheParams,
  evaluateCacheEligibility,
  resolveExistingFileHash,
}) {
  if (context.cacheDecision === "refresh") return null;
  const fileHash = await resolveExistingFileHash(context.sampleVideoId);
  if (!fileHash) {
    return { cache: null, analysis: null, cacheEligibility: null, summary: cacheLookupSummary(context, { cacheLookup: "miss", reason: "file_hash_missing" }) };
  }
  const params = cacheParams(prepared, contactSheets, { skillHash: context.skillHash });
  const cache = await artifactIndex.findCacheEntry({
    fileHash,
    stageName,
    params,
  });
  if (!cache?.sampleVideoId) {
    return { cache: null, analysis: null, cacheEligibility: null, summary: cacheLookupSummary(context, { cacheLookup: "miss", reason: "key_miss" }) };
  }
  const artifact = await artifactIndex.loadItem(cache.sampleVideoId);
  const analysis = artifact?.shotBoundaryAnalysis ?? null;
  const cacheEligibility = evaluateCacheEligibility(analysis);
  if (!cacheEligibility.eligible) {
    return {
      cache,
      analysis,
      cacheEligibility,
      summary: cacheLookupSummary(context, { cacheLookup: "miss", reason: "eligibility_rejected", sourceSampleVideoId: cache.sampleVideoId, cacheKey: cache.cacheKey ?? null, eligibility: cacheEligibility }),
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
      cacheKey: cache.cacheKey ?? null,
      sourceTurnId: analysis.agent?.turnId ?? null,
      boundaryCount: analysis.boundaries?.length ?? 0,
      shotCount: analysis.shots?.length ?? 0,
    }),
  };
}

async function runCacheLookup({ context, prepared, contactSheets, runStage, stageName, findCached }) {
  if (context.cacheDecision === "refresh") return null;
  const result = await runStage(context, stageName, 55, {
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId,
    inputSummary: { sampleVideoId: context.sampleVideoId, analysisFps: context.analysisFps, sheetCount: contactSheets.length, skillHash: context.skillHash },
    action: () => findCached(),
    outputSummary: (lookup) => lookup.summary,
  });
  return result.cache && result.analysis && result.cacheEligibility?.eligible ? result : null;
}

async function resolveCachedPrompt({ cachePrompt, artifactIndex, evaluateCacheEligibility, codedError }) {
  const sampleVideoId = cachePrompt?.sourceSampleVideoId ?? cachePrompt?.cachedItem?.sourceSampleVideoId ?? cachePrompt?.cachedItem?.sampleVideoId;
  if (!sampleVideoId) throw codedError("shot_cache_source_missing", "切镜缓存来源缺失，请重新分析", null, false);
  const artifact = await artifactIndex.loadItem(sampleVideoId);
  const analysis = artifact?.shotBoundaryAnalysis ?? null;
  const cacheEligibility = evaluateCacheEligibility(analysis);
  if (!cacheEligibility.eligible) throw codedError("shot_cache_not_reusable", "切镜缓存不可复用，请重新分析", { eligibility: cacheEligibility }, false);
  return {
    cache: {
      sampleVideoId,
      cacheKey: cachePrompt.cacheKey ?? null,
    },
    analysis,
    cacheEligibility,
  };
}

function markCacheWaiting({ context, cached, jobStore, sampleStatus, stageName }) {
  jobStore.updateJob(context.job.jobId, {
    status: sampleStatus.cacheWaiting,
    stage: stageName,
    progress: 55,
    cachePrompt: buildCachePrompt(context, cached),
    errorSummary: null,
  });
}

function buildCachePrompt(context, cached) {
  const item = buildCachedItem(context, cached);
  return {
    cachedItem: item,
    sourceSampleVideoId: cached.cache.sampleVideoId,
    sourceTurnId: cached.analysis.agent?.turnId ?? null,
    sourceCreatedAt: cached.analysis.createdAt ?? null,
    analysisFps: cached.analysis.analysisSampling?.fps ?? context.analysisFps,
    cacheKey: cached.cache.cacheKey ?? null,
    artifactId: context.artifactId,
    skillPath: context.skillPath,
    skillHash: context.skillHash,
  };
}

function buildCachedItem(context, cached) {
  return {
    sampleVideoId: cached.cache.sampleVideoId,
    filename: context.sampleArtifact.sampleVideo?.original?.summary ?? "样例视频",
    durationSeconds: context.sampleArtifact.metadata?.durationSeconds ?? null,
    width: context.sampleArtifact.metadata?.width ?? null,
    height: context.sampleArtifact.metadata?.height ?? null,
    updatedAt: cached.cache.updatedAt ?? null,
    tags: ["切镜"],
    cacheAvailable: true,
    traceId: cached.analysis.agent?.turnId ?? null,
    sourceSampleVideoId: cached.cache.sampleVideoId,
    sourceTurnId: cached.analysis.agent?.turnId ?? null,
    sourceCreatedAt: cached.analysis.createdAt ?? null,
    boundaryCount: cached.analysis.boundaries?.length ?? 0,
    shotCount: cached.analysis.shots?.length ?? 0,
    analysisFps: cached.analysis.analysisSampling?.fps ?? context.analysisFps,
  };
}

function cacheLookupSummary(context, details) {
  return {
    analysisFps: context.analysisFps,
    skillHash: context.skillHash,
    ...details,
  };
}

async function resolveExistingFileHash(sampleVideoId, artifactIndex) {
  const detail = await artifactIndex.getItem(sampleVideoId);
  return detail?.fileHash ?? `sampleVideoId:${sampleVideoId}`;
}

async function reuseCachedAnalysis({
  context,
  cachePrompt,
  runStage,
  stageName,
  resolvePrompt,
  buildCacheReuseAnalysis,
  attachAnalysis,
}) {
  await runStage(context, stageName, 95, {
    artifactId: context.artifactId,
    parentArtifactId: context.sampleArtifact?.sampleVideo?.artifactId ?? null,
    inputSummary: {
      sampleVideoId: context.sampleVideoId,
      sourceSampleVideoId: cachePrompt?.sourceSampleVideoId ?? cachePrompt?.cachedItem?.sourceSampleVideoId ?? cachePrompt?.cachedItem?.sampleVideoId ?? null,
      cacheKey: cachePrompt?.cacheKey ?? null,
    },
    action: async () => {
      const cached = await resolvePrompt();
      const analysis = buildCacheReuseAnalysis(cached.analysis);
      await attachAnalysis(context.sampleVideoId, analysis, {
        traceId: context.traceContext.traceId,
        sourceTraceId: context.sampleArtifact?.trace?.traceId ?? null,
      });
      return { cached, analysis };
    },
    outputSummary: ({ cached, analysis }) => ({
      sourceSampleVideoId: cached.cache.sampleVideoId,
      cacheKey: cached.cache.cacheKey,
      sourceTurnId: analysis.agent?.turnId ?? null,
      sourceCreatedAt: analysis.createdAt ?? null,
      analysisFps: analysis.analysisSampling?.fps ?? context.analysisFps,
      boundaryCount: analysis.boundaries?.length ?? 0,
      shotCount: analysis.shots?.length ?? 0,
      cacheEligibility: cached.cacheEligibility ?? null,
    }),
  });
}

module.exports = {
  findCachedArtifact,
  runCacheLookup,
  resolveCachedPrompt,
  markCacheWaiting,
  buildCachePrompt,
  cacheLookupSummary,
  resolveExistingFileHash,
  reuseCachedAnalysis,
};
