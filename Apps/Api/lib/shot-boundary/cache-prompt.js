function buildCachePrompt(context, cached) {
  const item = buildCachedItem(context, cached);
  const roleProfile = resolveRoleProfile(context);
  return {
    cachedItem: item,
    sourceSampleVideoId: cached.cache.sampleVideoId,
    sourceArtifactId: cached.analysis?.artifactId ?? null,
    sourceTraceId: cached.analysis?.traceId ?? cached.analysis?.agent?.traceId ?? null,
    sourceTurnId: cached.analysis?.agent?.turnId ?? null,
    sourceCreatedAt: cached.analysis?.createdAt ?? null,
    analysisFps: cached.analysis?.analysisSampling?.fps ?? context.analysisFps,
    enableReview: context.enableReview !== false,
    reviewMode: reviewMode(context),
    cacheKey: cached.cache.cacheKey ?? null,
    artifactId: context.artifactId,
    profilePath: roleProfile?.profilePath ?? null,
    profileVersion: roleProfile?.profileVersion ?? null,
    promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
    promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
    promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
    initFingerprint: context.initFingerprint ?? null,
    skillPath: context.skillPath ?? null,
    skillHash: resolveSkillHash(context),
  };
}

function buildCachedItem(context, cached) {
  return {
    sampleVideoId: cached.cache.sampleVideoId,
    filename: context.sampleArtifact?.sampleVideo?.original?.summary ?? "样例视频",
    durationSeconds: context.sampleArtifact?.metadata?.durationSeconds ?? null,
    width: context.sampleArtifact?.metadata?.width ?? null,
    height: context.sampleArtifact?.metadata?.height ?? null,
    updatedAt: cached.cache.updatedAt ?? null,
    tags: ["切镜"],
    cacheAvailable: true,
    traceId: cached.analysis?.traceId ?? cached.analysis?.agent?.traceId ?? null,
    sourceSampleVideoId: cached.cache.sampleVideoId,
    sourceArtifactId: cached.analysis?.artifactId ?? null,
    sourceTraceId: cached.analysis?.traceId ?? cached.analysis?.agent?.traceId ?? null,
    sourceTurnId: cached.analysis?.agent?.turnId ?? null,
    sourceCreatedAt: cached.analysis?.createdAt ?? null,
    boundaryCount: cached.analysis?.boundaries?.length ?? 0,
    shotCount: cached.analysis?.shots?.length ?? 0,
    analysisFps: cached.analysis?.analysisSampling?.fps ?? context.analysisFps,
    enableReview: context.enableReview !== false,
    reviewMode: reviewMode(context),
    profileVersion: cached.analysis?.agent?.profileVersion ?? null,
    promptTemplateId: cached.analysis?.agent?.promptTemplateId ?? null,
    promptTemplateVersion: cached.analysis?.agent?.promptTemplateVersion ?? null,
  };
}

function cacheLookupSummary(context, details) {
  const roleProfile = resolveRoleProfile(context);
  return {
    analysisFps: context.analysisFps,
    skillHash: resolveSkillHash(context),
    profileVersion: roleProfile?.profileVersion ?? null,
    promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
    promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
    promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
    initFingerprint: context.initFingerprint ?? null,
    enableReview: context.enableReview !== false,
    reviewMode: reviewMode(context),
    ...details,
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

function resolveRoleProfile(context) {
  return context.reviewRoleProfile ?? context.roleProfile ?? null;
}

function resolveSkillHash(context) {
  return context.reviewSkillHash ?? context.skillHash ?? null;
}

function reviewMode(context) {
  return context?.enableReview === false ? "unreviewed" : "reviewed";
}

module.exports = {
  buildCachePrompt,
  buildCachedItem,
  cacheLookupSummary,
  markCacheWaiting,
  reviewMode,
};
