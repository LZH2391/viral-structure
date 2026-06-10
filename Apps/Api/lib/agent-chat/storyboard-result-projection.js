const fs = require("fs/promises");
const path = require("path");
const {
  buildReadOnlyMaterialFrameIndex,
  buildSlotLabelIndex,
  firstResolvedMaterialFrame,
} = require("./storyboard-result-materials");

async function buildStoryboardResultProjection({ rootDir, conversation, imageBasePath, imageQuery = null, storyboardResult = null, versionId = null }) {
  const originalPlan = storyboardResult ?? conversation?.confirmedPlan ?? null;
  const versionSelection = selectStoryboardVersion(originalPlan, versionId);
  const confirmedPlan = versionSelection.plan;
  const baseDir = await resolveStoryboardBaseDir(rootDir, confirmedPlan);
  if (!conversation || !baseDir) {
    return { ...buildMissingProjection(conversation, "storyboard_source_missing"), versions: versionSelection.versions, defaultVersionId: versionSelection.defaultVersionId, selectedVersionId: versionSelection.selectedVersionId };
  }

  const manifestPath = path.join(baseDir, "shot-storyboard-manifest.json");
  const cropsPath = path.join(baseDir, "shot-storyboard-frames", "shot-storyboard-crops.json");
  const pdfInputPath = path.join(baseDir, "shot-storyboard-pdf-input.json");
  const manifest = await readJsonIfExists(manifestPath);
  const cropsManifest = await readJsonIfExists(cropsPath);
  const pdfInput = await readJsonIfExists(pdfInputPath);
  const shots = Array.isArray(manifest?.shots) ? manifest.shots : [];
  if (!manifest || !shots.length) {
    return { ...buildMissingProjection(conversation, "storyboard_manifest_missing"), versions: versionSelection.versions, defaultVersionId: versionSelection.defaultVersionId, selectedVersionId: versionSelection.selectedVersionId };
  }

  const cropByShotId = new Map();
  let coverCrop = null;
  for (const crop of Array.isArray(cropsManifest?.crops) ? cropsManifest.crops : []) {
    if (!crop?.shotId) continue;
    const imagePath = resolveCropPath(rootDir, baseDir, crop.path, crop.shotId);
    if (crop.isCover || String(crop.shotId) === normalizeText(manifest?.cover?.coverId || "cover_image")) {
      coverCrop = { ...crop, imagePath };
      continue;
    }
    cropByShotId.set(String(crop.shotId), {
      ...crop,
      imagePath,
    });
  }
  const pdfMedia = buildPdfInputMediaIndex({ rootDir, pdfInput });
  const sourceBaseDir = resolveStoryboardSourceBaseDir(baseDir);
  const materialFrameIndex = await buildReadOnlyMaterialFrameIndex({ rootDir, baseDir, sourceBaseDir, manifest });
  const slotLabelIndex = await buildSlotLabelIndex({ baseDir, sourceBaseDir });

  const aspect = resolveAspect(manifest?.aspect, null);
  const selectedImageQuery = ensureVersionInImageQuery(imageQuery, versionSelection.selectedVersionId);
  const cover = buildCover({
    coverManifest: manifest.cover,
    coverCrop,
    pdfCover: pdfMedia.cover,
    imageBasePath,
    imageQuery: selectedImageQuery,
  });
  const groups = buildGroups({
    shots,
    cropByShotId,
    pdfShotMediaById: pdfMedia.shots,
    materialFrameIndex,
    slotLabelIndex,
    manifestAspect: aspect,
    imageBasePath,
    imageQuery: selectedImageQuery,
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
      pdfInputPath: pdfInput ? safeRelative(rootDir, pdfInputPath) : null,
      traceId: cropsManifest?.source?.traceId ?? confirmedPlan?.traceId ?? conversation.traceId ?? null,
      artifactId: cropsManifest?.source?.artifactId ?? confirmedPlan?.storyboardArtifact?.artifactId ?? null,
      parentArtifactId: cropsManifest?.source?.parentArtifactId ?? null,
    },
    mode: versionSelection.versions.length > 1 ? "multi_version" : "single",
    defaultVersionId: versionSelection.defaultVersionId,
    selectedVersionId: versionSelection.selectedVersionId,
    versions: versionSelection.versions,
    cover,
    groups,
  };
}

