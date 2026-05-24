const fs = require("fs/promises");
const path = require("path");
const { renderTurnTemplate } = require("../role-profile-loader");
const {
  planShotFramePages: planSharedShotFramePages,
  frameBelongsToShot: frameBelongsToShotShared,
  buildShotFrameVisualManifest,
  stripVisualManifestPaths,
} = require("../analysis-input/shot-frame-pages");
const { buildShotSubtitleMap: buildSharedShotSubtitleMap } = require("../analysis-input/subtitle-shot-map");
const {
  MAX_UNCERTAINTIES,
  MAX_TEXT_FIELD_LENGTH,
  codedError,
  sanitizeForAppServerText,
  normalizeText,
  normalizeStringArray,
  buildOutputContract,
  stableJson,
  contentHash,
} = require("./shared");

const INPUT_PACKAGE_SCHEMA_VERSION = "script_segment_input_package.v1";
const SCRIPT_SEGMENT_SHEET_PURPOSE = "script_segment_shot_context";
const SCRIPT_SEGMENT_SHEET_SUBDIR = "script-segment-shot-sheets";
const SHOT_SUBTITLE_BOUNDARY_EPSILON_SECONDS = 0.05;
const SHOT_SUBTITLE_TEXT_MAX_LENGTH = 240;
const SHOT_SUBTITLE_CONTEXT_MAX_LENGTH = 320;

function prepareInput(artifact, options = {}) {
  const runtimeRoot = options.runtimeRoot ?? null;
  const shotBoundary = artifact?.shotBoundaryAnalysis;
  const shots = Array.isArray(shotBoundary?.shots) ? shotBoundary.shots : [];
  if (!shots.length) {
    throw codedError("script_segment_missing_shots", "当前样例没有可分析的切镜结果", null, false);
  }
  const frames = Array.isArray(artifact?.frames) ? artifact.frames : [];
  const normalizedShotWindows = shots.map((shot, index) => ({
    shotId: String(shot.id),
    shotNo: normalizeShotNo(shot.shotNo, index),
    start: normalizeNumber(shot.start, 0),
    end: normalizeNumber(shot.end, normalizeNumber(shot.start, 0)),
    summary: normalizeText(shot.summary ?? shot.reason ?? "镜头内容", 160),
    isLastShot: index === shots.length - 1,
  }));
  const shotSubtitleMap = buildSharedShotSubtitleMap(normalizedShotWindows, artifact?.subtitles);
  const normalizedShots = normalizedShotWindows.map((shot) => ({
    shotId: shot.shotId,
    shotNo: shot.shotNo,
    start: shot.start,
    end: shot.end,
    summary: shot.summary,
    subtitleText: normalizeText(shotSubtitleMap.get(shot.shotId)?.subtitleText ?? "", SHOT_SUBTITLE_TEXT_MAX_LENGTH),
    subtitleContextText: normalizeText(shotSubtitleMap.get(shot.shotId)?.subtitleContextText ?? "", SHOT_SUBTITLE_CONTEXT_MAX_LENGTH),
  }));
  return sanitizeForAppServerText({
    sampleVideoId: artifact.sampleVideoId,
    parentArtifactId: shotBoundary?.artifactId ?? artifact.sampleVideo?.artifactId ?? null,
    commerceBrief: normalizeCommerceBrief(shotBoundary?.commerceBrief ?? null),
    durationSeconds: normalizeNumber(artifact?.metadata?.durationSeconds, 0),
    frameDimensions: {
      width: normalizeInteger(artifact?.metadata?.width, 0),
      height: normalizeInteger(artifact?.metadata?.height, 0),
    },
    frames: frames
      .map((frame, index) => normalizeFrame(frame, index, runtimeRoot))
      .filter((frame) => frame.frameId && frame.filePath),
    shots: normalizedShots,
  });
}

function buildTurnInputs({ inputPackage }) {
  return {
    manifest: inputPackage.manifest,
    metadata: inputPackage.metadata,
    lineage: inputPackage.lineage,
    outputContract: inputPackage.outputContract,
    visualManifest: inputPackage.visualManifest,
  };
}

