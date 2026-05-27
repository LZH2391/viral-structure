const {
  buildUnifiedCachePrompt,
  readCacheDependency,
  resolveCacheSourceSampleVideoId,
} = require("../analysis-runtime-v2/cache-runtime");
const { buildFunctionSlotAtomizationCacheParams } = require("../function-slot-atomization-analysis/cache-params");

const CACHE_KIND = "function_slot_atomization";

async function runCacheLookup({ context, input, runStage, stageName, findCached }) {
  if (context.cacheDecision === "refresh") return null;
  const result = await runStage(context, stageName, 32, {
    artifactId: context.artifactId,
    parentArtifactId: input.parentArtifactId,
    inputSummary: {
      sampleVideoId: context.sampleVideoId,
      sourceScriptSegmentArtifactId: input.sourceScriptSegmentArtifactId,
      sourceRhythmStructureArtifactId: input.sourceRhythmStructureArtifactId,
      sourcePackagingStructureArtifactId: input.sourcePackagingStructureArtifactId,
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
  const params = buildFunctionSlotAtomizationCacheParams({
    inputFingerprint: context.cacheKey,
    sourceScriptSegmentArtifactId: input?.sourceScriptSegmentArtifactId ?? null,
    sourceRhythmStructureArtifactId: input?.sourceRhythmStructureArtifactId ?? null,
    sourcePackagingStructureArtifactId: input?.sourcePackagingStructureArtifactId ?? null,
    profileVersion: context.roleProfile?.profileVersion ?? null,
    promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
    promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
    promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
    skillHash: context.skillHash ?? null,
  });
  const cache = await artifactIndex.findCacheEntry({ fileHash, stageName, params });
  if (!cache?.sampleVideoId) {
    return { cache: null, analysis: null, cacheEligibility: null, summary: cacheLookupSummary(context, { cacheLookup: "miss", reason: "key_miss" }) };
  }
  const artifact = await artifactIndex.loadItem(cache.sampleVideoId);
  const analysis = artifact?.functionSlotAtomizationAnalysis ?? null;
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
      slotCount: analysis?.slotMap?.slots?.length ?? 0,
    }),
  };
}

function markCacheWaiting({ context, cached, jobStore, sampleStatus, stageName }) {
  jobStore.updateJob(context.job.jobId, {
    status: sampleStatus.cacheWaiting,
    stage: stageName,
    progress: 32,
    cachePrompt: buildCachePrompt(context, cached),
    errorSummary: null,
  });
}

function buildCachePrompt(context, cached) {
  return buildUnifiedCachePrompt({
    cacheKind: CACHE_KIND,
    cachedItem: buildCachedItem(context, cached),
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
      scriptSegmentArtifactId: context.input?.sourceScriptSegmentArtifactId ?? context.expectedScriptSegmentArtifactId ?? null,
      rhythmStructureArtifactId: context.input?.sourceRhythmStructureArtifactId ?? context.expectedRhythmStructureArtifactId ?? null,
      packagingStructureArtifactId: context.input?.sourcePackagingStructureArtifactId ?? context.expectedPackagingStructureArtifactId ?? null,
    },
    legacy: {
      expectedScriptSegmentArtifactId: context.input?.sourceScriptSegmentArtifactId ?? context.expectedScriptSegmentArtifactId ?? null,
      expectedRhythmStructureArtifactId: context.input?.sourceRhythmStructureArtifactId ?? context.expectedRhythmStructureArtifactId ?? null,
      expectedPackagingStructureArtifactId: context.input?.sourcePackagingStructureArtifactId ?? context.expectedPackagingStructureArtifactId ?? null,
    },
  });
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
    parentArtifactId: context.input?.parentArtifactId ?? context.artifact?.packagingStructureAnalysis?.artifactId ?? null,
    inputSummary: {
      sampleVideoId: context.sampleVideoId,
      sourceSampleVideoId: cachePrompt?.sourceSampleVideoId ?? cachePrompt?.cachedItem?.sourceSampleVideoId ?? cachePrompt?.cachedItem?.sampleVideoId ?? null,
      sourceScriptSegmentArtifactId: context.input?.sourceScriptSegmentArtifactId ?? readCacheDependency(cachePrompt, "scriptSegmentArtifactId", "expectedScriptSegmentArtifactId") ?? null,
      sourceRhythmStructureArtifactId: context.input?.sourceRhythmStructureArtifactId ?? readCacheDependency(cachePrompt, "rhythmStructureArtifactId", "expectedRhythmStructureArtifactId") ?? null,
      sourcePackagingStructureArtifactId: context.input?.sourcePackagingStructureArtifactId ?? readCacheDependency(cachePrompt, "packagingStructureArtifactId", "expectedPackagingStructureArtifactId") ?? null,
      cacheKey: context.cacheKey ?? cachePrompt?.cacheKey ?? null,
      promptTemplateVersion: cachePrompt?.promptTemplateVersion ?? null,
    },
    action: async () => {
      const cached = await resolvePrompt();
      const analysis = buildCacheReuseAnalysis({ cachedAnalysis: cached.analysis, context });
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
      slotCount: analysis?.slotMap?.slots?.length ?? 0,
      cacheEligibility: cached.cacheEligibility ?? null,
    }),
  });
}

async function resolveCachedPrompt({ cachePrompt, artifactIndex, evaluateCacheEligibility, codedError, expectedCacheKey }) {
  const sampleVideoId = resolveCacheSourceSampleVideoId(cachePrompt);
  if (!sampleVideoId) throw codedError("function_slot_atomization_cache_source_missing", "原子化缓存来源缺失，请重新生成", null, false);
  const artifact = await artifactIndex.loadItem(sampleVideoId);
  const analysis = artifact?.functionSlotAtomizationAnalysis ?? null;
  const cacheEligibility = evaluateCacheEligibility(analysis, { cacheKey: expectedCacheKey ?? null });
  if (!cacheEligibility.eligible) {
    throw codedError("function_slot_atomization_cache_not_reusable", "原子化缓存不可复用，请重新生成", { eligibility: cacheEligibility }, false);
  }
  return { cache: { sampleVideoId, cacheKey: cachePrompt?.cacheKey ?? expectedCacheKey ?? null }, analysis, cacheEligibility };
}

function buildCachedItem(context, cached) {
  return {
    sampleVideoId: cached.cache.sampleVideoId,
    filename: context.artifact.sampleVideo?.original?.summary ?? "样例视频",
    durationSeconds: context.artifact.metadata?.durationSeconds ?? null,
    width: context.artifact.metadata?.width ?? null,
    height: context.artifact.metadata?.height ?? null,
    updatedAt: cached.cache.updatedAt ?? null,
    tags: ["功能槽位原子化"],
    cacheAvailable: true,
    cacheKind: CACHE_KIND,
    traceId: cached.analysis?.traceId ?? cached.analysis?.agent?.traceId ?? null,
    sourceSampleVideoId: cached.cache.sampleVideoId,
    sourceArtifactId: cached.analysis?.artifactId ?? null,
    sourceTraceId: cached.analysis?.traceId ?? cached.analysis?.agent?.traceId ?? null,
    sourceTurnId: cached.analysis?.agent?.turnId ?? null,
    sourceCreatedAt: cached.analysis?.createdAt ?? null,
    cacheKey: context.cacheKey ?? cached.cache.cacheKey ?? null,
    slotCount: cached.analysis?.slotMap?.slots?.length ?? 0,
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

module.exports = {
  findCachedArtifact,
  runCacheLookup,
  resolveCachedPrompt,
  markCacheWaiting,
  buildCachePrompt,
  reuseCachedAnalysis,
};