function ensureVersionInImageQuery(imageQuery, versionId) {
  const selected = normalizeText(versionId);
  if (!selected) return imageQuery;
  const params = new URLSearchParams(normalizeText(imageQuery));
  if (!params.get("versionId")) params.set("versionId", selected);
  const text = params.toString();
  return text || null;
}

async function resolveStoryboardImagePath({ rootDir, conversation, shotId, storyboardResult = null, versionId = null }) {
  const safeShotId = normalizeShotId(shotId);
  if (!safeShotId) return null;
  const versionSelection = selectStoryboardVersion(storyboardResult ?? conversation?.confirmedPlan ?? null, versionId);
  const baseDir = await resolveStoryboardBaseDir(rootDir, versionSelection.plan);
  if (!baseDir) return null;
  const manifestPath = path.join(baseDir, "shot-storyboard-manifest.json");
  const cropsPath = path.join(baseDir, "shot-storyboard-frames", "shot-storyboard-crops.json");
  const pdfInputPath = path.join(baseDir, "shot-storyboard-pdf-input.json");
  const manifest = await readJsonIfExists(manifestPath);
  const cropsManifest = await readJsonIfExists(cropsPath);
  const pdfInput = await readJsonIfExists(pdfInputPath);
  const coverId = normalizeText(manifest?.cover?.coverId) || "cover_image";
  if (safeShotId === coverId) {
    const coverCrop = (Array.isArray(cropsManifest?.crops) ? cropsManifest.crops : []).find((item) => item?.isCover || String(item?.shotId ?? "") === coverId);
    const cropPath = coverCrop ? resolveCropPath(rootDir, baseDir, coverCrop.path, coverCrop.shotId) : null;
    const pdfCoverPath = resolveMediaPath(rootDir, pdfInput?.cover?.imagePath);
    return cropPath ?? pdfCoverPath;
  }
  const knownShot = Array.isArray(manifest?.shots) && manifest.shots.some((shot) => String(shot?.shotId ?? "") === safeShotId);
  if (!knownShot) return null;
  const crop = (Array.isArray(cropsManifest?.crops) ? cropsManifest.crops : []).find((item) => String(item?.shotId ?? "") === safeShotId);
  const cropPath = crop ? resolveCropPath(rootDir, baseDir, crop.path, crop.shotId) : null;
  const pdfMedia = buildPdfInputMediaIndex({ rootDir, pdfInput });
  const pdfPath = pdfMedia.shots.get(safeShotId)?.imagePath ?? null;
  if (cropPath || pdfPath) return cropPath ?? pdfPath;
  const materialFrameIndex = await buildReadOnlyMaterialFrameIndex({ rootDir, baseDir, sourceBaseDir: resolveStoryboardSourceBaseDir(baseDir), manifest });
  const shot = manifest.shots.find((item) => String(item?.shotId ?? "") === safeShotId);
  return firstResolvedMaterialFrame(shot, materialFrameIndex);
}

function selectStoryboardVersion(plan, requestedVersionId = null) {
  const rawVersions = Array.isArray(plan?.versions) ? plan.versions : Array.isArray(plan?.storyboardVersions) ? plan.storyboardVersions : [];
  const versions = rawVersions.map((version) => ({
    versionId: normalizeText(version?.versionId) || null,
    versionName: normalizeText(version?.versionName) || normalizeText(version?.name) || normalizeText(version?.versionId) || "默认方案",
    status: normalizeText(version?.status) || null,
    sourceRestructurePath: normalizeText(version?.sourceRestructurePath || version?.restructureFinalPath) || null,
    sourceShotDesignPath: normalizeText(version?.sourceShotDesignPath || version?.shotDesignFinalPath) || null,
    storyboardArtifact: version?.storyboardArtifact ?? null,
    artifactId: normalizeText(version?.artifactId || version?.storyboardArtifact?.artifactId) || null,
    processingJobId: normalizeText(version?.processingJobId || version?.storyboardArtifact?.processingJobId) || null,
    traceId: normalizeText(version?.traceId || version?.storyboardArtifact?.traceId) || null,
    runId: normalizeText(version?.runId || version?.storyboardArtifact?.runId) || null,
    stageId: normalizeText(version?.stageId || version?.storyboardArtifact?.stageId) || null,
  })).filter((version) => version.sourceRestructurePath || version.sourceShotDesignPath || version.versionId);
  const defaultVersionId = normalizeText(plan?.defaultVersionId) || versions[0]?.versionId || null;
  const selectedVersion = versions.find((version) => version.versionId && version.versionId === requestedVersionId)
    ?? versions.find((version) => version.versionId && version.versionId === defaultVersionId)
    ?? versions[0]
    ?? null;
  if (!selectedVersion) {
    return { plan, versions, defaultVersionId, selectedVersionId: null };
  }
  return {
    plan: {
      ...plan,
      sourceRestructurePath: selectedVersion.sourceRestructurePath ?? plan?.sourceRestructurePath ?? null,
      sourceShotDesignPath: selectedVersion.sourceShotDesignPath ?? plan?.sourceShotDesignPath ?? null,
      storyboardArtifact: selectedVersion.storyboardArtifact ?? plan?.storyboardArtifact ?? null,
      traceId: selectedVersion.traceId ?? plan?.traceId ?? null,
      runId: selectedVersion.runId ?? plan?.runId ?? null,
      stageId: selectedVersion.stageId ?? plan?.stageId ?? null,
    },
    versions,
    defaultVersionId,
    selectedVersionId: selectedVersion.versionId ?? null,
  };
}

