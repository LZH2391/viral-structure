const {
  SKILL_PATH,
  contentHash,
  skillContentHashSync,
  resolveSkillHash,
  resolveSheetStartTime,
  resolveSheetEndTime,
} = require("./shared");

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
    skillPath: options.skillPath,
  });
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

module.exports = {
  buildShotBoundaryCacheParams,
  cacheParams,
  resolveSkillHash,
  skillContentHashSync,
  contentHash,
};
