const fs = require("fs/promises");
const path = require("path");
const defaultContactSheetGenerator = require("../../../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { renderTurnTemplate } = require("../role-profile-loader");
const {
  REVIEW_ROLE,
  TRANSFORM_INPUT_SCHEMA_VERSION,
  RESULT_SHEET_PURPOSE,
  RESULT_SHEET_SUBDIR,
  RESULT_SHEET_DIRNAME,
  normalizeTransformShot,
  normalizeReviewFrame,
  normalizeReviewSubtitleContext,
  sanitizeForAppServerText,
  normalizeText,
} = require("./shared");

function buildTransformOutputContract() {
  return {
    shots: "non-empty array, shot-centric.v2 contract",
    commerceBrief: "object, keep existing sellingObject/proofApproach/promisedOutcome/persuasionTarget/conversionAction/uncertainties fields",
    videoSummary: "short string, summarize the whole video",
    "shots[].summary": "string, describe what this shot contains",
    "shots[].start": "number, first shot must start at 0",
    "shots[].end": "number, last shot must end at durationSeconds",
    "shots[].endBoundary": "object|null, null only for the last shot",
    "shots[].endBoundary.timestamp": "number, must equal current shot end",
    "shots[].endBoundary.reason": "short string, explain why the cut happens here",
  };
}

function buildTransformManifest({ prepared, rawFinalMessage }) {
  const manifest = {
    schemaVersion: TRANSFORM_INPUT_SCHEMA_VERSION,
    durationSeconds: prepared.durationSeconds,
    analysisSampling: prepared.analysisSampling ?? null,
    subtitleContextSummary: prepared.subtitleContextSummary ?? { subtitleSegmentCount: 0, subtitleTextHash: null, truncated: false },
    frameSummary: Array.isArray(prepared.frames)
      ? prepared.frames.slice(0, 12).map((frame) => ({
        inputIndex: frame.inputIndex,
        sourceFrameIndex: frame.sourceFrameIndex,
        timestamp: frame.timestamp,
        fileName: frame.fileName ?? null,
      }))
      : [],
    rawAnalyzerResult: {
      textLength: String(rawFinalMessage ?? "").trim().length,
      textPreview: normalizeText(rawFinalMessage, 800),
    },
  };
  if (Array.isArray(prepared.subtitleContext) && prepared.subtitleContext.length) {
    manifest.subtitleContext = normalizeReviewSubtitleContext(prepared.subtitleContext);
  }
  return manifest;
}

function renderTransformTurnInputs({ prepared, rawFinalMessage, roleProfile }) {
  const manifest = buildTransformManifest({ prepared, rawFinalMessage });
  const outputContract = buildTransformOutputContract();
  const prompt = renderTurnTemplate(roleProfile, "transform", {
    manifestJson: JSON.stringify(manifest),
    outputContractJson: JSON.stringify(outputContract),
  });
  return {
    ...prompt,
    inputs: sanitizeForAppServerText([{ type: "text", text: prompt.text, text_elements: [] }]),
    manifest,
    outputContract,
  };
}

async function prepareShotSheets({
  prepared,
  shots,
  artifactId,
  sampleDir,
  store,
  contactSheetGenerator = defaultContactSheetGenerator,
}) {
  if (!sampleDir || !store) throw new Error("shot boundary result sheets missing sampleDir/store");
  const resultDir = path.join(sampleDir, RESULT_SHEET_DIRNAME);
  await fs.mkdir(path.join(resultDir, RESULT_SHEET_SUBDIR), { recursive: true });
  const frames = Array.isArray(prepared.frames) ? prepared.frames.map(normalizeReviewFrame).filter((frame) => frame.frameId && frame.filePath) : [];
  const normalizedShots = Array.isArray(shots) ? shots.map((shot, index) => normalizeTransformShot(shot, index)) : [];
  const sheets = [];
  for (const shot of normalizedShots) {
    const shotFrames = selectFramesForShot(frames, shot, shot.index === (normalizedShots.length - 1));
    if (!shotFrames.length) {
      sheets.push({
        shotNo: shot.shotNo,
        shotIndex: shot.index,
        start: shot.start,
        end: shot.end,
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
      sampleDir: resultDir,
      parentArtifactId: artifactId,
      store,
      outputSubdir: RESULT_SHEET_SUBDIR,
      sheetPurpose: RESULT_SHEET_PURPOSE,
      buildSheetId: ({ sheetIndex }) => `${shot.shotNo}-p${sheetIndex + 1}`,
      buildGridItemLabel: (frame) => `${shot.shotNo} ${Number(frame.timestamp ?? 0).toFixed(3)}s`,
      outputFileNameBuilder: (sheet) => `${sheet.sheetId}.jpg`,
      constraints: {
        ...contactSheetGenerator.DEFAULT_CONSTRAINTS,
        overlapFrameCount: 0,
      },
    });
    for (const sheet of rendered) {
      sheets.push({
        ...sheet,
        shotNo: shot.shotNo,
        shotIndex: shot.index,
        start: shot.start,
        end: shot.end,
        pageIndex: sheet.sheetIndex ?? 0,
        pageCount: rendered.length,
        empty: false,
      });
    }
  }
  return sanitizeForAppServerText(sheets);
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
  buildTransformOutputContract,
  buildTransformManifest,
  renderTransformTurnInputs,
  prepareShotSheets,
  REVIEW_ROLE,
};
