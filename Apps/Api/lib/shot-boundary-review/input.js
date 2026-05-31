const fs = require("fs/promises");
const path = require("path");
const defaultContactSheetGenerator = require("../../../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const {
  REVIEW_ROLE,
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
    shots: "non-empty array, time boundary contract; omit shots[].summary and commerceBrief until visual summary turn",
    "shots[].start": "number, first shot must start at 0",
    "shots[].end": "number, last shot must end at durationSeconds",
    "shots[].endBoundary": "object|null, null only for the last shot",
    "shots[].endBoundary.timestamp": "number, must equal current shot end",
  };
}

function buildTransformManifest({ prepared, rawFinalMessage }) {
  const manifest = {
    durationSeconds: prepared.durationSeconds,
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
    commerceBrief: "object, summarize the commerce context grounded by shot contact sheets and visual summaries; keep sellingObject/proofApproach/promisedOutcome/persuasionTarget/conversionAction/uncertainties fields",
  };
}

function buildVisualSummaryManifest({ shots, result }) {
  return {
    shots: (Array.isArray(shots) ? shots : []).map((shot, index) => ({
      shotNo: shot?.shotNo ?? `S${String(index + 1).padStart(3, "0")}`,
      start: shot?.start ?? null,
      end: shot?.end ?? null,
      currentSummary: normalizeText(shot?.summary, 120),
    })),
  };
}

function renderVisualSummaryTurnInputs({ result, resultSheets, prepared, roleProfile }) {
  const manifest = buildVisualSummaryManifest({ shots: result?.shots, result });
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
  const representativeFrames = normalizedShots
    .map((shot) => buildRepresentativeShotFrame({ shot, frame: selectRepresentativeFrameForShot({ shot, frames }) }))
    .filter(Boolean);
  const representedShotNos = new Set(representativeFrames.map((frame) => frame.shotNo));
  for (const shot of normalizedShots) {
    if (representedShotNos.has(shot.shotNo)) continue;
    sheets.push({
      shotNo: shot.shotNo,
      shotIndex: shot.index,
      start: shot.start,
      end: shot.end,
      duration: roundShotTime(shot.end - shot.start),
      middleTimestamp: resolveShotMiddleTimestamp(shot),
      representativeFrameTimestamp: null,
      pageIndex: 0,
      pageCount: 0,
      frameCount: 0,
      empty: true,
      localImagePath: null,
    });
  }
  if (representativeFrames.length) {
    const rendered = await contactSheetGenerator.generateContactSheets({
      frames: representativeFrames,
      frameWidth: prepared.frameDimensions?.width ?? 0,
      frameHeight: prepared.frameDimensions?.height ?? 0,
      sampleDir: resultDir,
      parentArtifactId: artifactId,
      store,
      outputSubdir: RESULT_SHEET_SUBDIR,
      sheetPurpose: RESULT_SHEET_PURPOSE,
      buildSheetId: ({ sheetIndex }) => `shot-representatives-p${sheetIndex + 1}`,
      buildGridItemLabel: (frame) => ({ text: buildShotCellLabel(frame), complete: true }),
      outputFileNameBuilder: (sheet) => `${sheet.sheetId}.jpg`,
      constraints: {
        ...contactSheetGenerator.DEFAULT_CONSTRAINTS,
        overlapFrameCount: 0,
      },
    });
    for (const [sheetIndex, sheet] of rendered.entries()) {
      sheets.push({
        ...sheet,
        shotNos: sheet.gridItems.map((item) => item.shotNo).filter(Boolean),
        start: minFinite(sheet.gridItems.map((item) => item.shotStart)),
        end: maxFinite(sheet.gridItems.map((item) => item.shotEnd)),
        pageIndex: sheet.sheetIndex ?? sheetIndex,
        pageCount: rendered.length,
        empty: false,
      });
    }
  }
  return sanitizeForAppServerText(sheets);
}

function selectRepresentativeFrameForShot({ shot, frames }) {
  const safeFrames = Array.isArray(frames) ? frames : [];
  if (!safeFrames.length) return null;
  const middleTimestamp = resolveShotMiddleTimestamp(shot);
  let bestFrame = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const frame of safeFrames) {
    const timestamp = Number(frame?.timestamp ?? Number.NaN);
    if (!Number.isFinite(timestamp)) continue;
    const distance = Math.abs(timestamp - middleTimestamp);
    if (
      !bestFrame
      || distance < bestDistance
      || (distance === bestDistance && timestamp > Number(bestFrame.timestamp ?? Number.NEGATIVE_INFINITY))
    ) {
      bestFrame = frame;
      bestDistance = distance;
    }
  }
  return bestFrame;
}

function buildRepresentativeShotFrame({ shot, frame }) {
  if (!frame) return null;
  const start = roundShotTime(shot?.start);
  const end = roundShotTime(shot?.end);
  const duration = roundShotTime(end - start);
  return {
    ...frame,
    shotId: shot.shotId,
    shotNo: shot.shotNo,
    shotStart: start,
    shotEnd: end,
    shotDuration: duration,
    middleTimestamp: resolveShotMiddleTimestamp(shot),
    representativeFrameTimestamp: roundShotTime(frame?.timestamp),
  };
}

function resolveShotMiddleTimestamp(shot) {
  const start = roundShotTime(shot?.start);
  const end = roundShotTime(shot?.end);
  return roundShotTime(start + Math.max(0, end - start) / 2);
}

function buildShotCellLabel(frame) {
  return `${frame.shotNo} ${formatSeconds(frame.shotStart)}-${formatSeconds(frame.shotEnd)}s / ${formatSeconds(frame.shotDuration)}s`;
}

function formatSeconds(value) {
  return roundShotTime(value).toFixed(1);
}

function roundShotTime(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 1000) / 1000 : 0;
}

function minFinite(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
}

function maxFinite(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
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
