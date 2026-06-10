const fs = require("fs/promises");
const path = require("path");

async function buildSlotLabelIndex({ baseDir, sourceBaseDir = baseDir }) {
  const index = new Map();
  for (const candidateDir of uniquePaths([baseDir, sourceBaseDir])) {
    const display = await readJsonIfExists(path.join(candidateDir, "restructure.display.json"));
    addSlotLabelsFromDisplay(display, index);
    if (index.size) break;
  }
  if (!index.size) {
    const finalText = await readTextFromFirstExisting(uniquePaths([baseDir, sourceBaseDir]).map((candidateDir) => path.join(candidateDir, "restructure.final.md")));
    addSlotLabelsFromMarkdown(finalText, index);
  }
  return index;
}

async function buildReadOnlyMaterialFrameIndex({ rootDir, baseDir, sourceBaseDir = baseDir, manifest }) {
  const index = new Map();
  const candidates = await collectMaterialFrameMapPaths({ rootDir, baseDir, sourceBaseDir });
  for (const filePath of candidates) {
    const value = await readJsonIfExists(filePath);
    if (!value) continue;
    await visitMaterialNode(value, rootDir, path.dirname(filePath), index);
    await addSourceFrameIndex(value, rootDir, path.dirname(filePath), index);
    addGroupAliases(value, index);
  }
  for (const shot of Array.isArray(manifest?.shots) ? manifest.shots : []) {
    const shotId = normalizeText(shot?.shotId);
    if (!shotId || shot?.shouldGenerate || index.has(shotId)) continue;
    const imagePath = firstResolvedMaterialFrame(shot, index);
    if (imagePath) index.set(shotId, imagePath);
  }
  return index;
}

function addSlotLabelsFromDisplay(display, index) {
  const items = display?.sections?.finalSlotChain?.items;
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!Array.isArray(item?.rows)) continue;
    for (const row of item.rows) {
      const raw = normalizeText(row?.slotSubtype);
      const parsed = parseSlotSubtypeLabel(raw);
      if (!parsed?.id || !parsed.title) continue;
      index.set(parsed.id, {
        id: parsed.id,
        order: normalizePositiveNumber(row?.["顺序"]) ?? index.size + 1,
        title: parsed.title,
      });
    }
  }
}

function addSlotLabelsFromMarkdown(text, index) {
  for (const line of normalizeText(text).split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2 || !/^\d+$/.test(cells[0])) continue;
    const parsed = parseSlotSubtypeLabel(cells[1]);
    if (!parsed?.id || !parsed.title) continue;
    index.set(parsed.id, {
      id: parsed.id,
      order: Number(cells[0]),
      title: parsed.title,
    });
  }
}

