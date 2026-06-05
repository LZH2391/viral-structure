const RESOURCE_SUMMARY_SCHEMA_VERSION = "platform_resource_summary.v1";
const RESOURCE_LIST_SCHEMA_VERSION = "platform_resource_list.v1";

function createResourceResolver({
  artifactIndex = null,
  workflowRunStore = null,
  jobStore = null,
  activeTurnRuntime = null,
  agentConversationStore = null,
  moduleRegistry = null,
  runtimeRoot = null,
  readDebugTracesImpl = null,
  readDebugTraceDetailImpl = null,
} = {}) {
  async function list({ resourceKind } = {}) {
    const kind = normalizeText(resourceKind);
    if (!kind) return null;
    if (kind === "sample") return resourceList(kind, (await artifactIndex?.listItems?.() ?? []).map(sampleSummaryFromIndexItem));
    if (kind === "workflowRun") return resourceList(kind, (workflowRunStore?.listRuns?.() ?? []).map(workflowRunSummary));
    if (kind === "job") return resourceList(kind, (jobStore?.listJobs?.() ?? []).map(jobSummary));
    if (kind === "activeTurn") return resourceList(kind, (await activeTurnRuntime?.listActive?.() ?? []).map(activeTurnSummary));
    if (kind === "conversation") return resourceList(kind, (await agentConversationStore?.list?.({ status: null }) ?? []).map(conversationSummary));
    if (kind === "module") return resourceList(kind, (moduleRegistry?.list?.() ?? []).map(moduleSummary));
    if (kind === "trace") return resourceList(kind, (await readDebugTracesImpl?.(runtimeRoot) ?? { traces: [] }).traces.map(traceSummary));
    return null;
  }

  async function read({ resourceKind, resourceId } = {}) {
    const kind = normalizeText(resourceKind);
    const id = normalizeText(resourceId);
    if (!kind || !id) return null;
    if (kind === "sample") return readSample(id, artifactIndex);
    if (kind === "workflowRun") return workflowRunSummary(workflowRunStore?.getRun?.(id));
    if (kind === "job") return jobSummary(jobStore?.getJob?.(id) ?? jobStore?.getArchivedJob?.(id));
    if (kind === "activeTurn") return activeTurnSummary(await activeTurnRuntime?.getByBindingId?.(id) ?? await activeTurnRuntime?.getByTurnId?.(id));
    if (kind === "conversation") return conversationSummary(await agentConversationStore?.get?.(id));
    if (kind === "module") return moduleSummary((moduleRegistry?.list?.() ?? []).find((item) => item.moduleId === id));
    if (kind === "trace") return traceSummary(await readDebugTraceDetailImpl?.(runtimeRoot, id));
    return null;
  }

  return {
    summarySchemaVersion: RESOURCE_SUMMARY_SCHEMA_VERSION,
    listSchemaVersion: RESOURCE_LIST_SCHEMA_VERSION,
    list,
    read,
  };
}

async function readSample(sampleVideoId, artifactIndex) {
  const detail = await artifactIndex?.getItem?.(sampleVideoId) ?? null;
  if (!detail) return null;
  return sampleSummaryFromIndexItem({
    ...detail,
    artifactId: detail.artifact?.sampleVideo?.artifactId ?? detail.sourceArtifactId ?? null,
    status: detail.artifact?.status ?? null,
  });
}

function resourceList(resourceKind, resources) {
  return {
    schemaVersion: RESOURCE_LIST_SCHEMA_VERSION,
    resourceKind,
    resources: resources.filter(Boolean),
  };
}

function sampleSummaryFromIndexItem(item) {
  if (!item) return null;
  return baseSummary({
    resourceKind: "sample",
    resourceId: item.sampleVideoId,
    label: item.filename ?? item.sampleVideoId,
    status: item.status ?? "indexed",
    updatedAt: item.updatedAt,
    runId: item.runId ?? null,
    traceId: item.traceId ?? null,
    stageId: item.stageId ?? null,
    artifactId: item.artifactId ?? item.sourceArtifactId ?? null,
    parentArtifactId: item.parentArtifactId ?? null,
    summary: {
      durationSeconds: item.durationSeconds ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      tags: item.tags ?? [],
      sourceTraceId: item.sourceTraceId ?? null,
      sourceTurnId: item.sourceTurnId ?? null,
    },
    sourceOfTruth: item.sampleVideoId ? `Runtime/Artifacts/${item.sampleVideoId}/artifact.json` : null,
    indexSource: "Infrastructure/ArtifactIndex",
  });
}

function workflowRunSummary(run) {
  if (!run) return null;
  return baseSummary({
    resourceKind: "workflowRun",
    resourceId: run.workflowRunId,
    label: run.workflowKey ?? run.workflowRunId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    runId: run.runId,
    traceId: run.traceId,
    stageId: null,
    artifactId: null,
    parentArtifactId: null,
    summary: {
      workflowKey: run.workflowKey ?? null,
      workflowVersion: run.workflowVersion ?? null,
      sampleVideoId: run.sampleVideoId ?? null,
      currentStageKeys: run.currentStageKeys ?? [],
      stageCount: Array.isArray(run.stages) ? run.stages.length : 0,
    },
    sourceOfTruth: "Runtime/WorkflowRuns/runs/*.json",
    indexSource: "Runtime/WorkflowRuns/workflow-runs.json",
  });
}

