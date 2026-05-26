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
  sanitizeForAppServerText,
  normalizeText,
} = require("./shared");

function buildTransformOutputContract() {
  return {
    shots: "non-empty array, shot-centric.v2 contract",
    commerceBrief: "object, keep existing sellingObject/proofApproach/promisedOutcome/persuasionTarget/conversionAction/uncertainties fields",
    "shots[].summary": "string, describe only visible people/objects/actions/scenes in this shot; no hook, topic, selling point, price, persuasion task, subtitle meaning, or script role",
    "shots[].start": "number, first shot must start at 0",
    "shots[].end": "number, last shot must end at durationSeconds",
    "shots[].endBoundary": "object|null, null only for the last shot",
    "shots[].endBoundary.timestamp": "number, must equal current shot end",
  };
}

function buildTransformManifest({ prepared, rawFinalMessage }) {
  const manifest = {
    schemaVersion: TRANSFORM_INPUT_SCHEMA_VERSION,
    durationSeconds: prepared.durationSeconds,
    analysisSampling: prepared.analysisSampling ?? null,
    rawAnalyzerResult: {
      textPreview: normalizeText(rawFinalMessage, 800),
    },
  };
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

function renderRepairTurnInputs({ prepared, rawFinalMessage, validationError, priorTurnOutput, repairAttemptCount, roleProfile }) {
  const manifest = buildTransformManifest({ prepared, rawFinalMessage });
  const outputContract = buildTransformOutputContract();
  const priorOutputText = String(priorTurnOutput ?? "").trim();
  const validation = validationError?.debugPayload?.validation ?? {
    validatorCode: validationError?.code ?? null,
    message: validationError?.message ?? null,
  };
  const priorOutputSummary = {
    hasPriorOutput: Boolean(priorOutputText),
    outputLength: priorOutputText.length,
    messagePreview: priorOutputText.replace(/\s+/g, " ").slice(0, 200),
  };
  const prompt = renderTurnTemplate(roleProfile, "repair", {
    repairAttemptCount,
    manifestJson: JSON.stringify(manifest),
    validationJson: JSON.stringify(validation),
    priorOutputSummaryJson: JSON.stringify(priorOutputSummary),
    outputContractJson: JSON.stringify(outputContract),
  });
  return {
    ...prompt,
    inputs: sanitizeForAppServerText([{ type: "text", text: prompt.text, text_elements: [] }]),
    manifest,
    outputContract,
    validation,
    priorOutputSummary,
  };
}

function buildVisualSummaryOutputContract() {
  return {
    shots: "array, same order and count as input shots",
    "shots[].shotNo": "string, copy from input shot",
    "shots[].summary": "string, describe only visible people/objects/actions/scenes/product state in this shot; no hook, topic, selling point, price, persuasion task, subtitle meaning, or script role",
  };
}

function buildVisualSummaryManifest({ shots, resultSheets, prepared }) {
  const subtitleMap = buildShotSubtitleMap(shots, prepared?.subtitleContext);
  return {
    schemaVersion: "shot-boundary-visual-summary-input.v1",
    shots: (Array.isArray(shots) ? shots : []).map((shot, index) => ({
      shotNo: shot?.shotNo ?? `S${String(index + 1).padStart(3, "0")}`,
      start: shot?.start ?? null,
      end: shot?.end ?? null,
      currentSummary: normalizeText(shot?.summary, 120),
      subtitleText: subtitleMap.get(index)?.subtitleText ?? "",
      subtitleContextText: subtitleMap.get(index)?.subtitleContextText ?? "",
    })),
    sheets: (Array.isArray(resultSheets) ? resultSheets : [])
      .filter((sheet) => sheet?.localImagePath)
      .map((sheet) => ({
        shotNo: sheet.shotNo ?? null,
        shotIndex: sheet.shotIndex ?? null,
        start: sheet.start ?? null,
        end: sheet.end ?? null,
        pageIndex: sheet.pageIndex ?? 0,
        pageCount: sheet.pageCount ?? 1,
        frameCount: sheet.frameCount ?? 0,
      })),
  };
}

function renderVisualSummaryTurnInputs({ result, resultSheets, prepared, roleProfile }) {
  const manifest = buildVisualSummaryManifest({ shots: result?.shots, resultSheets, prepared });
  const outputContract = buildVisualSummaryOutputContract();
  const prompt = renderTurnTemplate(roleProfile, "visualSummary", {
    manifestJson: JSON.stringify(manifest),
    outputContractJson: JSON.stringify(outputContract),
  });
  const visualInputs = (Array.isArray(resultSheets) ? resultSheets : [])
    .filter((sheet) => sheet?.localImagePath)
    .map((sheet) => ({ type: "localImage", path: sheet.localImagePath }));
  return {
    ...prompt,
    inputs: sanitizeForAppServerText([{ type: "text", text: prompt.text, text_elements: [] }, ...visualInputs]),
    manifest,
    outputContract,
  };
}

function buildShotSubtitleMap(shots, subtitleContext) {
  const safeShots = Array.isArray(shots) ? shots : [];
  const subtitles = (Array.isArray(subtitleContext) ? subtitleContext : [])
    .map((item) => ({
      start: Number(item?.start ?? Number.NaN),
      end: Number(item?.end ?? Number.NaN),
      text: normalizeText(item?.text, 120),
    }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.text);
  return new Map(safeShots.map((shot, index) => {
    const start = Number(shot?.start ?? Number.NaN);
    const end = Number(shot?.end ?? Number.NaN);
    const texts = Number.isFinite(start) && Number.isFinite(end)
      ? subtitles.filter((item) => intervalOverlapSeconds(start, end, item.start, item.end) > 0).map((item) => item.text)
      : [];
    const joined = normalizeText(texts.join(" "), 240);
    return [index, { subtitleText: joined, subtitleContextText: joined }];
  }));
}

function intervalOverlapSeconds(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
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
  renderRepairTurnInputs,
  buildVisualSummaryOutputContract,
  buildVisualSummaryManifest,
  buildShotSubtitleMap,
  renderVisualSummaryTurnInputs,
  prepareShotSheets,
  REVIEW_ROLE,
};
