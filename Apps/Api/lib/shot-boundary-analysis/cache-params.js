const {
  SKILL_PATH,
  contentHash,
  skillContentHashSync,
  resolveSkillHash,
  resolveSheetStartTime,
  resolveSheetEndTime,
} = require("./shared");

const PRE_SPLIT_ANALYZE_V2_TEMPLATE_HASH = "540555e80263042ee85b707fc92d9f7dc54db14b779350da72e7d10bcce08d86";

function buildShotBoundaryCacheParams({
  sourceArtifactId,
  analysisSampling,
  subtitleContextSummary,
  subtitleArtifactId,
  subtitleSegmentCount,
  subtitleTextHash,
  skillHash,
  profileVersion,
  promptTemplateId,
  promptTemplateVersion,
  promptTemplateHash,
  reviewMode = "reviewed",
  skillPath = SKILL_PATH,
} = {}) {
  const resolvedSubtitleSummary = subtitleContextSummary ?? {
    subtitleArtifactId: subtitleArtifactId ?? null,
    subtitleSegmentCount: Number(subtitleSegmentCount ?? 0),
    subtitleTextHash: subtitleTextHash ?? null,
    truncated: false,
  };
  return {
    sourceArtifactId: sourceArtifactId ?? null,
    analysisFps: Number(analysisSampling?.fps ?? analysisSampling?.requestedFps ?? 0) || null,
    subtitleArtifactId: resolvedSubtitleSummary.subtitleArtifactId ?? null,
    subtitleSegmentCount: Number(resolvedSubtitleSummary.subtitleSegmentCount ?? 0),
    subtitleTextHash: resolvedSubtitleSummary.subtitleTextHash ?? null,
    profileVersion: profileVersion ?? null,
    promptTemplateId: promptTemplateId ?? null,
    promptTemplateVersion: promptTemplateVersion ?? null,
    promptTemplateHash: promptTemplateHash ?? null,
    reviewMode: reviewMode === "unreviewed" ? "unreviewed" : "reviewed",
    skillHash: skillHash ?? skillContentHashSync(skillPath),
  };
}

function cacheParams(input, contactSheets, options = {}) {
  return buildShotBoundaryCacheParams({
    sourceArtifactId: input?.sourceArtifactId,
    analysisSampling: input?.analysisSampling,
    subtitleContextSummary: input?.subtitleContextSummary,
    skillHash: options.skillHash,
    profileVersion: options.profileVersion,
    promptTemplateId: options.promptTemplateId,
    promptTemplateVersion: options.promptTemplateVersion,
    promptTemplateHash: options.promptTemplateHash,
    reviewMode: options.reviewMode,
    skillPath: options.skillPath,
  });
}

function legacyCacheParams(input, contactSheets, options = {}) {
  const params = cacheParams(input, contactSheets, options);
  return stripPromptFingerprint(params);
}

function splitPredecessorCacheParams(input, contactSheets, options = {}) {
  const params = cacheParams(input, contactSheets, options);
  if (params.promptTemplateId !== "analyze" || params.promptTemplateVersion !== "analyze.v2") return null;
  if (params.promptTemplateHash === PRE_SPLIT_ANALYZE_V2_TEMPLATE_HASH) return null;
  return {
    ...params,
    promptTemplateHash: PRE_SPLIT_ANALYZE_V2_TEMPLATE_HASH,
  };
}

function stripPromptFingerprint(params) {
  if (!params || typeof params !== "object") return params;
  const {
    profileVersion,
    promptTemplateId,
    promptTemplateVersion,
    promptTemplateHash,
    ...legacy
  } = params;
  return legacy;
}

module.exports = {
  buildShotBoundaryCacheParams,
  cacheParams,
  legacyCacheParams,
  splitPredecessorCacheParams,
  PRE_SPLIT_ANALYZE_V2_TEMPLATE_HASH,
  stripPromptFingerprint,
  resolveSkillHash,
  skillContentHashSync,
  contentHash,
};
