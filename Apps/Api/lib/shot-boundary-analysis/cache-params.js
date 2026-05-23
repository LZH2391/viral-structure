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
  extractSampling,
  analysisSampling,
  frameDimensions,
  contactSheets,
  subtitleContextSummary,
  subtitleArtifactId,
  subtitleSegmentCount,
  subtitleTextHash,
  skillHash,
  profileVersion,
  promptTemplateId,
  promptTemplateVersion,
  promptTemplateHash,
  initFingerprint,
  skillPath = SKILL_PATH,
} = {}) {
  const sheets = Array.isArray(contactSheets) ? contactSheets : [];
  const resolvedSubtitleSummary = subtitleContextSummary ?? {
    subtitleArtifactId: subtitleArtifactId ?? null,
    subtitleSegmentCount: Number(subtitleSegmentCount ?? 0),
    subtitleTextHash: subtitleTextHash ?? null,
    truncated: false,
  };
  return {
    sourceArtifactId: sourceArtifactId ?? null,
    extractSampling: extractSampling ?? null,
    analysisSampling: analysisSampling ?? null,
    frameDimensions: frameDimensions ?? null,
    sheetCount: sheets.length,
    sheetLayouts: sheets.map((sheet) => ({
      frameCount: Number(sheet?.frameCount ?? 0),
      layout: sheet?.layout ?? null,
      constraints: sheet?.constraints ?? null,
      startTime: round(resolveSheetStartTime(sheet)),
      endTime: round(resolveSheetEndTime(sheet)),
    })),
    subtitleArtifactId: resolvedSubtitleSummary.subtitleArtifactId ?? null,
    subtitleSegmentCount: Number(resolvedSubtitleSummary.subtitleSegmentCount ?? 0),
    subtitleTextHash: resolvedSubtitleSummary.subtitleTextHash ?? null,
    profileVersion: profileVersion ?? null,
    promptTemplateId: promptTemplateId ?? null,
    promptTemplateVersion: promptTemplateVersion ?? null,
    promptTemplateHash: promptTemplateHash ?? null,
    initFingerprint: initFingerprint ?? null,
    skillHash: skillHash ?? skillContentHashSync(skillPath),
  };
}

function cacheParams(input, contactSheets, options = {}) {
  return buildShotBoundaryCacheParams({
    sourceArtifactId: input?.sourceArtifactId,
    extractSampling: input?.extractSampling,
    analysisSampling: input?.analysisSampling,
    frameDimensions: input?.frameDimensions,
    contactSheets,
    subtitleContextSummary: input?.subtitleContextSummary,
    skillHash: options.skillHash,
    profileVersion: options.profileVersion,
    promptTemplateId: options.promptTemplateId,
    promptTemplateVersion: options.promptTemplateVersion,
    promptTemplateHash: options.promptTemplateHash,
    initFingerprint: options.initFingerprint,
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
    initFingerprint,
    ...legacy
  } = params;
  return legacy;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
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
