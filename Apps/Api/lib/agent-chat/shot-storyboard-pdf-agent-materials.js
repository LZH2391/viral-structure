const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");
const { assertFile, normalizeText, readJson } = require("./shot-storyboard-pipeline-utils");
const {
  firstText,
  resolvePathOrUri,
  safeFilename,
  toInteger,
  toNumber,
} = require("./shot-storyboard-pdf-agent-shared");

const CONTACT_SHEET_LABEL_HEIGHT = 28;
const DIRECT_IMAGE_KEYS = [
  "representativeFrame",
  "representativeFramePath",
  "representativeFrameLocalPath",
  "localImagePath",
  "imagePath",
  "filePath",
  "framePath",
  "path",
  "uri",
  "imageUri",
];

async function buildMaterialFrameIndex({ files, rootDir, resolveInsideRoot, outputDir }) {
  const index = new Map();
  for (const file of files) {
    const resolvedFile = resolveInsideRoot(file.path);
    if (!resolvedFile) continue;
    try {
      await assertFile(resolvedFile, "storyboard_prep_material_frame_map_missing", file.required);
    } catch (error) {
      if (file.required) throw error;
      continue;
    }
    const value = await readJson(resolvedFile);
    await visitMaterialNode(value, rootDir, path.dirname(resolvedFile), index);
    const visualManifest = await loadVisualManifest(value, rootDir, path.dirname(resolvedFile));
    await addSourceFrameIndex(value, rootDir, path.dirname(resolvedFile), visualManifest, index);
    await addVisualRefIndex(value, rootDir, path.dirname(resolvedFile), visualManifest, outputDir, index);
    addGroupAliases(value, index);
  }
  return index;
}

function firstImageValue(value) {
  if (!value || typeof value !== "object") return typeof value === "string" ? value : null;
  for (const key of DIRECT_IMAGE_KEYS) {
    const found = nestedImageValue(value[key]);
    if (found) return found;
  }
  return null;
}

function nestedImageValue(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  for (const key of DIRECT_IMAGE_KEYS) {
    const found = nestedImageValue(value[key]);
    if (found) return found;
  }
  return null;
}

async function visitMaterialNode(value, rootDir, baseDir, index) {
  if (Array.isArray(value)) {
    for (const item of value) await visitMaterialNode(item, rootDir, baseDir, index);
    return;
  }
  if (!value || typeof value !== "object") return;
  const ref = firstText([value.shotRef, value.sourceShotRef, value.shotId, value.id, value.groupId]);
  const imagePath = firstImageValue(value);
  const resolved = resolvePathOrUri(imagePath, rootDir, baseDir);
  if (ref && resolved && await pathExists(resolved)) index.set(ref, resolved);
  for (const child of Object.values(value)) {
    await visitMaterialNode(child, rootDir, baseDir, index);
  }
}

async function addSourceFrameIndex(value, rootDir, baseDir, visualManifest, index) {
  if (!value || typeof value !== "object") return;
  const sampleArtifact = await loadSampleArtifact(value, rootDir, baseDir);
  const frames = Array.isArray(sampleArtifact?.frames) ? sampleArtifact.frames : [];
  const shotCards = Array.isArray(value.shotCards) ? value.shotCards : [];
  for (const card of shotCards) {
    if (!card || typeof card !== "object") continue;
    const ref = normalizeText(card.shotRef || card.shotId);
    if (!ref || index.has(ref)) continue;
    const timestamp = representativeTimestampForCard(card, visualManifest);
    const frame = closestFrame(frames, timestamp);
    const imagePath = resolvePathOrUri(firstImageValue(frame), rootDir, baseDir);
    if (imagePath && await pathExists(imagePath)) index.set(ref, imagePath);
  }
}

async function addVisualRefIndex(value, rootDir, baseDir, visualManifest, outputDir, index) {
  if (!value || typeof value !== "object") return;
  const shotCards = Array.isArray(value.shotCards) ? value.shotCards : [];
  if (!visualManifest || !shotCards.length) return;
  const sheetPaths = await resolveSheetPaths(value, visualManifest, rootDir, baseDir);
  for (const card of shotCards) {
    if (!card || typeof card !== "object") continue;
    const ref = normalizeText(card.shotRef || card.shotId);
    if (!ref || index.has(ref)) continue;
    const pathResolved = await cropVisualRef({
      ref,
      visualRef: card.visualRef,
      visualManifest,
      sheetPaths,
      outputDir,
    });
    if (pathResolved) index.set(ref, pathResolved);
  }
}

