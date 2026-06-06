const { RESOURCE_SUMMARY_SCHEMA_VERSION } = require("./resource-resolver");

function createProjectionResolver({ artifactIndex = null } = {}) {
  async function read({ projectionId } = {}) {
    const id = normalizeText(projectionId);
    if (id !== "analysis-history") return null;
    const items = (await artifactIndex?.listItems?.() ?? []).map((item) => analysisHistoryProjectionItem(item));
    return baseSummary({
      resourceKind: "projection",
      resourceId: id,
      label: "历史结果",
      status: "ready",
      updatedAt: latestUpdatedAt(items),
      summary: {
        schemaVersion: "analysis_history_projection.v1",
        generatedAt: new Date().toISOString(),
        items: items.filter(Boolean),
      },
      sourceOfTruth: "Runtime/Artifacts/<sampleVideoId>/artifact.json",
      indexSource: "Infrastructure/ArtifactIndex",
    });
  }

  return { read };
}

function analysisHistoryProjectionItem(item) {
  if (!item?.sampleVideoId) return null;
  return {
    sampleVideoId: item.sampleVideoId,
    title: normalizeText(item.filename ?? item.title ?? item.sampleVideoId),
    status: normalizeText(item.status ?? "indexed"),
    updatedAt: normalizeText(item.updatedAt),
    createdAt: normalizeText(item.createdAt),
    artifactId: normalizeText(item.sourceArtifactId ?? item.artifactId),
    traceId: normalizeText(item.sourceTraceId ?? item.traceId),
    runId: normalizeText(item.runId),
    stageId: normalizeText(item.stageId),
    durationSeconds: numberOrNull(item.durationSeconds),
    width: numberOrNull(item.width),
    height: numberOrNull(item.height),
    coverUri: safeRuntimeUri(item.coverUri),
    videoUri: safeRuntimeUri(item.videoUri),
    hasFunctionSlotAtomization: Boolean(item.hasFunctionSlotAtomization),
    hasUserMaterialPack: Boolean(item.hasUserMaterialPack),
    isIncomplete: Boolean(item.isIncomplete),
    isRunning: isRunningStatus(item.status),
  };
}

function latestUpdatedAt(items) {
  return items.reduce((latest, item) => {
    const value = normalizeText(item?.updatedAt ?? item?.createdAt);
    if (!value) return latest;
    return !latest || String(value).localeCompare(latest) > 0 ? value : latest;
  }, null);
}

function baseSummary({
  resourceKind,
  resourceId,
  label = null,
  status = null,
  createdAt = null,
  updatedAt = null,
  runId = null,
  traceId = null,
  stageId = null,
  artifactId = null,
  parentArtifactId = null,
  summary = null,
  sourceOfTruth = null,
  indexSource = null,
}) {
  if (!resourceId) return null;
  return {
    schemaVersion: RESOURCE_SUMMARY_SCHEMA_VERSION,
    resourceKind,
    resourceId,
    label: normalizeText(label),
    status: normalizeText(status),
    createdAt: normalizeText(createdAt),
    updatedAt: normalizeText(updatedAt),
    runId: normalizeText(runId),
    traceId: normalizeText(traceId),
    stageId: normalizeText(stageId),
    artifactId: normalizeText(artifactId),
    parentArtifactId: normalizeText(parentArtifactId),
    summary: summary ?? null,
    source: {
      sourceOfTruth,
      indexSource,
    },
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isRunningStatus(status) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}

function safeRuntimeUri(uri) {
  const text = normalizeText(uri);
  if (!text || !text.startsWith("/runtime/")) return null;
  return text;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

module.exports = {
  createProjectionResolver,
};
