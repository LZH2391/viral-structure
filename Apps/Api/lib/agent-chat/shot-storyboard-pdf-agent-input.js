const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");
const { normalizeText, readJson } = require("./shot-storyboard-pipeline-utils");
const {
  PDF_INPUT_SCHEMA,
  PDF_LAYOUT_SCHEMA,
  PDF_STAGE_NAME,
  PDF_SUMMARY_SCHEMA,
  collectShotRefs,
  resolvePathOrUri,
  summarizeManifest,
} = require("./shot-storyboard-pdf-agent-shared");
const { buildMaterialFrameIndex } = require("./shot-storyboard-pdf-agent-materials");

async function buildPdfAgentInputPackage({
  rootDir,
  resolved,
  prepare,
  crop,
  options,
  traceContext,
  artifactId,
  parentArtifactId,
  materialFrameMaps,
  resolveInsideRoot,
  safeRelative,
  now = () => new Date().toISOString(),
  retryContext = null,
} = {}) {
  const cropManifest = await readJson(crop.cropsManifestPath);
  const cropIndex = new Map((cropManifest.crops ?? []).map((item) => [item.shotId, item]));
  const materialFrameDir = path.join(resolved.baseDir, "shot-storyboard-material-frames");
  const materialFrameIndex = await buildMaterialFrameIndex({
    files: materialFrameMaps,
    rootDir,
    resolveInsideRoot,
    outputDir: materialFrameDir,
  });
  const packageWarnings = [];
  const shots = [];
  for (const shot of prepare.manifest.shots ?? []) {
    const shotId = normalizeText(shot.shotId);
    if (!shotId) continue;
    const generated = Boolean(shot.shouldGenerate);
    const media = generated
      ? await buildGeneratedMedia({ shotId, cropItem: cropIndex.get(shotId), packageWarnings })
      : await buildMaterialMedia({ shot, shotId, materialFrameIndex, packageWarnings });
    shots.push({
      shotId,
      slotKey: normalizeText(shot.slotKey) ?? normalizeText(shot.slotSubtype) ?? "unknown_slot",
      slotSubtype: normalizeText(shot.slotSubtype),
      mediaKind: media.mediaKind,
      imagePath: media.imagePath ? safeRelative(media.imagePath) : null,
      width: media.width,
      height: media.height,
      imageFit: "contain",
      sourceRefs: collectShotRefs(shot),
      shouldGenerate: generated,
      warnings: media.warnings,
    });
  }

  const referenceSvgPath = await findReferenceSvgPath({ rootDir, resolved, options, resolveInsideRoot });
  const pdfPath = path.join(resolved.baseDir, "shot-storyboard.pdf");
  const summaryPath = path.join(resolved.baseDir, "shot-storyboard.summary.json");
  const layoutPath = path.join(resolved.baseDir, "shot-storyboard.layout.json");
  const inputPackagePath = path.join(resolved.baseDir, "shot-storyboard-pdf-input.json");
  const inputPackage = {
    type: "shot-storyboard-pdf-input",
    schemaVersion: PDF_INPUT_SCHEMA,
    createdAt: now(),
    stageName: PDF_STAGE_NAME,
    trace: {
      runId: traceContext.runId,
      traceId: traceContext.traceId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId,
    },
    source: {
      restructureFinalPath: safeRelative(resolved.restructureFinalPath),
      shotDesignFinalPath: safeRelative(resolved.shotDesignFinalPath),
      manifestPath: safeRelative(prepare.manifestPath),
      cropsManifestPath: safeRelative(crop.cropsManifestPath),
      referenceSvgPath: referenceSvgPath ? safeRelative(referenceSvgPath) : null,
      materialFrameMapPaths: materialFrameMaps.map((item) => safeRelative(item.path)),
    },
    outputContract: {
      pdfPath: safeRelative(pdfPath),
      summaryPath: safeRelative(summaryPath),
      layoutPath: safeRelative(layoutPath),
      summarySchemaVersion: PDF_SUMMARY_SCHEMA,
      layoutSchemaVersion: PDF_LAYOUT_SCHEMA,
      requiredLayoutFields: ["schemaVersion", "pageCount", "slots", "shots", "warnings"],
      requiredShotFields: ["shotId", "pageIndex", "mediaKind", "imageFit"],
      imageFit: "contain",
    },
    hardConstraints: [
      "必须使用 $pdf skill。",
      "不得重跑 image-generation。",
      "不得修改 restructure.final.md、shot-design.final.md、manifest 或 crops manifest。",
      "不得重新裁切图片。",
      "所有图片必须以 contain 方式放入版面。",
      "素材代表帧缺失时只能写入 warnings，不得伪造图片。",
    ],
    retryContext,
    manifestSummary: summarizeManifest(prepare.manifest),
    expectedWarnings: {
      materialFrameMissingShotIds: shots
        .filter((shot) => shot.mediaKind === "material-frame-missing")
        .map((shot) => shot.shotId),
    },
    manifest: prepare.manifest,
    cropsManifest: cropManifest,
    shots,
    warnings: packageWarnings,
  };
  await fs.writeFile(inputPackagePath, `${JSON.stringify(inputPackage, null, 2)}\n`, "utf8");
  return {
    inputPackage,
    inputPackagePath,
    pdfPath,
    summaryPath,
    layoutPath,
  };
}

async function buildGeneratedMedia({ shotId, cropItem, packageWarnings }) {
  if (!cropItem?.path) {
    packageWarnings.push(`${shotId}: 自设计镜头缺少裁切帧`);
    return { mediaKind: "generated-image-missing", imagePath: null, width: null, height: null, warnings: ["missing_generated_crop"] };
  }
  const metadata = await readImageMetadata(cropItem.path);
  return {
    mediaKind: "generated-image",
    imagePath: cropItem.path,
    width: metadata.width,
    height: metadata.height,
    warnings: [],
  };
}

async function buildMaterialMedia({ shot, shotId, materialFrameIndex, packageWarnings }) {
  const refs = collectShotRefs(shot);
  const resolvedRef = refs.find((ref) => materialFrameIndex.has(ref));
  if (!resolvedRef) {
    packageWarnings.push(`${shotId}: 素材镜头缺少代表帧 sourceRefs=${JSON.stringify(refs)}`);
    return { mediaKind: "material-frame-missing", imagePath: null, width: null, height: null, warnings: ["missing_material_frame"] };
  }
  const imagePath = materialFrameIndex.get(resolvedRef);
  const metadata = await readImageMetadata(imagePath);
  return {
    mediaKind: "material-frame",
    imagePath,
    width: metadata.width,
    height: metadata.height,
    warnings: [],
  };
}

async function readImageMetadata(filePath) {
  try {
    const metadata = await sharp(filePath).metadata();
    return {
      width: Number.isFinite(metadata.width) ? metadata.width : null,
      height: Number.isFinite(metadata.height) ? metadata.height : null,
    };
  } catch {
    return { width: null, height: null };
  }
}

async function findReferenceSvgPath({ rootDir, resolved, options, resolveInsideRoot }) {
  const candidates = [
    normalizeText(options?.referenceSvgPath),
    path.join(resolved.baseDir, "pdf.svg"),
    path.join(rootDir, "Runtime", "Temp", "pdf.svg"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolvedCandidate = resolveInsideRoot(candidate);
    if (!resolvedCandidate) continue;
    try {
      await fs.access(resolvedCandidate);
      return resolvedCandidate;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

module.exports = {
  buildPdfAgentInputPackage,
};