function buildCover({ coverManifest, coverCrop, pdfCover, imageBasePath, imageQuery = null }) {
  if (!coverManifest && !coverCrop && !pdfCover) return null;
  const coverId = normalizeText(coverManifest?.coverId) || normalizeText(coverCrop?.shotId) || "cover_image";
  const aspect = resolveAspect(coverManifest?.aspect, coverCrop?.cropBox);
  return {
    id: coverId,
    title: coverId,
    kind: "cover",
    kindLabel: "封面",
    imageUrl: coverCrop?.imagePath || pdfCover?.imagePath ? buildImageUrl(imageBasePath, coverId, imageQuery) : null,
    aspect,
    dialogue: normalizeText(coverManifest?.overlayPackaging),
  };
}

function buildGroups({ shots, cropByShotId, pdfShotMediaById, materialFrameIndex, slotLabelIndex, manifestAspect, imageBasePath, imageQuery = null }) {
  const groups = [];
  const groupByKey = new Map();
  let timelineCursorSeconds = 0;
  shots.forEach((shot, shotIndex) => {
    const shotId = String(shot?.shotId ?? "").trim();
    if (!shotId) return;
    const groupKey = resolveGroupKey(shot?.slotKey, shot?.slotSubtype, shotIndex);
    let group = groupByKey.get(groupKey);
    if (!group) {
      const slotDisplay = resolveSlotDisplay(groupKey, groups.length, slotLabelIndex);
      group = {
        id: `slot_${slotDisplay.order}_${groupKey}`,
        label: slotDisplay.label,
        key: groupKey,
        title: slotDisplay.title,
        shotCount: 0,
        shots: [],
      };
      groupByKey.set(groupKey, group);
      groups.push(group);
    }
    const crop = cropByShotId.get(shotId) ?? null;
    const pdfMedia = pdfShotMediaById.get(shotId) ?? null;
    const materialFrame = !shot.shouldGenerate ? firstResolvedMaterialFrame(shot, materialFrameIndex) : null;
    const imagePath = crop?.imagePath ?? pdfMedia?.imagePath ?? materialFrame;
    const shotAspect = resolveAspectFromSize(pdfMedia?.width, pdfMedia?.height) ?? resolveAspect(null, crop?.cropBox) ?? manifestAspect;
    const strategy = normalizeText(shot.strategyRaw) || normalizeText(shot.strategy);
    const shotDetail = buildShotDetailFields(shot);
    const shouldGenerate = Boolean(shot.shouldGenerate);
    const durationSeconds = parseDurationMidpointSeconds(shot.duration);
    const timelineRange = durationSeconds == null
      ? null
      : `${formatTimelineSeconds(timelineCursorSeconds)}-${formatTimelineSeconds(timelineCursorSeconds + durationSeconds)}s`;
    if (durationSeconds != null) timelineCursorSeconds += durationSeconds;
    group.shots.push({
      id: shotId,
      index: shotIndex + 1,
      title: shotId,
      duration: timelineRange,
      durationRaw: normalizeText(shot.duration),
      durationTooltip: timelineRange ? "预计时间轴，非精确剪辑点；按预计时长区间中间值累加" : null,
      dialogue: normalizeDialogue(shot.dialogue),
      strategy,
      strategyRaw: normalizeText(shot.strategyRaw),
      sourceRefs: Array.isArray(shot.sourceRefs) ? shot.sourceRefs.map((item) => String(item)).filter(Boolean) : [],
      slotSubtype: normalizeText(shot.slotSubtype),
      slotKey: normalizeText(shot.slotKey),
      scriptSegment: shotDetail.scriptSegment,
      rhythmRange: shotDetail.rhythmRange,
      packagingBlock: shotDetail.packagingBlock,
      visualPrompt: shotDetail.visualPrompt,
      overlayPackaging: shotDetail.overlayPackaging,
      syncPoint: shotDetail.syncPoint,
      proofFunction: shotDetail.proofFunction,
      kind: shouldGenerate ? "generated" : "material",
      kindLabel: shouldGenerate ? "自设计" : "素材",
      imageUrl: imagePath ? buildImageUrl(imageBasePath, shotId, imageQuery) : null,
      aspect: shotAspect,
    });
    group.shotCount = group.shots.length;
  });
  return groups;
}