function jobSummary(job) {
  if (!job) return null;
  return baseSummary({
    resourceKind: "job",
    resourceId: job.jobId,
    label: job.stage ?? job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    runId: job.runId ?? null,
    traceId: job.traceId ?? null,
    stageId: job.stageId ?? null,
    artifactId: job.artifactId ?? null,
    parentArtifactId: job.parentArtifactId ?? null,
    summary: {
      sampleVideoId: job.sampleVideoId ?? null,
      stage: job.stage ?? null,
      progress: typeof job.progress === "number" ? job.progress : null,
      cacheKind: job.cachePrompt?.cacheKind ?? null,
    },
    sourceOfTruth: "Runtime/Jobs/active-jobs.json / Runtime/Jobs/archive/*.jsonl",
    indexSource: "Apps/Api/lib/stores/job-store.js",
  });
}

function activeTurnSummary(binding) {
  if (!binding) return null;
  return baseSummary({
    resourceKind: "activeTurn",
    resourceId: binding.bindingId,
    label: binding.stageName ?? binding.turnId,
    status: binding.status,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
    runId: binding.runId,
    traceId: binding.traceId,
    stageId: binding.stageId,
    artifactId: binding.artifactId,
    parentArtifactId: binding.parentArtifactId,
    summary: {
      ownerType: binding.ownerType ?? null,
      ownerId: binding.ownerId ?? null,
      threadId: binding.threadId ?? null,
      turnId: binding.turnId ?? null,
      replayType: binding.replayRef?.type ?? null,
    },
    sourceOfTruth: "Runtime/ActiveTurns/active-turns.json",
    indexSource: "Apps/Api/lib/active-turns/store.js",
  });
}

function conversationSummary(conversation) {
  if (!conversation) return null;
  return baseSummary({
    resourceKind: "conversation",
    resourceId: conversation.conversationId,
    label: conversation.title ?? conversation.role ?? conversation.conversationId,
    status: conversation.status,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    runId: conversation.runId,
    traceId: conversation.traceId,
    stageId: conversation.stageId,
    artifactId: conversation.confirmedPlan?.displayArtifact?.artifactId ?? conversation.confirmedPlan?.storyboardArtifact?.artifactId ?? null,
    parentArtifactId: null,
    summary: {
      role: conversation.role ?? null,
      revision: conversation.revision ?? null,
      latestTurnId: conversation.latestTurnId ?? null,
      messageCount: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
      threadStopped: Boolean(conversation.threadStopped),
    },
    sourceOfTruth: "Runtime/AgentConversations/*.json",
    indexSource: "Apps/Api/lib/agent-chat/conversation-store.js",
  });
}

function moduleSummary(module) {
  if (!module) return null;
  return baseSummary({
    resourceKind: "module",
    resourceId: module.moduleId,
    label: module.ui?.displayName ?? module.moduleId,
    status: "available",
    createdAt: null,
    updatedAt: null,
    runId: null,
    traceId: null,
    stageId: null,
    artifactId: null,
    parentArtifactId: null,
    summary: {
      moduleKind: module.moduleKind ?? null,
      executorKind: module.executorKind ?? null,
      cacheKind: module.cacheKind ?? null,
      artifactType: module.artifactType ?? null,
      supportsCacheReuse: Boolean(module.supportsCacheReuse),
      supportsRerun: Boolean(module.supportsRerun),
    },
    sourceOfTruth: "Apps/Api/lib/modules/catalog.js",
    indexSource: "Apps/Api/lib/modules/registry.js",
  });
}

function traceSummary(trace) {
  if (!trace) return null;
  const latestEvent = normalizeText(trace.latestEvent);
  return baseSummary({
    resourceKind: "trace",
    resourceId: trace.traceId,
    label: trace.latestStageName ?? trace.traceId,
    status: latestEvent === "stage.fail" ? "failed" : latestEvent ?? "updated",
    createdAt: null,
    updatedAt: trace.updatedAt,
    runId: null,
    traceId: trace.traceId,
    stageId: null,
    artifactId: null,
    parentArtifactId: null,
    summary: {
      latestEvent,
      latestStageName: trace.latestStageName ?? null,
      logUri: safeRuntimeUri(trace.logUri),
      eventCount: Array.isArray(trace.events) ? trace.events.length : null,
      errorSummary: trace.errorSummary ?? null,
    },
    sourceOfTruth: "Runtime/DebugSnapshots/<traceId>.log.jsonl",
    indexSource: "Apps/Api/lib/observability/debug-traces.js",
  });
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
  RESOURCE_LIST_SCHEMA_VERSION,
  RESOURCE_SUMMARY_SCHEMA_VERSION,
  createResourceResolver,
};