async function prepareInputPackage({ input, sampleDir, store }) {
  if (!sampleDir || !store) throw new Error("script segment input package missing sampleDir/store");
  const inputPackageDir = path.join(sampleDir, "script-segment-input");
  const sheetsDir = path.join(inputPackageDir, "sheets");
  await fs.mkdir(sheetsDir, { recursive: true });

  const manifest = buildManifest(input);
  const metadata = buildMetadata(inputPackageDir, input);
  const lineage = buildLineage(input);
  const outputContract = buildOutputContract();
  const shotFramePages = planSharedShotFramePages(input);
  const visualManifest = await buildVisualManifest({
    input,
    shotFramePages,
    sampleDir: inputPackageDir,
    sheetsDir,
    store,
  });

  const manifestPath = path.join(inputPackageDir, "manifest.json");
  const metadataPath = path.join(inputPackageDir, "metadata.json");
  const lineagePath = path.join(inputPackageDir, "lineage.json");
  const outputContractPath = path.join(inputPackageDir, "output-contract.json");
  const visualManifestPath = path.join(inputPackageDir, "visual-manifest.json");
  await Promise.all([
    store.writeJson(manifestPath, manifest),
    store.writeJson(metadataPath, metadata),
    store.writeJson(lineagePath, lineage),
    store.writeJson(outputContractPath, outputContract),
    store.writeJson(visualManifestPath, visualManifest),
  ]);

  const hashes = {
    manifestHash: contentHash(stableJson(manifest)),
    outputContractHash: contentHash(stableJson(outputContract)),
    visualManifestHash: contentHash(stableJson(stripVisualManifestPaths(visualManifest))),
  };

  const inputPackage = sanitizeForAppServerText({
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    manifest,
    manifestPath,
    metadata,
    metadataPath,
    lineage,
    lineagePath,
    outputContract,
    outputContractPath,
    visualManifest,
    visualManifestPath,
    sheetCount: visualManifest.sheetCount,
    emptyShotCount: visualManifest.emptyShotCount,
    hashes,
  });

  return inputPackage;
}

function renderAnalyzeTurnInputs({ input, inputPackage, roleProfile }) {
  const built = buildTurnInputs({ inputPackage });
  const prompt = renderTurnTemplate(roleProfile, "analyze", {
    inputSummaryText: buildInputSummaryText(inputPackage),
    manifestPath: inputPackage.manifestPath,
    outputContractPath: inputPackage.outputContractPath,
    visualManifestPath: inputPackage.visualManifestPath,
  });
  const inputs = [{ type: "text", text: prompt.text, text_elements: [] }];
  for (const sheet of inputPackage.visualManifest.sheets) {
    inputs.push({ type: "localImage", path: sheet.localImagePath });
  }
  return {
    ...prompt,
    inputs: sanitizeForAppServerText(inputs),
    manifest: built.manifest,
    metadata: built.metadata,
    lineage: built.lineage,
    outputContract: built.outputContract,
    visualManifest: built.visualManifest,
  };
}

function buildRepairTurnInputs({ input, inputPackage, validationError, priorTurnOutput, repairAttemptCount }) {
  return {
    manifest: inputPackage.manifest,
    manifestPath: inputPackage.manifestPath,
    metadata: inputPackage.metadata,
    metadataPath: inputPackage.metadataPath,
    lineage: inputPackage.lineage,
    lineagePath: inputPackage.lineagePath,
    visualManifest: inputPackage.visualManifest,
    visualManifestPath: inputPackage.visualManifestPath,
    validation: validationError?.debugPayload?.validation ?? { code: validationError?.code ?? null, message: validationError?.message ?? null },
    priorOutputSummary: {
      hasPriorOutput: Boolean(String(priorTurnOutput ?? "").trim()),
      outputLength: String(priorTurnOutput ?? "").trim().length,
    },
    repairAttemptCount,
    outputContract: inputPackage.outputContract,
    outputContractPath: inputPackage.outputContractPath,
  };
}

