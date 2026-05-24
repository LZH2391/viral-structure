async function findCachedArtifact({
  context,
  prepared,
  contactSheets,
  artifactIndex,
  stageName,
  cacheParams,
  compatibleCacheParams = [],
  evaluateCacheEligibility,
  resolveExistingFileHash,
}) {
  if (context.cacheDecision === "refresh") return null;
  const fileHash = await resolveExistingFileHash(context.sampleVideoId);
  if (!fileHash) {
    return { cache: null, analysis: null, cacheEligibility: null, summary: cacheLookupSummary(context, { cacheLookup: "miss", reason: "file_hash_missing" }) };
  }
  const params = cacheParams(prepared, contactSheets, {
    skillHash: context.skillHash,
    profileVersion: context.roleProfile?.profileVersion,
    promptTemplateId: context.promptTemplate?.promptTemplateId,
    promptTemplateVersion: context.promptTemplate?.promptTemplateVersion,
    promptTemplateHash: context.promptTemplate?.promptTemplateHash,
    initFingerprint: context.initFingerprint,
    reviewMode: reviewMode(context),
  });
  let cache = await artifactIndex.findCacheEntry({
    fileHash,
    stageName,
    params,
  });
  let cacheLookupMode = "current";
  const compatibleOptions = {
    skillHash: context.skillHash,
    profileVersion: context.roleProfile?.profileVersion,
    promptTemplateId: context.promptTemplate?.promptTemplateId,
    promptTemplateVersion: context.promptTemplate?.promptTemplateVersion,
    promptTemplateHash: context.promptTemplate?.promptTemplateHash,
    initFingerprint: context.initFingerprint,
    reviewMode: reviewMode(context),
  };
  for (const compatible of compatibleCacheParams) {
    if (cache?.sampleVideoId || typeof compatible?.build !== "function") break;
    const fallbackParams = compatible.build(prepared, contactSheets, compatibleOptions);
    if (!fallbackParams) continue;
    cache = await artifactIndex.findCacheEntry({
      fileHash,
      stageName,
      params: fallbackParams,
    });
    cacheLookupMode = cache?.sampleVideoId ? compatible.mode : "current";
  }
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
      cacheLookupMode,
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
    inputSummary: {
      sampleVideoId: context.sampleVideoId,
      analysisFps: context.analysisFps,
      sheetCount: contactSheets.length,
      skillHash: context.skillHash,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
      initFingerprint: context.initFingerprint ?? null,
      reviewMode: reviewMode(context),
    },
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
    sourceArtifactId: cached.analysis?.artifactId ?? null,
    sourceTraceId: cached.analysis?.traceId ?? cached.analysis?.agent?.traceId ?? null,
    sourceTurnId: cached.analysis.agent?.turnId ?? null,
    sourceCreatedAt: cached.analysis.createdAt ?? null,
    analysisFps: cached.analysis.analysisSampling?.fps ?? context.analysisFps,
    enableReview: context.enableReview !== false,
    reviewMode: reviewMode(context),
    cacheKey: cached.cache.cacheKey ?? null,
    artifactId: context.artifactId,
    profilePath: context.roleProfile?.profilePath ?? null,
    profileVersion: context.roleProfile?.profileVersion ?? null,
    promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
    promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
    promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
    initFingerprint: context.initFingerprint ?? null,
    skillPath: context.skillPath,
    skillHash: context.skillHash,
    enableReview: context.enableReview !== false,
    reviewMode: reviewMode(context),
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
    traceId: cached.analysis?.traceId ?? cached.analysis?.agent?.traceId ?? null,
    sourceSampleVideoId: cached.cache.sampleVideoId,
    sourceArtifactId: cached.analysis?.artifactId ?? null,
    sourceTraceId: cached.analysis?.traceId ?? cached.analysis?.agent?.traceId ?? null,
    sourceTurnId: cached.analysis.agent?.turnId ?? null,
    sourceCreatedAt: cached.analysis.createdAt ?? null,
    boundaryCount: cached.analysis.boundaries?.length ?? 0,
    shotCount: cached.analysis.shots?.length ?? 0,
    analysisFps: cached.analysis.analysisSampling?.fps ?? context.analysisFps,
    enableReview: context.enableReview !== false,
    reviewMode: reviewMode(context),
    profileVersion: cached.analysis.agent?.profileVersion ?? null,
    promptTemplateId: cached.analysis.agent?.promptTemplateId ?? null,
    promptTemplateVersion: cached.analysis.agent?.promptTemplateVersion ?? null,
  };
}

function cacheLookupSummary(context, details) {
  return {
    analysisFps: context.analysisFps,
    skillHash: context.skillHash,
    profileVersion: context.roleProfile?.profileVersion ?? null,
    promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
    promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
    promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
    initFingerprint: context.initFingerprint ?? null,
    enableReview: context.enableReview !== false,
    reviewMode: reviewMode(context),
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
      profileVersion: cachePrompt?.profileVersion ?? null,
      promptTemplateId: cachePrompt?.promptTemplateId ?? null,
      promptTemplateVersion: cachePrompt?.promptTemplateVersion ?? null,
      reviewMode: cachePrompt?.reviewMode ?? null,
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

function reviewMode(context) {
  return context?.enableReview === false ? "unreviewed" : "reviewed";
}
