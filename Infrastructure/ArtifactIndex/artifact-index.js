const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { buildShotBoundaryCacheParams } = require("../../Apps/Api/lib/shot-boundary-analysis");

const INDEX_VERSION = 1;

function createArtifactIndex({ store, processorVersion = "local-media-v1" }) {
  const indexRoot = path.join(store.runtimeRoot, "ArtifactIndex");
  const indexPath = path.join(indexRoot, "index.json");

  async function ensureIndex() {
    await fs.mkdir(indexRoot, { recursive: true });
    try {
      await fs.access(indexPath);
    } catch {
      await writeIndex(emptyIndex());
    }
  }

  async function readIndex() {
    await ensureIndex();
    try {
      const content = await fs.readFile(indexPath, "utf8");
      const parsed = JSON.parse(content);
      return normalizeIndex(parsed);
    } catch {
      return emptyIndex();
    }
  }

  async function writeIndex(index) {
    await fs.mkdir(indexRoot, { recursive: true });
    await fs.writeFile(indexPath, JSON.stringify(normalizeIndex(index), null, 2), "utf8");
  }

  async function registerSampleArtifact({ artifact, fileHash, traceId }) {
    const index = await readIndex();
    const item = buildLibraryItem({ artifact, fileHash, traceId, processorVersion });
    index.items[item.sampleVideoId] = item;
    for (const entry of item.cacheEntries) {
      index.cacheEntries[entry.cacheKey] = {
        ...entry,
        fileHash,
        sampleVideoId: item.sampleVideoId,
        updatedAt: item.updatedAt,
      };
    }
    await writeIndex(index);
    return item;
  }

  async function listItems() {
    const index = await readIndex();
    const latestByFile = new Map();
    for (const item of Object.values(index.items).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
      const groupKey = item.fileHash || item.sampleVideoId;
      if (!latestByFile.has(groupKey)) latestByFile.set(groupKey, item);
    }
    return Array.from(latestByFile.values())
      .map((item) => summarizeLibraryItem(item))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function getItem(sampleVideoId) {
    const index = await readIndex();
    const item = index.items[sampleVideoId] ?? null;
    if (!item) return null;
    return {
      ...item,
      artifactTree: buildArtifactTree(item.artifact),
    };
  }

  async function loadItem(sampleVideoId) {
    const detail = await getItem(sampleVideoId);
    return detail?.artifact ?? null;
  }

  async function findCacheEntry({ fileHash, stageName, params = {}, version = processorVersion }) {
    const index = await readIndex();
    const cacheKey = createCacheKey({ fileHash, stageName, params, version });
    return index.cacheEntries[cacheKey] ?? null;
  }

  async function deleteCacheForItem(sampleVideoId) {
    const index = await readIndex();
    const item = index.items[sampleVideoId];
    if (!item) return null;
    const fileHash = item.fileHash;
    const removedSampleVideoIds = [];
    for (const [id, current] of Object.entries(index.items)) {
      if (current.fileHash === fileHash) {
        delete index.items[id];
        removedSampleVideoIds.push(id);
      }
    }
    for (const [cacheKey, entry] of Object.entries(index.cacheEntries)) {
      if (entry.fileHash === fileHash || removedSampleVideoIds.includes(entry.sampleVideoId)) delete index.cacheEntries[cacheKey];
    }
    await writeIndex(index);
    return { fileHash, removedSampleVideoIds };
  }

  async function findLatestByFileHash(fileHash) {
    const index = await readIndex();
    const items = Object.values(index.items)
      .filter((item) => item.fileHash === fileHash)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return items[0] ? summarizeLibraryItem(items[0]) : null;
  }

  return {
    indexRoot,
    indexPath,
    processorVersion,
    readIndex,
    registerSampleArtifact,
    listItems,
    getItem,
    loadItem,
    findCacheEntry,
    deleteCacheForItem,
    findLatestByFileHash,
    createCacheKey: (input) => createCacheKey({ version: processorVersion, ...input }),
  };
}

function buildLibraryItem({ artifact, fileHash, traceId, processorVersion }) {
  const now = new Date().toISOString();
  const tags = buildTags(artifact);
  const artifactTree = buildArtifactTree(artifact);
  return {
    sampleVideoId: artifact.sampleVideoId,
    workspaceId: artifact.workspaceId,
    fileHash,
    filename: artifact.sampleVideo?.original?.summary ?? "样例视频",
    durationSeconds: artifact.metadata?.durationSeconds ?? null,
    width: artifact.metadata?.width ?? null,
    height: artifact.metadata?.height ?? null,
    traceId: traceId ?? artifact.trace?.traceId ?? null,
    updatedAt: now,
    tags,
    cacheAvailable: true,
    processorVersion,
    artifact,
    artifactNodes: artifactTree,
    cacheEntries: buildCacheEntries({ artifact, fileHash, artifactTree, processorVersion }),
  };
}

function buildCacheEntries({ artifact, fileHash, artifactTree, processorVersion }) {
  return artifactTree
    .filter((node) => node.stageName && node.artifactId && node.status === "processed")
    .map((node) => {
      const params = stageParams(artifact, node.stageName);
      return {
        cacheKey: createCacheKey({ fileHash, stageName: node.stageName, params, version: processorVersion }),
        stageName: node.stageName,
        artifactId: node.artifactId,
        parentArtifactId: node.parentArtifactId,
        params,
        processorVersion,
        status: node.status,
        uri: node.uri ?? null,
      };
    });
}

function buildArtifactTree(artifact) {
  const nodes = [];
  pushRef(nodes, artifact.sampleVideo?.original, "sample.source.saved", artifact);
  pushRef(nodes, artifact.sampleVideo?.normalized, "sample.artifact.written", artifact);
  pushRef(nodes, artifact.cover, "sample.cover.extracted", artifact);
  nodes.push({
    id: "frame-set",
    label: "帧集合",
    stageName: "sample.frames.extracted",
    artifactId: "frame-set",
    parentArtifactId: artifact.sampleVideo?.artifactId ?? null,
    status: artifact.frames?.length ? "processed" : "missing",
    params: stageParams(artifact, "sample.frames.extracted"),
    traceId: artifact.trace?.traceId ?? null,
    uri: null,
    summary: `${artifact.frames?.length ?? 0} 帧`,
  });
  pushRef(nodes, artifact.audio, "sample.audio.extracted", artifact);
  pushRef(nodes, artifact.audioSeparation?.vocal, "sample.audio.separated", artifact);
  pushRef(nodes, artifact.audioSeparation?.music, "sample.audio.separated", artifact);
  if (artifact.subtitles) {
    pushNode(nodes, artifact.subtitles, "sample.subtitle.recognized", artifact, `${artifact.subtitles.segments?.length ?? 0} 条字幕`);
  }
  if (artifact.audioFeatures) {
    pushNode(nodes, artifact.audioFeatures, "sample.audio.features.extracted", artifact, `${artifact.audioFeatures.beats?.length ?? 0} beats`);
  }
  if (artifact.shotBoundaryAnalysis) {
    for (const sheet of artifact.shotBoundaryAnalysis.contactSheets ?? []) {
      pushNode(nodes, sheet, "shot.contact_sheet", artifact, `${sheet.frameCount ?? 0} 帧 / ${sheet.sheetId ?? "sheet"}`);
    }
    for (const candidate of artifact.shotBoundaryAnalysis.boundaryCandidateArtifacts ?? []) {
      pushNode(nodes, candidate, "shot.boundary_candidates", artifact, `${candidate.boundaries?.length ?? 0} 条边界`);
    }
    pushNode(nodes, artifact.shotBoundaryAnalysis, "shot.boundary_merge", artifact, `${artifact.shotBoundaryAnalysis.shots?.length ?? 0} 镜 / ${artifact.shotBoundaryAnalysis.boundaries?.length ?? 0} 边界`);
  }
  return nodes;
}

function pushRef(nodes, ref, stageName, artifact) {
  if (!ref) return;
  pushNode(nodes, ref, stageName, artifact, ref.summary ?? ref.type);
}

function pushNode(nodes, ref, stageName, artifact, summary) {
  nodes.push({
    id: ref.artifactId,
    label: artifactLabel(ref.type),
    stageName,
    artifactId: ref.artifactId,
    parentArtifactId: ref.parentArtifactId ?? null,
    status: ref.status ?? (ref.uri === null ? "degraded" : "processed"),
    params: stageParams(artifact, stageName),
    traceId: artifact.trace?.traceId ?? null,
    cacheKey: null,
    uri: ref.uri ?? null,
    summary: summary ?? null,
  });
}

function summarizeLibraryItem(item) {
  return {
    sampleVideoId: item.sampleVideoId,
    filename: item.filename,
    durationSeconds: item.durationSeconds,
    width: item.width,
    height: item.height,
    updatedAt: item.updatedAt,
    tags: item.tags,
    cacheAvailable: item.cacheAvailable,
    traceId: item.traceId,
  };
}

function buildTags(artifact) {
  return [
    artifact.frames?.length ? "抽帧" : null,
    artifact.audio?.uri ? "音频" : null,
    artifact.audioSeparation?.vocal?.uri || artifact.audioSeparation?.music?.uri ? "分离" : null,
    artifact.subtitles?.segments?.length ? "字幕" : null,
    artifact.audioFeatures ? "音频特征" : null,
    artifact.shotBoundaryAnalysis ? "切镜" : null,
  ].filter(Boolean);
}

function stageParams(artifact, stageName) {
  const options = artifact.processingOptions ?? {};
  if (stageName === "sample.frames.extracted") return { frameSampleRateFps: options.frameSampleRateFps ?? 1 };
  if (stageName === "sample.audio.separated") return { demucsMode: "two-stems-vocals", enabled: Boolean(options.enableAudioSeparation) };
  if (stageName === "sample.subtitle.recognized") return { provider: "xfyun-iat", maxSegmentSeconds: 60, enabled: Boolean(options.enableSubtitleRecognition) };
  if (stageName === "sample.audio.features.extracted") {
    return {
      provider: "librosa",
      enabled: Boolean(options.enableAudioFeatureAnalysis),
      sourceRole: artifact.audioFeatures?.analysisParams?.sourceRole ?? (artifact.audioFeatures?.sourceAudioArtifactId === artifact.audioSeparation?.music?.artifactId ? "music" : "original"),
      sourceAudioArtifactId: artifact.audioFeatures?.sourceAudioArtifactId ?? null,
    };
  }
  if (stageName === "shot.boundary_merge" || stageName === "agent.shotBoundary.resultWritten") {
    return buildShotBoundaryCacheParams({
      sourceArtifactId: artifact.shotBoundaryAnalysis?.parentArtifactId ?? artifact.sampleVideo?.artifactId ?? null,
      extractSampling: artifact.shotBoundaryAnalysis?.extractSampling ?? null,
      analysisSampling: artifact.shotBoundaryAnalysis?.analysisSampling ?? null,
      frameDimensions: artifact.metadata
        ? {
          width: artifact.metadata?.width ?? null,
          height: artifact.metadata?.height ?? null,
        }
        : null,
      contactSheets: artifact.shotBoundaryAnalysis?.contactSheets ?? [],
      subtitleContextSummary: artifact.shotBoundaryAnalysis?.subtitleContextSummary ?? null,
      skillHash: artifact.shotBoundaryAnalysis?.agent?.skillHash ?? null,
    });
  }
  return {};
}

function artifactLabel(type) {
  const labels = {
    "original-video": "原视频",
    "normalized-video": "标准化视频",
    "cover-frame": "封面",
    "audio-track": "音频",
    "audio-vocal": "人声",
    "audio-music": "伴奏",
    "subtitle-track": "字幕",
    "audio-feature-analysis": "音频特征",
    contact_sheet: "切镜联表",
    shot_boundary_candidates: "切镜候选",
    "shot-boundary-analysis": "镜头切分",
  };
  return labels[type] ?? type ?? "产物";
}

function createCacheKey({ fileHash, stageName, params = {}, version }) {
  return hashJson({ fileHash, stageName, params, version });
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hashJson(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function emptyIndex() {
  return { schemaVersion: INDEX_VERSION, items: {}, cacheEntries: {} };
}

function normalizeIndex(value) {
  return {
    schemaVersion: INDEX_VERSION,
    items: value?.items && typeof value.items === "object" ? value.items : {},
    cacheEntries: value?.cacheEntries && typeof value.cacheEntries === "object" ? value.cacheEntries : {},
  };
}

module.exports = {
  INDEX_VERSION,
  createArtifactIndex,
  createCacheKey,
  hashBuffer,
  stableStringify,
  buildArtifactTree,
};
