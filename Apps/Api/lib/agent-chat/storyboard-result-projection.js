const fs = require("fs/promises");
const path = require("path");

async function buildStoryboardResultProjection({ rootDir, conversation, imageBasePath }) {
  const confirmedPlan = conversation?.confirmedPlan ?? null;
  const baseDir = resolveStoryboardBaseDir(rootDir, confirmedPlan);
  if (!conversation || !baseDir) {
    return buildMissingProjection(conversation, "storyboard_source_missing");
  }

  const manifestPath = path.join(baseDir, "shot-storyboard-manifest.json");
  const cropsPath = path.join(baseDir, "shot-storyboard-frames", "shot-storyboard-crops.json");
  const manifest = await readJsonIfExists(manifestPath);
  const cropsManifest = await readJsonIfExists(cropsPath);
  const shots = Array.isArray(manifest?.shots) ? manifest.shots : [];
  if (!manifest || !shots.length) {
    return buildMissingProjection(conversation, "storyboard_manifest_missing");
  }

  const cropByShotId = new Map();
  for (const crop of Array.isArray(cropsManifest?.crops) ? cropsManifest.crops : []) {
    if (!crop?.shotId || crop.isCover) continue;
    const imagePath = resolveCropPath(rootDir, baseDir, crop.path, crop.shotId);
    cropByShotId.set(String(crop.shotId), {
      ...crop,
      imagePath,
    });
  }

  const aspect = resolveAspect(manifest?.aspect, null);
  const groups = buildGroups({
    shots,
    cropByShotId,
    manifestAspect: aspect,
    imageBasePath,
  });

  return {
    ok: true,
    status: groups.length ? "available" : "missing",
    reason: groups.length ? null : "storyboard_shots_missing",
    conversationId: conversation.conversationId ?? null,
    title: conversation.title ?? null,
    aspect,
    source: {
      manifestPath: safeRelative(rootDir, manifestPath),
      cropsPath: cropsManifest ? safeRelative(rootDir, cropsPath) : null,
      traceId: cropsManifest?.source?.traceId ?? confirmedPlan?.traceId ?? conversation.traceId ?? null,
      artifactId: cropsManifest?.source?.artifactId ?? confirmedPlan?.storyboardArtifact?.artifactId ?? null,
      parentArtifactId: cropsManifest?.source?.parentArtifactId ?? null,
    },
    groups,
  };
}

async function resolveStoryboardImagePath({ rootDir, conversation, shotId }) {
  const safeShotId = normalizeShotId(shotId);
  if (!safeShotId) return null;
  const baseDir = resolveStoryboardBaseDir(rootDir, conversation?.confirmedPlan ?? null);
  if (!baseDir) return null;
  const manifestPath = path.join(baseDir, "shot-storyboard-manifest.json");
  const cropsPath = path.join(baseDir, "shot-storyboard-frames", "shot-storyboard-crops.json");
  const manifest = await readJsonIfExists(manifestPath);
  const cropsManifest = await readJsonIfExists(cropsPath);
  const knownShot = Array.isArray(manifest?.shots) && manifest.shots.some((shot) => String(shot?.shotId ?? "") === safeShotId);
  if (!knownShot) return null;
  const crop = (Array.isArray(cropsManifest?.crops) ? cropsManifest.crops : []).find((item) => String(item?.shotId ?? "") === safeShotId);
  if (!crop) return null;
  return resolveCropPath(rootDir, baseDir, crop.path, crop.shotId);
}