async function loadVisualManifest(value, rootDir, baseDir) {
  if (Array.isArray(value?.sheets) && Array.isArray(value?.shotSheets)) return value;
  const inputPackage = value?.inputPackage && typeof value.inputPackage === "object" ? value.inputPackage : {};
  const candidate = normalizeText(inputPackage.visualManifestPath || value?.visualManifestPath);
  const resolved = resolvePathOrUri(candidate, rootDir, baseDir);
  return resolved ? readJson(resolved) : null;
}

async function loadSampleArtifact(value, rootDir, baseDir) {
  const sourceArtifacts = value?.sourceArtifacts && typeof value.sourceArtifacts === "object" ? value.sourceArtifacts : {};
  const explicit = normalizeText(
    value?.sourceSampleArtifactPath
      || value?.sampleArtifactPath
      || sourceArtifacts.sampleArtifactPath
      || sourceArtifacts.sampleVideoArtifactPath,
  );
  if (explicit) {
    const resolved = resolvePathOrUri(explicit, rootDir, baseDir);
    if (resolved) return readJson(resolved);
  }
  const sampleVideoId = normalizeText(value?.sampleVideoId);
  if (!sampleVideoId) return null;
  const candidate = path.join(rootDir, "Runtime", "Artifacts", sampleVideoId, "artifact.json");
  try {
    await fs.access(candidate);
    return readJson(candidate);
  } catch {
    return null;
  }
}

function representativeTimestampForCard(card, visualManifest) {
  const visualRef = card?.visualRef && typeof card.visualRef === "object" ? card.visualRef : {};
  for (const key of ["representativeFrameTimestamp", "middleTimestamp", "timestamp"]) {
    const value = toNumber(visualRef[key]);
    if (value != null) return value;
  }
  const ref = normalizeText(card?.shotRef || card?.shotId);
  const sheetId = normalizeText(visualRef.sheetId);
  const cell = ref && sheetId ? findVisualCell(visualManifest, sheetId, ref) : null;
  if (!cell) return null;
  for (const key of ["representativeFrameTimestamp", "middleTimestamp", "start"]) {
    const value = toNumber(cell[key]);
    if (value != null) return value;
  }
  return null;
}

function closestFrame(frames, timestamp) {
  if (!Array.isArray(frames) || timestamp == null) return null;
  let best = null;
  let bestDistance = null;
  for (const frame of frames) {
    const frameTimestamp = toNumber(frame?.timestamp);
    if (frameTimestamp == null) continue;
    const distance = Math.abs(frameTimestamp - timestamp);
    if (best == null || bestDistance == null || distance < bestDistance) {
      best = frame;
      bestDistance = distance;
    }
  }
  return best;
}

async function resolveSheetPaths(value, visualManifest, rootDir, baseDir) {
  const result = new Map();
  const inputPackage = value?.inputPackage && typeof value.inputPackage === "object" ? value.inputPackage : {};
  const attachments = Array.isArray(inputPackage.visualAttachments)
    ? inputPackage.visualAttachments
    : Array.isArray(value?.visualAttachments)
      ? value.visualAttachments
      : [];
  for (const attachment of attachments) {
    const sheetId = normalizeText(attachment?.sheetId);
    const resolved = resolvePathOrUri(firstImageValue(attachment), rootDir, baseDir);
    if (sheetId && resolved) result.set(sheetId, resolved);
  }
  const manifestDir = await resolveVisualManifestDir(value, rootDir, baseDir);
  for (const sheet of visualManifest?.sheets ?? []) {
    const sheetId = normalizeText(sheet?.sheetId);
    if (!sheetId || result.has(sheetId)) continue;
    const candidate = path.join(manifestDir, "sheets", `${sheetId}.jpg`);
    try {
      await fs.access(candidate);
      result.set(sheetId, candidate);
    } catch {
      // Ignore missing fallback sheet images.
    }
  }
  return result;
}

