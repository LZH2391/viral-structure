const { RESOURCE_SUMMARY_SCHEMA_VERSION } = require("./resource-resolver");

function createProjectionResolver({ artifactIndex = null, workflowRunStore = null } = {}) {
  async function read({ projectionId } = {}) {
    const id = normalizeText(projectionId);
    if (id !== "analysis-history") return null;
    const items = await Promise.all((await artifactIndex?.listItems?.() ?? []).map(async (item) => {
      const detail = await artifactIndex?.getItem?.(item.sampleVideoId).catch(() => null);
      return analysisHistoryProjectionItem(item, detail?.artifact ?? null, latestWorkflowRun(workflowRunStore, item.sampleVideoId));
    }));
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

function analysisHistoryProjectionItem(item, artifact, workflowRun) {
  if (!item?.sampleVideoId) return null;
  const latestAnalysis = artifact?.functionSlotAtomizationAnalysis
    ?? artifact?.userMaterialPack
    ?? artifact?.packagingStructureAnalysis
    ?? artifact?.rhythmStructureAnalysis
    ?? artifact?.scriptSegmentAnalysis
    ?? artifact?.shotBoundaryAnalysis
    ?? null;
  return {
    sampleVideoId: item.sampleVideoId,
    workflowRunId: normalizeText(workflowRun?.workflowRunId),
    workflowKey: normalizeText(workflowRun?.workflowKey),
    title: normalizeText(artifact?.sampleVideo?.original?.summary ?? item.filename ?? item.sampleVideoId),
    status: normalizeText(artifact?.status ?? item.status ?? "indexed"),
    updatedAt: normalizeText(item.updatedAt),
    createdAt: normalizeText(item.createdAt),
    artifactId: normalizeText(latestAnalysis?.artifactId ?? item.sourceArtifactId ?? artifact?.sampleVideo?.artifactId),
    traceId: normalizeText(latestAnalysis?.traceId ?? latestAnalysis?.agent?.traceId ?? item.sourceTraceId ?? item.traceId ?? artifact?.trace?.traceId),
    runId: normalizeText(latestAnalysis?.runId ?? latestAnalysis?.agent?.runId ?? item.runId ?? artifact?.trace?.runId),
    stageId: normalizeText(latestAnalysis?.stageId ?? latestAnalysis?.agent?.stageId ?? item.stageId ?? artifact?.trace?.stageId),
    durationSeconds: numberOrNull(artifact?.metadata?.durationSeconds ?? item.durationSeconds),
    width: numberOrNull(artifact?.metadata?.width ?? item.width),
    height: numberOrNull(artifact?.metadata?.height ?? item.height),
    coverUri: safeRuntimeUri(artifact?.cover?.uri ?? artifact?.frames?.[0]?.imageUri),
    videoUri: safeRuntimeUri(artifact?.sampleVideo?.normalized?.uri ?? artifact?.sampleVideo?.original?.uri),
    hasFunctionSlotAtomization: Boolean(artifact?.functionSlotAtomizationAnalysis),
    hasUserMaterialPack: Boolean(artifact?.userMaterialPack),
    isRunning: isRunningStatus(artifact?.status ?? item.status),
  };
}

function latestWorkflowRun(workflowRunStore, sampleVideoId) {
  if (!sampleVideoId || typeof workflowRunStore?.listRuns !== "function") return null;
  return workflowRunStore.listRuns()
    .filter((run) => run?.sampleVideoId === sampleVideoId)
    .sort((a, b) => timestampValue(b?.updatedAt ?? b?.createdAt) - timestampValue(a?.updatedAt ?? a?.createdAt))[0] ?? null;
}

function timestampValue(value) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
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