function parseSlotSubtypeLabel(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const id = extractSlotId(text);
  const title = text
    .replace(/`SUB_[^`]+`/g, "")
    .replace(/\bSUB_[A-Za-z0-9_.-]+\b/g, "")
    .trim();
  return { id, title };
}

async function collectMaterialFrameMapPaths({ rootDir, baseDir, sourceBaseDir = baseDir }) {
  const result = [];
  const candidates = [
    path.join(baseDir, "material-frame-map.json"),
    path.join(baseDir, "visual-manifest.json"),
    path.join(baseDir, "user-material-pack.stable.json"),
    path.join(baseDir, "user-material-pack.stable"),
    path.join(sourceBaseDir, "material-frame-map.json"),
    path.join(sourceBaseDir, "visual-manifest.json"),
    path.join(sourceBaseDir, "user-material-pack.stable.json"),
    path.join(sourceBaseDir, "user-material-pack.stable"),
  ];
  const restructureText = await readTextFromFirstExisting(uniquePaths([baseDir, sourceBaseDir]).map((candidateDir) => path.join(candidateDir, "restructure.final.md")));
  const matches = restructureText.matchAll(/`([^`]*(?:user-material-pack|material-frame-map|visual-manifest)[^`]*)`/gi);
  for (const match of matches) {
    const resolved = resolveMediaPath(rootDir, match[1]);
    if (resolved) candidates.push(resolved);
  }
  for (const candidate of candidates) {
    const resolved = resolveInsideRoot(rootDir, candidate);
    if (!resolved || result.includes(resolved)) continue;
    if (await pathExists(resolved)) result.push(resolved);
  }
  return result;
}

async function visitMaterialNode(value, rootDir, baseDir, index) {
  if (Array.isArray(value)) {
    for (const item of value) await visitMaterialNode(item, rootDir, baseDir, index);
    return;
  }
  if (!value || typeof value !== "object") return;
  const ref = firstText([value.shotRef, value.sourceShotRef, value.shotId, value.id, value.groupId]);
  const imagePath = resolveMediaPath(rootDir, firstImageValue(value), baseDir);
  if (ref && imagePath && await pathExists(imagePath)) index.set(ref, imagePath);
  for (const child of Object.values(value)) {
    await visitMaterialNode(child, rootDir, baseDir, index);
  }
}

async function addSourceFrameIndex(value, rootDir, baseDir, index) {
  if (!value || typeof value !== "object") return;
  const sampleArtifact = await loadSampleArtifact(value, rootDir, baseDir);
  const frames = Array.isArray(sampleArtifact?.frames) ? sampleArtifact.frames : [];
  const shotCards = Array.isArray(value.shotCards) ? value.shotCards : [];
  for (const card of shotCards) {
    if (!card || typeof card !== "object") continue;
    const ref = normalizeText(card.shotRef || card.shotId);
    if (!ref || index.has(ref)) continue;
    const timestamp = representativeTimestampForCard(card);
    const frame = closestFrame(frames, timestamp);
    const imagePath = resolveMediaPath(rootDir, firstImageValue(frame), baseDir);
    if (imagePath && await pathExists(imagePath)) index.set(ref, imagePath);
  }
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

function firstResolvedMaterialFrame(shot, materialFrameIndex) {
  const refs = collectShotRefs(shot);
  const resolvedRef = refs.find((ref) => materialFrameIndex.has(ref));
  return resolvedRef ? materialFrameIndex.get(resolvedRef) : null;
}

function collectShotRefs(shot) {
  const refs = new Set();
  for (const value of [
    shot?.shotRef,
    shot?.sourceShotRef,
    shot?.materialShotRef,
    shot?.groupId,
    shot?.sourceGroupId,
    shot?.shotId,
  ]) {
    const text = normalizeText(value);
    if (text) refs.add(text);
  }
  for (const key of ["sourceRefs", "shotRefs", "materialRefs"]) {
    const values = Array.isArray(shot?.[key]) ? shot[key] : [];
    values.map((item) => normalizeText(item)).filter(Boolean).forEach((item) => refs.add(item));
  }
  return Array.from(refs);
}

function firstImageValue(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  for (const key of ["representativeFrame", "representativeFramePath", "representativeFrameLocalPath", "localImagePath", "imagePath", "filePath", "framePath", "path", "uri", "imageUri"]) {
    const found = firstImageValue(value[key]);
    if (found) return found;
  }
  return null;
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
    const resolved = resolveMediaPath(rootDir, explicit, baseDir);
    return resolved ? readJsonIfExists(resolved) : null;
  }
  const sampleVideoId = normalizeText(value?.sampleVideoId);
  if (!sampleVideoId) return null;
  return readJsonIfExists(path.join(rootDir, "Runtime", "Artifacts", sampleVideoId, "artifact.json"));
}

function representativeTimestampForCard(card) {
  const visualRef = card?.visualRef && typeof card.visualRef === "object" ? card.visualRef : {};
  for (const key of ["representativeFrameTimestamp", "middleTimestamp", "timestamp"]) {
    const value = normalizeNumber(visualRef[key]);
    if (value != null) return value;
  }
  return null;
}

function closestFrame(frames, timestamp) {
  if (!Array.isArray(frames) || timestamp == null) return null;
  let best = null;
  let bestDistance = null;
  for (const frame of frames) {
    const frameTimestamp = normalizeNumber(frame?.timestamp);
    if (frameTimestamp == null) continue;
    const distance = Math.abs(frameTimestamp - timestamp);
    if (best == null || bestDistance == null || distance < bestDistance) {
      best = frame;
      bestDistance = distance;
    }
  }
  return best;
}

function firstText(values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return null;
}

function extractSlotId(value) {
  const text = normalizeText(value);
  const match = /`?(SUB_[A-Za-z0-9_.-]+)`?/u.exec(text);
  return match?.[1] ?? null;
}

function resolveMediaPath(rootDir, value, baseDir = rootDir) {
  const text = normalizeText(value);
  if (!text) return null;
  let resolved;
  const normalized = text.replaceAll("\\", "/");
  if (normalized.startsWith("/runtime/")) {
    resolved = path.join(rootDir, "Runtime", normalized.slice("/runtime/".length));
  } else if (normalized.startsWith("runtime/")) {
    resolved = path.join(rootDir, "Runtime", normalized.slice("runtime/".length));
  } else if (path.isAbsolute(text) || /^[A-Za-z]:[\\/]/.test(text)) {
    resolved = path.resolve(text);
  } else {
    resolved = path.resolve(baseDir, text);
    if (!isInside(resolved, rootDir)) resolved = path.resolve(rootDir, text);
  }
  return isInside(resolved, rootDir) ? resolved : null;
}

function resolveInsideRoot(rootDir, value) {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = text.replaceAll("\\", "/");
  const resolved = path.resolve(rootDir, normalized);
  return isInside(resolved, rootDir) ? resolved : null;
}

function isInside(filePath, rootPath) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(rootPath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function readTextFromFirstExisting(filePaths) {
  for (const filePath of filePaths) {
    const text = await readTextIfExists(filePath);
    if (text) return text;
  }
  return "";
}

function uniquePaths(values) {
  return Array.from(new Set(values.filter(Boolean).map((item) => path.resolve(item))));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePositiveNumber(value) {
  const number = normalizeNumber(value);
  return number && number > 0 ? number : null;
}

module.exports = {
  buildReadOnlyMaterialFrameIndex,
  buildSlotLabelIndex,
  firstResolvedMaterialFrame,
};