async function resolveVisualManifestDir(value, rootDir, baseDir) {
  const inputPackage = value?.inputPackage && typeof value.inputPackage === "object" ? value.inputPackage : {};
  const candidate = normalizeText(inputPackage.visualManifestPath || value?.visualManifestPath);
  const resolved = resolvePathOrUri(candidate, rootDir, baseDir);
  return resolved ? path.dirname(resolved) : baseDir;
}

async function cropVisualRef({ ref, visualRef, visualManifest, sheetPaths, outputDir }) {
  const refValue = normalizeText(ref);
  if (!refValue || !visualManifest || !visualRef || typeof visualRef !== "object") return null;
  let sheetId = normalizeText(visualRef.sheetId);
  let row = toInteger(visualRef.row);
  let col = toInteger(visualRef.col);
  const cell = sheetId ? findVisualCell(visualManifest, sheetId, refValue) : findAnyVisualCell(visualManifest, refValue);
  if (!sheetId && cell?.sheetId) sheetId = normalizeText(cell.sheetId);
  if (row == null && cell) row = toInteger(cell.row);
  if (col == null && cell) col = toInteger(cell.col);
  if (!sheetId || row == null || col == null) return null;
  const sheetPath = sheetPaths.get(sheetId);
  if (!sheetPath) return null;
  const { cols, rows } = inferSheetGrid(visualManifest, sheetId);
  if (cols <= 0 || rows <= 0) return null;
  const metadata = await sharp(sheetPath).metadata().catch(() => null);
  if (!metadata?.width || !metadata?.height) return null;
  const cellWidth = metadata.width / cols;
  const cellHeight = metadata.height / rows;
  const left = Math.round(col * cellWidth);
  const top = Math.round(row * cellHeight);
  const right = Math.round((col + 1) * cellWidth);
  const bottom = Math.round((row + 1) * cellHeight - CONTACT_SHEET_LABEL_HEIGHT);
  if (right <= left || bottom <= top) return null;
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${safeFilename(refValue)}.png`);
  await sharp(sheetPath)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toFile(outputPath);
  return outputPath;
}

function findVisualCell(visualManifest, sheetId, ref) {
  for (const sheet of visualManifest?.sheets ?? []) {
    if (normalizeText(sheet?.sheetId) !== sheetId) continue;
    for (const cell of sheet?.cells ?? []) {
      if (normalizeText(cell?.shotId || cell?.shotRef) === ref) return { ...cell, sheetId };
    }
  }
  return null;
}

function findAnyVisualCell(visualManifest, ref) {
  for (const sheet of visualManifest?.sheets ?? []) {
    for (const cell of sheet?.cells ?? []) {
      if (normalizeText(cell?.shotId || cell?.shotRef) === ref) {
        return { ...cell, sheetId: normalizeText(sheet?.sheetId) };
      }
    }
  }
  return null;
}

function inferSheetGrid(visualManifest, sheetId) {
  const sheet = (visualManifest?.sheets ?? []).find((item) => normalizeText(item?.sheetId) === sheetId);
  const cells = Array.isArray(sheet?.cells) ? sheet.cells : [];
  const cols = cells.reduce((max, cell) => Math.max(max, toInteger(cell?.col) ?? 0), 0) + 1;
  const rows = cells.reduce((max, cell) => Math.max(max, toInteger(cell?.row) ?? 0), 0) + 1;
  return { cols, rows };
}

function addGroupAliases(value, index) {
  if (Array.isArray(value)) {
    value.forEach((item) => addGroupAliases(item, index));
    return;
  }
  if (!value || typeof value !== "object") return;
  const groupId = normalizeText(value.groupId);
  const shotRefs = Array.isArray(value.shotRefs) ? value.shotRefs.map((item) => normalizeText(item)).filter(Boolean) : [];
  if (groupId && !index.has(groupId)) {
    for (const ref of shotRefs) {
      if (index.has(ref)) {
        index.set(groupId, index.get(ref));
        break;
      }
    }
  }
  Object.values(value).forEach((child) => addGroupAliases(child, index));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  buildMaterialFrameIndex,
};