function buildShotDetailFields(shot) {
  return {
    scriptSegment: normalizeText(shot?.scriptSegment),
    rhythmRange: normalizeText(shot?.rhythmRange),
    packagingBlock: normalizeText(shot?.packagingBlock),
    visualPrompt: normalizeText(shot?.imagePrompt || shot?.visualPrompt),
    overlayPackaging: normalizeText(shot?.overlayPackaging),
    syncPoint: normalizeText(shot?.syncPoint),
    proofFunction: normalizeText(shot?.proofFunction),
  };
}

function buildImageUrl(imageBasePath, shotId, imageQuery) {
  const query = normalizeText(imageQuery);
  return `${imageBasePath}/images/${encodeURIComponent(shotId)}${query ? `?${query}` : ""}`;
}

function parseDurationMidpointSeconds(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const numbers = Array.from(text.matchAll(/\d+(?:\.\d+)?/g)).map((match) => Number(match[0])).filter((number) => Number.isFinite(number) && number >= 0);
  if (!numbers.length) return null;
  if (numbers.length === 1) return numbers[0];
  return (numbers[0] + numbers[1]) / 2;
}

function formatTimelineSeconds(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  if (!Number.isFinite(rounded) || rounded <= 0) return "0";
  return rounded.toFixed(1);
}

function resolveSlotDisplay(groupKey, fallbackIndex, slotLabelIndex) {
  const id = `SUB_${groupKey.replace(/^SUB_/, "")}`;
  const value = slotLabelIndex.get(id) ?? slotLabelIndex.get(groupKey);
  const order = normalizePositiveNumber(value?.order) ?? fallbackIndex + 1;
  return {
    order: String(order).padStart(2, "0"),
    label: String(order).padStart(2, "0"),
    title: value?.title || formatGroupTitle(groupKey),
  };
}

function buildPdfInputMediaIndex({ rootDir, pdfInput }) {
  const shots = new Map();
  const coverImagePath = resolveMediaPath(rootDir, pdfInput?.cover?.imagePath);
  const cover = coverImagePath ? {
    imagePath: coverImagePath,
    width: normalizePositiveNumber(pdfInput?.cover?.width),
    height: normalizePositiveNumber(pdfInput?.cover?.height),
  } : null;
  for (const shot of Array.isArray(pdfInput?.shots) ? pdfInput.shots : []) {
    const shotId = normalizeText(shot?.shotId);
    const imagePath = resolveMediaPath(rootDir, shot?.imagePath);
    if (!shotId || !imagePath) continue;
    shots.set(shotId, {
      imagePath,
      width: normalizePositiveNumber(shot?.width),
      height: normalizePositiveNumber(shot?.height),
      mediaKind: normalizeText(shot?.mediaKind),
    });
  }
  return { cover, shots };
}

