const fs = require("fs/promises");
const path = require("path");
const { renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const {
  planShotFramePages,
  buildShotFrameVisualManifest,
  stripVisualManifestPaths,
} = require("../analysis-input/shot-frame-pages");
const { buildShotSubtitleMap } = require("../analysis-input/subtitle-shot-map");
const { normalizeFrame, normalizeShotNo, normalizeNumber, normalizeInteger } = require("../analysis-input/normalize");
const {
  codedError,
  sanitizeForAppServerText,
  normalizeText,
  normalizeStringArray,
  buildOutputContract,
  stableJson,
  contentHash,
  PROOF_NEED_CLASSES,
} = require("./shared");

const INPUT_PACKAGE_SCHEMA_VERSION = "user_material_tagger_input_package.v1";
const USER_MATERIAL_TAGGER_SHEET_PURPOSE = "user_material_tagger_shot_context";
const SHOT_SUBTITLE_TEXT_MAX_LENGTH = 240;
const SHOT_SUBTITLE_CONTEXT_MAX_LENGTH = 360;

function prepareInput(artifact, options = {}) {
  const runtimeRoot = options.runtimeRoot ?? null;
  const shotBoundary = artifact?.shotBoundaryAnalysis;
  const shots = Array.isArray(shotBoundary?.shots) ? shotBoundary.shots : [];
  if (!shots.length) {
    throw codedError("user_material_tagger_missing_shots", "当前样例没有可识别的切镜结果", null, false);
  }
  const frames = Array.isArray(artifact?.frames) ? artifact.frames : [];
  const normalizedShotWindows = shots.map((shot, index) => ({
    shotId: String(shot.id),
    shotNo: normalizeShotNo(shot.shotNo, index),
    start: normalizeNumber(shot.start, 0),
    end: normalizeNumber(shot.end, normalizeNumber(shot.start, 0)),
    summary: normalizeText(shot.summary ?? shot.reason ?? "镜头内容", 220),
    isLastShot: index === shots.length - 1,
  }));
  const shotSubtitleMap = buildShotSubtitleMap(normalizedShotWindows, artifact?.subtitles);
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

async function prepareInputPackage({ input, sampleDir, store }) {
  if (!sampleDir || !store) throw new Error("user material tagger input package missing sampleDir/store");
  const inputPackageDir = path.join(sampleDir, "user-material-tagger-input");
  await fs.mkdir(path.join(inputPackageDir, "sheets"), { recursive: true });

  const shotFramePages = planShotFramePages(input);
  const { visualManifest, visualAttachments } = await buildShotFrameVisualManifest({
    input,
    shotFramePages,
    sampleDir: inputPackageDir,
    store,
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    sheetPurpose: USER_MATERIAL_TAGGER_SHEET_PURPOSE,
  });
  const manifest = buildManifest(input, visualManifest);
  const metadata = buildMetadata(inputPackageDir, input);
  const lineage = buildLineage(input);
  const outputContract = buildOutputContract();
  const outputSkeleton = buildOutputSkeleton(input);

  const manifestPath = path.join(inputPackageDir, "manifest.json");
  const metadataPath = path.join(inputPackageDir, "metadata.json");
  const lineagePath = path.join(inputPackageDir, "lineage.json");
  const outputContractPath = path.join(inputPackageDir, "output-contract.json");
  const outputSkeletonPath = path.join(inputPackageDir, "output-skeleton.json");
  const visualManifestPath = path.join(inputPackageDir, "visual-manifest.json");
  await Promise.all([
    store.writeJson(manifestPath, manifest),
    store.writeJson(metadataPath, metadata),
    store.writeJson(lineagePath, lineage),
    store.writeJson(outputContractPath, outputContract),
    store.writeJson(outputSkeletonPath, outputSkeleton),
    store.writeJson(visualManifestPath, visualManifest),
  ]);

  const hashes = {
    manifestHash: contentHash(stableJson(manifest)),
    outputContractHash: contentHash(stableJson(outputContract)),
    outputSkeletonHash: contentHash(stableJson(outputSkeleton)),
    visualManifestHash: contentHash(stableJson(stripVisualManifestPaths(visualManifest))),
  };

  return sanitizeForAppServerText({
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    manifest,
    manifestPath,
    metadata,
    metadataPath,
    lineage,
    lineagePath,
    outputContract,
    outputContractPath,
    outputSkeleton,
    outputSkeletonPath,
    visualManifest,
    visualManifestPath,
    visualAttachments,
    sheetCount: visualManifest.sheetCount,
    emptyShotCount: visualManifest.emptyShotCount,
    hashes,
  });
}

function renderAnalyzeTurnInputs({ inputPackage, roleProfile }) {
  const prompt = renderTurnTemplate(roleProfile, "analyze", {
    inputSummaryText: buildInputSummaryText(inputPackage),
    manifestPath: inputPackage.manifestPath,
    outputContractPath: inputPackage.outputContractPath,
    outputSkeletonPath: inputPackage.outputSkeletonPath,
    visualManifestPath: inputPackage.visualManifestPath,
  });
  return buildTurnPayload(prompt, inputPackage);
}

function renderRepairTurnInputs({ inputPackage, validationError, priorTurnOutput, repairAttemptCount, roleProfile }) {
  const prompt = renderTurnTemplate(roleProfile, "repair", {
    repairAttemptCount,
    inputSummaryText: buildInputSummaryText(inputPackage),
    manifestPath: inputPackage.manifestPath,
    outputContractPath: inputPackage.outputContractPath,
    outputSkeletonPath: inputPackage.outputSkeletonPath,
    visualManifestPath: inputPackage.visualManifestPath,
    validationJson: stableJson(validationError?.debugPayload?.validation ?? { code: validationError?.code ?? null, message: validationError?.message ?? null }),
    priorOutputSummaryJson: stableJson({
      hasPriorOutput: Boolean(String(priorTurnOutput ?? "").trim()),
      outputLength: String(priorTurnOutput ?? "").trim().length,
    }),
  });
  return buildTurnPayload(prompt, inputPackage);
}

function buildTurnPayload(prompt, inputPackage) {
  const inputs = [{ type: "text", text: prompt.text, text_elements: [] }];
  for (const attachment of inputPackage.visualAttachments) {
    inputs.push({ type: "localImage", path: attachment.localImagePath });
  }
  return {
    ...prompt,
    inputs: sanitizeForAppServerText(inputs),
    manifest: inputPackage.manifest,
    metadata: inputPackage.metadata,
    lineage: inputPackage.lineage,
    outputContract: inputPackage.outputContract,
    outputSkeleton: inputPackage.outputSkeleton,
    visualManifest: inputPackage.visualManifest,
  };
}

function buildManifest(input, visualManifest = null) {
  return {
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    commerceBrief: input.commerceBrief,
    shotCount: input.shots.length,
    shots: input.shots,
    visualManifestSummary: {
      sheetCount: visualManifest?.sheetCount ?? 0,
      emptyShotCount: visualManifest?.emptyShotCount ?? 0,
    },
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
    sourceShotBoundaryArtifactId: input.parentArtifactId,
  };
}

function buildOutputSkeleton(input) {
  return {
    type: "user-material-pack",
    schemaVersion: "user-material-pack.stable",
    sampleVideoId: input.sampleVideoId,
    sourceArtifacts: {
      shotBoundaryAnalysis: {
        artifactId: input.parentArtifactId,
        shotCount: input.shots.length,
      },
    },
    semanticDictionaries: {
      entityDict: {},
      supportDict: {},
      guardrailDict: {},
    },
    shotCards: input.shots.map((shot) => ({
      shotRef: shot.shotId,
      shotNo: shot.shotNo,
      timeRange: { start: shot.start, end: shot.end },
      visualSummary: shot.summary,
      spokenOrSubtitleSummary: shot.subtitleText || shot.subtitleContextText || "",
      detectedEntityRefs: { products: [], people: [], scenes: [], objects: [], textSignals: [] },
      shotClass: "",
      shotFunctions: [],
      materialTags: [],
      proofAffordances: [],
      sequenceFit: {
        opening: { fit: "weak", reason: "", requiredSupportRefs: [] },
        middle: { fit: "weak", reason: "", requiredSupportRefs: [] },
        ending: { fit: "weak", reason: "", requiredSupportRefs: [] },
      },
      quality: {
        visualClarity: "unknown",
        stability: "unknown",
        subjectFocus: "unknown",
        audioUsefulness: shot.subtitleText || shot.subtitleContextText ? "medium" : "unknown",
        captionUsefulness: shot.subtitleText || shot.subtitleContextText ? "medium" : "none",
      },
      constraintRefs: [],
      confidence: 0.72,
      needReview: true,
    })),
    materialGroups: [],
    proofCoverage: buildProofCoverageSkeleton(),
    sequenceRecommendations: {
      openingCandidates: [],
      middleCandidates: [],
      endingCandidates: [],
    },
    globalConstraintRefs: [],
    restructureInputSummary: {
      strongMaterialAreas: [],
      weakMaterialAreas: [],
      missingMaterialAreas: [],
      recommendedUse: [],
      doNotUseForRefs: [],
      needsRestructureAttentionRefs: [],
    },
  };
}

function buildProofCoverageSkeleton() {
  return PROOF_NEED_CLASSES.map((proofNeedClass) => ({
    proofNeedClass,
    coverage: "unknown",
    candidateShots: [],
    candidateGroups: [],
    reason: "",
    safeUsageRefs: [],
    gapAdviceRefs: [],
  }));
}

function buildInputSummaryText(inputPackage) {
  const subtitleReadyShotCount = Array.isArray(inputPackage?.manifest?.shots)
    ? inputPackage.manifest.shots.filter((shot) => String(shot?.subtitleText ?? shot?.subtitleContextText ?? "").trim()).length
    : 0;
  return `本次包含 ${inputPackage.manifest.shotCount} 个镜头、${inputPackage.visualManifest.sheetCount} 个代表帧联表页、${inputPackage.visualManifest.emptyShotCount} 个缺代表帧镜头；其中 ${subtitleReadyShotCount} 个镜头附带对齐字幕。`;
}

function normalizeCommerceBrief(brief) {
  if (!brief || typeof brief !== "object") return null;
  return {
    sellingObject: normalizeText(brief.sellingObject, 160),
    proofApproach: normalizeText(brief.proofApproach, 160),
    promisedOutcome: normalizeText(brief.promisedOutcome, 160),
    persuasionTarget: normalizeText(brief.persuasionTarget, 160),
    conversionAction: normalizeText(brief.conversionAction, 160),
    uncertainties: normalizeStringArray(brief.uncertainties, 5),
  };
}

module.exports = {
  INPUT_PACKAGE_SCHEMA_VERSION,
  USER_MATERIAL_TAGGER_SHEET_PURPOSE,
  prepareInput,
  prepareInputPackage,
  renderAnalyzeTurnInputs,
  renderRepairTurnInputs,
  buildOutputSkeleton,
  buildInputSummaryText,
};
