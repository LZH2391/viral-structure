const fs = require("fs/promises");
const path = require("path");
const contactSheetGenerator = require("../../../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { renderTurnTemplate } = require("../role-profile-loader");
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

function prepareInput(artifact, options = {}) {
  const runtimeRoot = options.runtimeRoot ?? null;
  const shotBoundary = artifact?.shotBoundaryAnalysis;
  const shots = Array.isArray(shotBoundary?.shots) ? shotBoundary.shots : [];
  if (!shots.length) {
    throw codedError("script_segment_missing_shots", "当前样例没有可分析的切镜结果", null, false);
  }
  const frames = Array.isArray(artifact?.frames) ? artifact.frames : [];
  const normalizedShots = shots.map((shot, index) => ({
    shotId: String(shot.id),
    shotNo: normalizeShotNo(shot.shotNo, index),
    start: normalizeNumber(shot.start, 0),
    end: normalizeNumber(shot.end, normalizeNumber(shot.start, 0)),
    summary: normalizeText(shot.summary ?? shot.reason ?? "镜头内容", 160),
    subtitleSummary: null,
    ocrSummary: null,
    audioHintSummary: null,
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
  const shotFramePages = planShotFramePages(input);
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
  const sheets = [];
  const shots = [];
  let emptyShotCount = 0;
  for (const pageGroup of shotFramePages) {
    if (!pageGroup.frames.length) {
      emptyShotCount += 1;
      shots.push({
        shotId: pageGroup.shot.shotId,
        shotNo: pageGroup.shot.shotNo,
        pageCount: 0,
        frameCount: 0,
        empty: true,
        pages: [],
      });
      continue;
    }
    const renderedSheets = await contactSheetGenerator.generateContactSheets({
      frames: pageGroup.frames,
      frameWidth: input.frameDimensions?.width ?? 0,
      frameHeight: input.frameDimensions?.height ?? 0,
      sampleDir,
      parentArtifactId: input.parentArtifactId,
      store,
      outputSubdir: "sheets",
      sheetPurpose: SCRIPT_SEGMENT_SHEET_PURPOSE,
      buildSheetId: ({ sheetIndex }) => `${pageGroup.shot.shotNo}-p${sheetIndex + 1}`,
      buildGridItemLabel: (frame) => `${pageGroup.shot.shotNo} ${Number(frame.timestamp ?? 0).toFixed(3)}s`,
      outputFileNameBuilder: (sheet) => `${sheet.sheetId}.jpg`,
      constraints: {
        ...contactSheetGenerator.DEFAULT_CONSTRAINTS,
        overlapFrameCount: 0,
      },
    });
    const normalizedSheets = renderedSheets.map((sheet, pageIndex) => {
      const entry = {
        shotId: pageGroup.shot.shotId,
        shotNo: pageGroup.shot.shotNo,
        sheetId: sheet.sheetId,
        pageIndex,
        pageCount: renderedSheets.length,
        frameCount: sheet.frameCount,
        localImagePath: sheet.localImagePath,
        uri: sheet.uri,
        cells: sheet.gridItems.map((item) => ({
          frameId: item.frameId,
          timestamp: item.timestamp,
          row: item.row,
          col: item.col,
          displayLabel: item.displayFrameLabel,
        })),
      };
      sheets.push(entry);
      return entry;
    });
    shots.push({
      shotId: pageGroup.shot.shotId,
      shotNo: pageGroup.shot.shotNo,
      pageCount: normalizedSheets.length,
      frameCount: pageGroup.frames.length,
      empty: false,
      pages: normalizedSheets.map((sheet) => ({
        pageIndex: sheet.pageIndex,
        pageCount: sheet.pageCount,
        frameCount: sheet.frameCount,
        sheetId: sheet.sheetId,
      })),
    });
  }
  return sanitizeForAppServerText({
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    sheetPurpose: SCRIPT_SEGMENT_SHEET_PURPOSE,
    sheetCount: sheets.length,
    emptyShotCount,
    shots,
    sheets,
  });
}

function buildInputSummaryText(inputPackage) {
  return `本次包含 ${inputPackage.manifest.shotCount} 个镜头、${inputPackage.visualManifest.sheetCount} 个镜头联表页、${inputPackage.visualManifest.emptyShotCount} 个空镜头；输入包路径见下。`;
}

function frameBelongsToShot(frame, shot, isLastShot) {
  const timestamp = Number(frame?.timestamp ?? Number.NaN);
  const start = Number(shot?.start ?? Number.NaN);
  const end = Number(shot?.end ?? Number.NaN);
  if (!Number.isFinite(timestamp) || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  return isLastShot ? timestamp >= start && timestamp <= end : timestamp >= start && timestamp < end;
}

function stripVisualManifestPaths(visualManifest) {
  return {
    ...visualManifest,
    sheets: Array.isArray(visualManifest?.sheets)
      ? visualManifest.sheets.map(({ localImagePath, uri, ...sheet }) => sheet)
      : [],
  };
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