function renderRepairTurnInputs({ input, inputPackage, validationError, priorTurnOutput, repairAttemptCount, roleProfile }) {
  const built = buildRepairTurnInputs({ input, inputPackage, validationError, priorTurnOutput, repairAttemptCount });
  const prompt = renderTurnTemplate(roleProfile, "repair", {
    repairAttemptCount,
    inputSummaryText: buildInputSummaryText(inputPackage),
    manifestPath: built.manifestPath,
    validationPathText: "校验失败摘要见当前输入文本",
    priorOutputSummaryPathText: "上次输出摘要见当前输入文本",
    outputContractPath: built.outputContractPath,
    visualManifestPath: built.visualManifestPath,
    validationJson: stableJson(built.validation),
    priorOutputSummaryJson: stableJson(built.priorOutputSummary),
  });
  const inputs = [{
    type: "text",
    text: prompt.text,
    text_elements: [],
  }];
  for (const sheet of inputPackage.visualManifest.sheets) {
    inputs.push({ type: "localImage", path: sheet.localImagePath });
  }
  return {
    ...prompt,
    inputs: sanitizeForAppServerText(inputs),
    ...built,
  };
}

function buildManifest(input) {
  return {
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    commerceBrief: input.commerceBrief,
    shotCount: input.shots.length,
    shots: input.shots,
  };
}

function buildMetadata(inputPackageDir, input) {
  return {
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    inputPackageDir,
    durationSeconds: input.durationSeconds ?? null,
    frameDimensions: input.frameDimensions ?? { width: 0, height: 0 },
  };
}

function buildLineage(input) {
  return {
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    sampleVideoId: input.sampleVideoId,
    parentArtifactId: input.parentArtifactId,
  };
}

function planShotFramePages(input) {
  const frames = Array.isArray(input.frames) ? input.frames : [];
  const shots = Array.isArray(input.shots) ? input.shots : [];
  return shots.map((shot, index) => {
    const matchedFrames = frames.filter((frame) => frameBelongsToShot(frame, shot, index === shots.length - 1));
    return {
      shot,
      shotIndex: index,
      frames: matchedFrames.map((frame) => ({
        ...frame,
        shotId: shot.shotId,
        shotNo: shot.shotNo,
      })),
    };
  });
}

async function buildVisualManifest({ input, shotFramePages, sampleDir, sheetsDir, store }) {
  return sanitizeForAppServerText(await buildShotFrameVisualManifest({
    input,
    shotFramePages,
    sampleDir,
    store,
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    sheetPurpose: SCRIPT_SEGMENT_SHEET_PURPOSE,
  }));
}

function buildInputSummaryText(inputPackage) {
  const subtitleReadyShotCount = Array.isArray(inputPackage?.manifest?.shots)
    ? inputPackage.manifest.shots.filter((shot) => String(shot?.subtitleText ?? shot?.subtitleContextText ?? "").trim()).length
    : 0;
  return `本次包含 ${inputPackage.manifest.shotCount} 个镜头、${inputPackage.visualManifest.sheetCount} 个镜头联表页、${inputPackage.visualManifest.emptyShotCount} 个空镜头；其中 ${subtitleReadyShotCount} 个镜头附带对齐字幕。输入包路径见下。`;
}

function frameBelongsToShot(frame, shot, isLastShot) {
  return frameBelongsToShotShared(frame, shot, isLastShot);
}

function normalizeCommerceBrief(brief) {
  if (!brief || typeof brief !== "object") return null;
  const normalized = {
    sellingObject: normalizeText(brief.sellingObject, MAX_TEXT_FIELD_LENGTH),
    proofApproach: normalizeText(brief.proofApproach, MAX_TEXT_FIELD_LENGTH),
    promisedOutcome: normalizeText(brief.promisedOutcome, MAX_TEXT_FIELD_LENGTH),
    persuasionTarget: normalizeText(brief.persuasionTarget, MAX_TEXT_FIELD_LENGTH),
    conversionAction: normalizeText(brief.conversionAction, MAX_TEXT_FIELD_LENGTH),
    uncertainties: normalizeStringArray(brief.uncertainties, MAX_UNCERTAINTIES),
  };
  return normalized;
}

