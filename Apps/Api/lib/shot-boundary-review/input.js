const fs = require("fs/promises");
const path = require("path");
const defaultContactSheetGenerator = require("../../../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { renderTurnTemplate } = require("../role-profile-loader");
const {
  REVIEW_ROLE,
  REVIEW_INPUT_SCHEMA_VERSION,
  REVIEW_SHEET_PURPOSE,
  REVIEW_SHEET_SUBDIR,
  normalizeReviewShot,
  normalizeReviewFrame,
  normalizeReviewSubtitleContext,
  sanitizeForAppServerText,
} = require("./shared");

function buildReviewOutputContract() {
  return {
    decision: "pass|rework|blocked",
    reason: "short string, summarize reviewer decision",
    issues: "array, empty when pass",
    "issues[].issue": "string, identify false_cut/missed_cut/boundary_offset/uncertain in natural language",
    "issues[].minimal_fix": "string, executable instruction for analyzer producer thread",
    "issues[].shot_ids": "array of existing shot numbers, e.g. [3,4]",
  };
}

function buildReviewManifest({ prepared, shotAnalysis, reviewSheets }) {
  const shots = (shotAnalysis.shots ?? []).map(normalizeReviewShot);
  const manifest = {
    schemaVersion: REVIEW_INPUT_SCHEMA_VERSION,
    durationSeconds: prepared.durationSeconds,
    shots,
    shotSheets: reviewSheets.map((sheet) => ({
      shotNo: sheet.shotNo,
      shotIndex: sheet.shotIndex,
      start: sheet.start,
      end: sheet.end,
      pageIndex: sheet.pageIndex,
      pageCount: sheet.pageCount,
      frameCount: sheet.frameCount,
    })),
    subtitleContextSummary: prepared.subtitleContextSummary ?? { subtitleSegmentCount: 0, subtitleTextHash: null, truncated: false },
  };
  if (Array.isArray(prepared.subtitleContext) && prepared.subtitleContext.length) {
    manifest.subtitleContext = normalizeReviewSubtitleContext(prepared.subtitleContext);
  }
  return manifest;
}

async function prepareReviewSheets({ prepared, shotAnalysis, sampleDir, store, contactSheetGenerator = defaultContactSheetGenerator }) {
  if (!sampleDir || !store) throw new Error("shot boundary review missing sampleDir/store");
  const reviewDir = path.join(sampleDir, "shot-boundary-review");
  await fs.mkdir(path.join(reviewDir, REVIEW_SHEET_SUBDIR), { recursive: true });
  const frames = Array.isArray(prepared.frames) ? prepared.frames.map(normalizeReviewFrame).filter((frame) => frame.frameId && frame.filePath) : [];
  const sheets = [];
  for (const shot of shotAnalysis.shots ?? []) {
    const normalizedShot = normalizeReviewShot(shot);
    const shotFrames = selectFramesForShot(frames, normalizedShot, shot.index === (shotAnalysis.shots.length - 1));
    if (!shotFrames.length) {
      sheets.push({
        shotNo: normalizedShot.shotNo,
        shotIndex: normalizedShot.index,
        start: normalizedShot.start,
        end: normalizedShot.end,
        pageIndex: 0,
        pageCount: 0,
        frameCount: 0,
        empty: true,
        localImagePath: null,
      });
      continue;
    }
    const rendered = await contactSheetGenerator.generateContactSheets({
      frames: shotFrames,
      frameWidth: prepared.frameDimensions?.width ?? 0,
      frameHeight: prepared.frameDimensions?.height ?? 0,
      sampleDir: reviewDir,
      parentArtifactId: shotAnalysis.artifactId,
      store,
      outputSubdir: REVIEW_SHEET_SUBDIR,
      sheetPurpose: REVIEW_SHEET_PURPOSE,
      buildSheetId: ({ sheetIndex }) => `${normalizedShot.shotNo}-review-p${sheetIndex + 1}`,
      buildGridItemLabel: (frame) => `${normalizedShot.shotNo} ${Number(frame.timestamp ?? 0).toFixed(3)}s`,
      outputFileNameBuilder: (sheet) => `${sheet.sheetId}.jpg`,
      constraints: {
        ...contactSheetGenerator.DEFAULT_CONSTRAINTS,
        overlapFrameCount: 0,
      },
    });
    for (const sheet of rendered) {
      sheets.push({
        shotNo: normalizedShot.shotNo,
        shotIndex: normalizedShot.index,
        start: normalizedShot.start,
        end: normalizedShot.end,
        pageIndex: sheet.sheetIndex ?? 0,
        pageCount: rendered.length,
        frameCount: sheet.frameCount,
        empty: false,
        localImagePath: sheet.localImagePath,
        uri: sheet.uri,
        sheetId: sheet.sheetId,
      });
    }
  }
  return sanitizeForAppServerText(sheets);
}

function renderReviewTurnInputs({ prepared, shotAnalysis, reviewSheets, roleProfile }) {
  const manifest = buildReviewManifest({ prepared, shotAnalysis, reviewSheets });
  const outputContract = buildReviewOutputContract();
  const prompt = renderTurnTemplate(roleProfile, "review", {
    manifestJson: JSON.stringify(manifest),
    outputContractJson: JSON.stringify(outputContract),
  });
  const inputs = [{ type: "text", text: prompt.text, text_elements: [] }];
  for (const sheet of reviewSheets) {
    if (sheet.localImagePath) inputs.push({ type: "localImage", path: sheet.localImagePath });
  }
  return {
    ...prompt,
    inputs: sanitizeForAppServerText(inputs),
    manifest,
    outputContract,
  };
}

function selectFramesForShot(frames, shot, isLastShot) {
  const start = Number(shot.start);
  const end = Number(shot.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return frames.filter((frame) => {
    const timestamp = Number(frame.timestamp);
    if (!Number.isFinite(timestamp)) return false;
    return isLastShot ? timestamp >= start && timestamp <= end : timestamp >= start && timestamp < end;
  });
}

module.exports = {
  buildReviewOutputContract,
  buildReviewManifest,
  prepareReviewSheets,
  renderReviewTurnInputs,
  REVIEW_ROLE,
};