function buildGroups({ shots, cropByShotId, manifestAspect, imageBasePath }) {
  const groups = [];
  const groupByKey = new Map();
  shots.forEach((shot, shotIndex) => {
    const shotId = String(shot?.shotId ?? "").trim();
    if (!shotId) return;
    const groupKey = resolveGroupKey(shot?.slotKey, shot?.slotSubtype, shotIndex);
    let group = groupByKey.get(groupKey);
    if (!group) {
      group = {
        id: `sub_${groups.length + 1}_${groupKey}`,
        label: `SUB ${groups.length + 1}`,
        key: groupKey,
        title: formatGroupTitle(groupKey),
        shotCount: 0,
        shots: [],
      };
      groupByKey.set(groupKey, group);
      groups.push(group);
    }
    const crop = cropByShotId.get(shotId) ?? null;
    const shotAspect = resolveAspect(null, crop?.cropBox) ?? manifestAspect;
    const strategy = normalizeText(shot.strategyRaw) || normalizeText(shot.strategy);
    const shouldGenerate = Boolean(shot.shouldGenerate);
    group.shots.push({
      id: shotId,
      index: shotIndex + 1,
      title: shotId,
      duration: normalizeText(shot.duration),
      dialogue: normalizeDialogue(shot.dialogue),
      strategy,
      sourceRefs: Array.isArray(shot.sourceRefs) ? shot.sourceRefs.map((item) => String(item)).filter(Boolean) : [],
      kind: shouldGenerate ? "generated" : "material",
      kindLabel: shouldGenerate ? "自设计" : "素材",
      imageUrl: crop?.imagePath ? `${imageBasePath}/images/${encodeURIComponent(shotId)}` : null,
      aspect: shotAspect,
    });
    group.shotCount = group.shots.length;
  });
  return groups;
}

function resolveGroupKey(slotKey, slotSubtype, index) {
  const source = normalizeText(slotKey) || normalizeText(slotSubtype);
  const first = source.split("->")[0]?.trim() || `segment_${index + 1}`;
  return first.replace(/^`|`$/g, "").replace(/^SUB_/, "").replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function formatGroupTitle(key) {
  return normalizeText(key).replace(/^SUB_/, "") || "segment";
}

function resolveAspect(aspectValue, cropBox) {
  const cropAspect = resolveAspectFromCropBox(cropBox);
  if (cropAspect) return cropAspect;
  const ratio = normalizeText(aspectValue?.ratio);
  if (ratio === "16:9") return { ratio: "16:9", orientation: "landscape", css: "16 / 9" };
  if (ratio === "9:16") return { ratio: "9:16", orientation: "portrait", css: "9 / 16" };
  const orientation = normalizeText(aspectValue?.orientation || aspectValue?.source);
  if (orientation.includes("横")) return { ratio: "16:9", orientation: "landscape", css: "16 / 9" };
  return { ratio: "9:16", orientation: "portrait", css: "9 / 16" };
}

function resolveAspectFromCropBox(cropBox) {
  if (!Array.isArray(cropBox) || cropBox.length < 4) return null;
  const width = Number(cropBox[2]) - Number(cropBox[0]);
  const height = Number(cropBox[3]) - Number(cropBox[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (width >= height) return { ratio: "16:9", orientation: "landscape", css: "16 / 9" };
  return { ratio: "9:16", orientation: "portrait", css: "9 / 16" };
}

function normalizeDialogue(value) {
  return normalizeText(value)
    .replace(/^(后期字幕\/旁白|旁白\/主字幕|旁白|主字幕|字幕)[:：]\s*/u, "")
    .replace(/^["“]|["”]$/g, "");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeShotId(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9_.-]+$/.test(text) ? text : null;
}

function resolveStoryboardBaseDir(rootDir, confirmedPlan) {
  const shotDesignPath = resolveInsideRoot(rootDir, confirmedPlan?.sourceShotDesignPath);
  if (shotDesignPath) return path.dirname(shotDesignPath);
  const restructurePath = resolveInsideRoot(rootDir, confirmedPlan?.sourceRestructurePath);
  return restructurePath ? path.dirname(restructurePath) : null;
}

function resolveCropPath(rootDir, baseDir, cropPath, shotId) {
  const safeShotId = normalizeShotId(shotId);
  const fallback = safeShotId ? path.join(baseDir, "shot-storyboard-frames", `${safeShotId}.png`) : null;
  const resolved = resolveInsideRoot(rootDir, cropPath) ?? fallback;
  if (!resolved) return null;
  const framesDir = path.join(baseDir, "shot-storyboard-frames");
  return isInside(resolved, framesDir) ? resolved : null;
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

function safeRelative(rootDir, filePath) {
  return filePath ? path.relative(rootDir, path.resolve(filePath)).replaceAll(path.sep, "/") : null;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function buildMissingProjection(conversation, reason) {
  return {
    ok: true,
    status: "missing",
    reason,
    conversationId: conversation?.conversationId ?? null,
    title: conversation?.title ?? null,
    aspect: null,
    source: null,
    groups: [],
  };
}

module.exports = {
  buildStoryboardResultProjection,
  resolveStoryboardImagePath,
};