function normalizeFrame(frame, index, runtimeRoot) {
  const imageUri = String(frame?.imageUri ?? frame?.uri ?? "");
  const filePath = resolveLocalImagePath(imageUri, runtimeRoot);
  return {
    frameId: String(frame?.frameId ?? ""),
    artifactId: frame?.artifactId ?? null,
    parentArtifactId: frame?.parentArtifactId ?? null,
    timestamp: normalizeNumber(frame?.timestamp, 0),
    inputIndex: normalizeInteger(frame?.inputIndex, index),
    sourceFrameIndex: normalizeInteger(frame?.sourceFrameIndex, index),
    imageUri,
    filePath,
  };
}

function resolveLocalImagePath(imageUri, runtimeRoot) {
  const value = String(imageUri ?? "");
  if (runtimeRoot && value.startsWith("/runtime/")) {
    return path.join(runtimeRoot, ...value.slice("/runtime/".length).split("/"));
  }
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/")) return value;
  return value;
}

function normalizeShotNo(value, index) {
  const text = String(value ?? "").trim();
  return text || `S${String(index + 1).padStart(3, "0")}`;
}

function normalizeNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.round(next * 1000) / 1000 : fallback;
}

function normalizeInteger(value, fallback) {
  const next = Number(value);
  return Number.isInteger(next) ? next : fallback;
}

function buildShotSubtitleMap(shots, subtitles) {
  const map = new Map((Array.isArray(shots) ? shots : []).map((shot) => [shot.shotId, { subtitleText: "", subtitleContextText: "" }]));
  if (!Array.isArray(shots) || !shots.length || !subtitles || subtitles.status !== "processed") return map;

  const words = Array.isArray(subtitles.words) ? subtitles.words.filter((word) => String(word?.text ?? "").trim()) : [];
  const segments = Array.isArray(subtitles.segments) ? subtitles.segments.filter((segment) => String(segment?.text ?? "").trim()) : [];
  const utterances = Array.isArray(subtitles.utterances) ? subtitles.utterances.filter((utterance) => String(utterance?.text ?? "").trim()) : [];

  appendShotSubtitleText({ map, shots, words, segments });

  for (const shot of shots) {
    const entry = map.get(shot.shotId);
    if (!entry) continue;
    entry.subtitleContextText = utterances
      .filter((utterance) => utteranceOverlapsShot(utterance, shot))
      .map((utterance) => String(utterance.text ?? "").trim())
      .filter(Boolean)
      .join("");
  }

  return map;
}

function appendShotSubtitleText({ map, shots, words, segments }) {
  const indexedWords = words.map((word, index) => ({ word, index }));
  const emittedWordIndexes = new Set();

  for (const segment of segments) {
    const segmentWordItems = indexedWords.filter(({ word }) => wordOverlapsSubtitleSegment(word, segment));
    if (!segmentWordItems.length) continue;
    const decoratedTexts = decorateWordsWithSegmentText(segment.text, segmentWordItems.map(({ word }) => word));
    segmentWordItems.forEach(({ word, index }, itemIndex) => {
      if (emittedWordIndexes.has(index)) return;
      appendWordTextToShot(map, shots, word, decoratedTexts[itemIndex] ?? String(word.text ?? "").trim());
      emittedWordIndexes.add(index);
    });
  }

  for (const { word, index } of indexedWords) {
    if (emittedWordIndexes.has(index)) continue;
    appendWordTextToShot(map, shots, word, String(word.text ?? "").trim());
  }
}

function appendWordTextToShot(map, shots, word, text) {
  const value = String(text ?? "").trim();
  if (!value) return;
  const shot = resolveWordShot(shots, word);
  if (!shot) return;
  const entry = map.get(shot.shotId);
  if (!entry) return;
  entry.subtitleText += value;
}

