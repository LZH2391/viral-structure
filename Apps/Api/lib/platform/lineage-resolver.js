const LINEAGE_SCHEMA_VERSION = "resource_lineage.v1";
const RESOURCE_SUMMARY_SCHEMA_VERSION = "platform_resource_summary.v1";

function createLineageResolver({ artifactIndex = null } = {}) {
  async function resolve({ resourceKind, resourceId } = {}) {
    const kind = normalizeText(resourceKind);
    const id = normalizeText(resourceId);
    if (!kind || !id) return null;
    if (kind === "sample") return sampleLineage(id, artifactIndex);
    if (kind === "artifact") return artifactLineage(id, artifactIndex);
    return null;
  }

  return {
    schemaVersion: LINEAGE_SCHEMA_VERSION,
    resolve,
  };
}

async function sampleLineage(sampleVideoId, artifactIndex) {
  const detail = await artifactIndex?.getItem?.(sampleVideoId) ?? null;
  if (!detail) return null;
  return buildLineage({
    root: { resourceKind: "sample", resourceId: sampleVideoId },
    detail,
  });
}

async function artifactLineage(artifactId, artifactIndex) {
  const detail = await findDetailForArtifact(artifactId, artifactIndex);
  if (!detail) return null;
  return buildLineage({
    root: { resourceKind: "artifact", resourceId: artifactId },
    detail,
  });
}

async function findDetailForArtifact(artifactId, artifactIndex) {
  if (!artifactIndex?.readIndex) return null;
  const index = await artifactIndex.readIndex();
  const sampleIds = Object.values(index.items ?? {})
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .map((item) => item.sampleVideoId)
    .filter(Boolean);
  for (const sampleVideoId of sampleIds) {
    const detail = await artifactIndex.getItem?.(sampleVideoId);
    if (detail && artifactNodes(detail).some((node) => node.artifactId === artifactId || node.id === artifactId)) return detail;
  }
  return null;
}

function buildLineage({ root, detail }) {
  const sampleVideoId = detail.sampleVideoId ?? detail.artifact?.sampleVideoId ?? null;
  const nodes = [sampleNode(detail), ...artifactNodes(detail).map((node) => artifactNode(node, sampleVideoId))].filter(Boolean);
  const nodeRefs = new Set(nodes.map((node) => resourceKey(node.resourceKind, node.resourceId)));
  const edges = [];
  for (const node of artifactNodes(detail)) {
    const childId = node.artifactId ?? node.id;
    if (!childId) continue;
    const child = { resourceKind: "artifact", resourceId: childId };
    const parentArtifactId = normalizeText(node.parentArtifactId);
    if (parentArtifactId && nodeRefs.has(resourceKey("artifact", parentArtifactId))) {
      edges.push({ from: { resourceKind: "artifact", resourceId: parentArtifactId }, to: child, relation: "parent" });
    } else if (sampleVideoId) {
      edges.push({ from: { resourceKind: "sample", resourceId: sampleVideoId }, to: child, relation: "child" });
    }
  }
  return {
    schemaVersion: LINEAGE_SCHEMA_VERSION,
    root,
    nodes,
    edges,
  };
}

function artifactNodes(detail) {
  return Array.isArray(detail?.artifactTree)
    ? detail.artifactTree
    : Array.isArray(detail?.artifactNodes)
      ? detail.artifactNodes
      : [];
}

function sampleNode(detail) {
  const sampleVideoId = normalizeText(detail?.sampleVideoId ?? detail?.artifact?.sampleVideoId);
  if (!sampleVideoId) return null;
  return {
    schemaVersion: RESOURCE_SUMMARY_SCHEMA_VERSION,
    resourceKind: "sample",
    resourceId: sampleVideoId,
    label: normalizeText(detail.filename) ?? sampleVideoId,
    status: normalizeText(detail.artifact?.status) ?? "indexed",
    createdAt: null,
    updatedAt: normalizeText(detail.updatedAt),
    runId: normalizeText(detail.artifact?.trace?.runId),
    traceId: normalizeText(detail.traceId ?? detail.artifact?.trace?.traceId),
    stageId: normalizeText(detail.artifact?.trace?.stageId),
    artifactId: normalizeText(detail.artifact?.sampleVideo?.artifactId ?? detail.sourceArtifactId),
    parentArtifactId: null,
    summary: {
      tags: detail.tags ?? [],
      durationSeconds: detail.durationSeconds ?? null,
    },
    source: {
      sourceOfTruth: `Runtime/Artifacts/${sampleVideoId}/artifact.json`,
      indexSource: "Infrastructure/ArtifactIndex",
    },
  };
}

function artifactNode(node, sampleVideoId) {
  const artifactId = normalizeText(node.artifactId ?? node.id);
  if (!artifactId) return null;
  return {
    schemaVersion: RESOURCE_SUMMARY_SCHEMA_VERSION,
    resourceKind: "artifact",
    resourceId: artifactId,
    label: normalizeText(node.label) ?? artifactId,
    status: normalizeText(node.status),
    createdAt: null,
    updatedAt: null,
    runId: normalizeText(node.runId),
    traceId: normalizeText(node.traceId),
    stageId: normalizeText(node.stageId),
    artifactId,
    parentArtifactId: normalizeText(node.parentArtifactId),
    summary: {
      stageName: normalizeText(node.stageName),
      artifactType: normalizeText(node.artifactType),
      summary: normalizeText(node.summary),
      sampleVideoId,
    },
    source: {
      sourceOfTruth: sampleVideoId ? `Runtime/Artifacts/${sampleVideoId}/artifact.json` : null,
      indexSource: "Infrastructure/ArtifactIndex",
    },
  };
}

function resourceKey(resourceKind, resourceId) {
  return `${resourceKind}:${resourceId}`;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

module.exports = {
  LINEAGE_SCHEMA_VERSION,
  createLineageResolver,
};
