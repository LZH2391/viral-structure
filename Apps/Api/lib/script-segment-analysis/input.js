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
  normalizeFrame,
  normalizeShotNo,
  normalizeNumber,
  normalizeInteger,
} = require("../analysis-input/normalize");
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
  const { visualManifest, visualAttachments } = await buildVisualManifest({
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
    visualAttachments,
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
  for (const attachment of inputPackage.visualAttachments) {
    inputs.push({ type: "localImage", path: attachment.localImagePath });
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
  for (const attachment of inputPackage.visualAttachments) {
    inputs.push({ type: "localImage", path: attachment.localImagePath });
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
