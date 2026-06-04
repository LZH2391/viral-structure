const path = require("path");

const ARTIFACT_RESOLUTION_SCHEMA_VERSION = "artifact_resolution.v1";

function createArtifactResolver({ artifactIndex = null } = {}) {
  async function resolve({ artifactId, sampleVideoId = null } = {}) {
    const targetArtifactId = normalizeText(artifactId);
    if (!targetArtifactId) return missingResolution(null);

    const details = await loadCandidateDetails({ artifactIndex, sampleVideoId });
    for (const detail of details) {
      const resolved = resolveFromDetail(detail, targetArtifactId);
      if (resolved) return resolved;
    }
    return missingResolution(targetArtifactId);
  }

  return {
    schemaVersion: ARTIFACT_RESOLUTION_SCHEMA_VERSION,
    resolve,
  };
}

async function loadCandidateDetails({ artifactIndex, sampleVideoId }) {
  if (!artifactIndex) return [];
  const requestedSampleId = normalizeText(sampleVideoId);
  if (requestedSampleId && typeof artifactIndex.getItem === "function") {
    return [await artifactIndex.getItem(requestedSampleId)].filter(Boolean);
  }
  if (typeof artifactIndex.readIndex !== "function") return [];
  const index = await artifactIndex.readIndex();
  const sampleIds = Object.values(index.items ?? {})
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .map((item) => item.sampleVideoId)
    .filter(Boolean);
  const details = [];
  for (const id of sampleIds) {
    const detail = typeof artifactIndex.getItem === "function" ? await artifactIndex.getItem(id) : index.items[id];
    if (detail) details.push(detail);
  }
  return details;
}

function resolveFromDetail(detail, artifactId) {
  const artifact = detail?.artifact ?? null;
  const treeNode = findTreeNode(detail, artifactId);
  const refNode = treeNode ? null : findArtifactRef(artifact, artifactId);
  const node = treeNode ?? refNode;
  if (!node) return null;
  const sampleVideoId = normalizeText(detail?.sampleVideoId ?? artifact?.sampleVideoId);
  const uri = safeRuntimeUri(node.uri ?? node.imageUri ?? null);
  const artifactType = normalizeText(node.artifactType ?? node.type);
  const stageName = normalizeText(node.stageName);
  const parentArtifactId = normalizeText(node.parentArtifactId);
  const trace = artifact?.trace ?? {};

  return {
    schemaVersion: ARTIFACT_RESOLUTION_SCHEMA_VERSION,
    artifactId,
    artifactType,
    stageName,
    parentArtifactId,
    sampleVideoId,
    runId: normalizeText(node.runId ?? trace.runId),
    traceId: normalizeText(node.traceId ?? trace.traceId ?? detail?.traceId),
    stageId: normalizeText(node.stageId ?? trace.stageId),
    uri,
    mediaKind: inferMediaKind({ artifactType, uri }),
    exists: true,
    readable: true,
    summary: buildSummary(node),
    source: {
      sourceOfTruth: sampleVideoId ? `Runtime/Artifacts/${sampleVideoId}/artifact.json` : null,
      indexSource: treeNode ? "Infrastructure/ArtifactIndex" : null,
    },
  };
}

function findTreeNode(detail, artifactId) {
  const nodes = Array.isArray(detail?.artifactTree)
    ? detail.artifactTree
    : Array.isArray(detail?.artifactNodes)
      ? detail.artifactNodes
      : [];
  return nodes.find((node) => node?.artifactId === artifactId || node?.id === artifactId) ?? null;
}

function findArtifactRef(value, artifactId) {
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (current.artifactId === artifactId) return current;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    for (const child of Object.values(current)) {
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return null;
}

function buildSummary(node) {
  return {
    label: normalizeText(node.label),
    status: normalizeText(node.status),
    summary: normalizeText(node.summary),
    type: normalizeText(node.type ?? node.artifactType),
  };
}

function missingResolution(artifactId) {
  return {
    schemaVersion: ARTIFACT_RESOLUTION_SCHEMA_VERSION,
    artifactId,
    artifactType: null,
    stageName: null,
    parentArtifactId: null,
    sampleVideoId: null,
    runId: null,
    traceId: null,
    stageId: null,
    uri: null,
    mediaKind: "unknown",
    exists: false,
    readable: false,
    summary: null,
    source: {
      sourceOfTruth: null,
      indexSource: null,
    },
  };
}

function safeRuntimeUri(uri) {
  const text = normalizeText(uri);
  if (!text || !text.startsWith("/runtime/")) return null;
  return text;
}

function inferMediaKind({ artifactType, uri }) {
  const type = String(artifactType ?? "").toLowerCase();
  if (type.includes("video")) return "video";
  if (type.includes("audio")) return "audio";
  if (type.includes("cover") || type.includes("frame") || type.includes("sheet") || type.includes("image")) return "image";
  if (type.includes("subtitle") || type.includes("text")) return "text";
  const ext = path.extname(String(uri ?? "")).toLowerCase();
  if ([".mp4", ".m4v", ".webm"].includes(ext)) return "video";
  if ([".m4a", ".mp3", ".wav", ".aac"].includes(ext)) return "audio";
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return "image";
  if ([".json"].includes(ext)) return "json";
  if ([".txt", ".md", ".srt", ".vtt"].includes(ext)) return "text";
  return "unknown";
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

module.exports = {
  ARTIFACT_RESOLUTION_SCHEMA_VERSION,
  createArtifactResolver,
};