function resolveGroupKey(slotKey, slotSubtype, index) {
  const source = normalizeText(slotKey) || normalizeText(slotSubtype);
  const first = source.split("->")[0]?.trim() || `segment_${index + 1}`;
  const slotId = extractSlotId(first);
  if (slotId) return slotId.replace(/^SUB_/, "");
  return first.replace(/^`|`$/g, "").replace(/^SUB_/, "").replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function formatGroupTitle(key) {
  return normalizeText(key).replace(/^SUB_/, "") || "segment";
}

function extractSlotId(value) {
  const text = normalizeText(value);
  const match = /`?(SUB_[A-Za-z0-9_.-]+)`?/u.exec(text);
  return match?.[1] ?? null;
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

function resolveAspectFromSize(widthValue, heightValue) {
  const width = normalizePositiveNumber(widthValue);
  const height = normalizePositiveNumber(heightValue);
  if (!width || !height) return null;
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

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePositiveNumber(value) {
  const number = normalizeNumber(value);
  return number && number > 0 ? number : null;
}

function normalizeShotId(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9_.-]+$/.test(text) ? text : null;
}

function normalizeArtifactId(value) {
  const text = String(value ?? "").trim();
  return /^artifact_[A-Za-z0-9_.-]+$/.test(text) ? text : null;
}

function resolveStoryboardSourceBaseDir(baseDir) {
  const runParent = path.dirname(baseDir);
  if (path.basename(runParent) === "storyboard-runs") return path.dirname(runParent);
  return baseDir;
}

async function resolveStoryboardBaseDir(rootDir, confirmedPlan) {
  const artifactBaseDir = await resolveStoryboardArtifactBaseDir(rootDir, confirmedPlan);
  if (artifactBaseDir) return artifactBaseDir;
  const shotDesignPath = resolveInsideRoot(rootDir, confirmedPlan?.sourceShotDesignPath);
  const artifactId = normalizeArtifactId(confirmedPlan?.storyboardArtifact?.artifactId || confirmedPlan?.artifactId);
  if (shotDesignPath) {
    if (artifactId) {
      const runDir = path.join(path.dirname(shotDesignPath), "storyboard-runs", artifactId);
      if (await pathExists(runDir)) return runDir;
    }
    return path.dirname(shotDesignPath);
  }
  const restructurePath = resolveInsideRoot(rootDir, confirmedPlan?.sourceRestructurePath);
  if (!restructurePath) return null;
  if (artifactId) {
    const runDir = path.join(path.dirname(restructurePath), "storyboard-runs", artifactId);
    if (await pathExists(runDir)) return runDir;
  }
  return path.dirname(restructurePath);
}

async function resolveStoryboardArtifactBaseDir(rootDir, confirmedPlan) {
  const artifactId = normalizeArtifactId(confirmedPlan?.storyboardArtifact?.artifactId || confirmedPlan?.artifactId);
  if (!artifactId) return null;
  const artifact = await readStoryboardPrepArtifact(rootDir, artifactId);
  const manifestPath = resolveInsideRoot(rootDir, artifact?.files?.manifestPath);
  if (manifestPath) return path.dirname(manifestPath);
  const cropsManifestPath = resolveInsideRoot(rootDir, artifact?.files?.cropsManifestPath);
  if (cropsManifestPath) return path.dirname(path.dirname(cropsManifestPath));
  return null;
}

async function readStoryboardPrepArtifact(rootDir, artifactId) {
  const safeArtifactId = normalizeArtifactId(artifactId);
  if (!safeArtifactId) return null;
  const runtimeArtifactsDir = path.join(rootDir, "Runtime", "Artifacts");
  let entries = [];
  try {
    entries = await fs.readdir(runtimeArtifactsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const artifactPath = path.join(runtimeArtifactsDir, entry.name, "shot-storyboard-prep", safeArtifactId, "artifact.json");
    const artifact = await readJsonIfExists(artifactPath);
    if (artifact?.artifactId === safeArtifactId) return artifact;
  }
  return null;
}

function resolveCropPath(rootDir, baseDir, cropPath, shotId) {
  const safeShotId = normalizeShotId(shotId);
  const fallback = safeShotId ? path.join(baseDir, "shot-storyboard-frames", `${safeShotId}.png`) : null;
  const resolved = resolveInsideRoot(rootDir, cropPath) ?? fallback;
  if (!resolved) return null;
  const framesDir = path.join(baseDir, "shot-storyboard-frames");
  return isInside(resolved, framesDir) ? resolved : null;
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

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
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
    mode: "single",
    defaultVersionId: null,
    selectedVersionId: null,
    versions: [],
    cover: null,
    groups: [],
  };
}

module.exports = {
  buildStoryboardResultProjection,
  resolveStoryboardImagePath,
};