function decorateWordsWithSegmentText(segmentText, segmentWords) {
  const sourceText = String(segmentText ?? "").trim();
  const fallback = segmentWords.map((word) => String(word?.text ?? "").trim());
  if (!sourceText || !fallback.length) return fallback;

  const result = [];
  let cursor = 0;
  for (const wordText of fallback) {
    if (!wordText) {
      result.push("");
      continue;
    }
    const wordIndex = sourceText.indexOf(wordText, cursor);
    if (wordIndex < 0) return fallback;
    const separator = sourceText.slice(cursor, wordIndex);
    if (separator && result.length) {
      result[result.length - 1] += separator;
      result.push(wordText);
    } else {
      result.push(`${separator}${wordText}`);
    }
    cursor = wordIndex + wordText.length;
  }
  if (cursor < sourceText.length && result.length) result[result.length - 1] += sourceText.slice(cursor);
  return result;
}

function wordOverlapsSubtitleSegment(word, segment) {
  const wordStart = normalizeNumber(word?.start, Number.NaN);
  const wordEnd = normalizeNumber(word?.end, wordStart);
  const segmentStart = normalizeNumber(segment?.start, Number.NaN);
  const segmentEnd = normalizeNumber(segment?.end, segmentStart);
  if (intervalOverlapSeconds(wordStart, wordEnd, segmentStart, segmentEnd) > 0) return true;

  const midpoint = Number.isFinite(wordStart) && Number.isFinite(wordEnd) && wordEnd >= wordStart ? (wordStart + wordEnd) / 2 : wordStart;
  return Number.isFinite(midpoint)
    && Number.isFinite(segmentStart)
    && Number.isFinite(segmentEnd)
    && midpoint >= segmentStart
    && midpoint < segmentEnd;
}

function resolveWordShot(shots, word) {
  const text = String(word?.text ?? "").trim();
  if (!text) return null;
  const start = normalizeNumber(word?.start, Number.NaN);
  const end = normalizeNumber(word?.end, start);
  let bestShot = null;
  let bestOverlap = -1;
  for (const shot of shots) {
    const overlap = intervalOverlapSeconds(start, end, shot.start, shot.end);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestShot = shot;
    }
  }
  if (bestOverlap > 0) return bestShot;

  const midpoint = Number.isFinite(start) && Number.isFinite(end) && end >= start ? (start + end) / 2 : start;
  const strict = shots.find((shot) => shotContainsTime(shot, midpoint, { epsilon: 0 }));
  if (strict) return strict;

  const fuzzy = shots.find((shot) => shotContainsTime(shot, midpoint, { epsilon: SHOT_SUBTITLE_BOUNDARY_EPSILON_SECONDS }));
  if (fuzzy) return fuzzy;

  return bestShot;
}

function utteranceOverlapsShot(utterance, shot) {
  const start = normalizeNumber(utterance?.start, Number.NaN);
  const end = normalizeNumber(utterance?.end, start);
  return intervalOverlapSeconds(start, end, shot.start - SHOT_SUBTITLE_BOUNDARY_EPSILON_SECONDS, shot.end + SHOT_SUBTITLE_BOUNDARY_EPSILON_SECONDS) > 0;
}

function shotContainsTime(shot, time, { epsilon = 0 } = {}) {
  if (!Number.isFinite(time)) return false;
  const start = Number(shot?.start ?? Number.NaN) - epsilon;
  const end = Number(shot?.end ?? Number.NaN) + epsilon;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (shot?.isLastShot) return time >= start && time <= end;
  return time >= start && time < end;
}

function intervalOverlapSeconds(startA, endA, startB, endB) {
  if (!Number.isFinite(startA) || !Number.isFinite(endA) || !Number.isFinite(startB) || !Number.isFinite(endB)) return 0;
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

module.exports = {
  INPUT_PACKAGE_SCHEMA_VERSION,
  SCRIPT_SEGMENT_SHEET_PURPOSE,
  SCRIPT_SEGMENT_SHEET_SUBDIR,
  prepareInput,
  buildTurnInputs,
  prepareInputPackage,
  renderAnalyzeTurnInputs,
  buildRepairTurnInputs,
  renderRepairTurnInputs,
  frameBelongsToShot,
  buildInputSummaryText,
};
