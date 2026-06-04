const RESOURCE_CATALOG_SCHEMA_VERSION = "platform_resource_catalog.v1";

const RESOURCE_KIND_ENTRIES = [
  {
    resourceKind: "sample",
    label: "样例",
    idFields: ["sampleVideoId"],
    sourceOfTruth: "Runtime/Artifacts/<sampleVideoId>/artifact.json",
    indexSource: "Infrastructure/ArtifactIndex",
    supportsList: true,
    supportsRead: true,
    supportsLineage: true,
    supportsActions: true,
    internal: false,
  },
  {
    resourceKind: "artifact",
    label: "产物",
    idFields: ["artifactId"],
    sourceOfTruth: "Runtime artifact refs / sample artifact / FunctionSlotLibrary",
    indexSource: "ArtifactIndex artifactTree / future ArtifactResolver",
    supportsList: false,
    supportsRead: true,
    supportsLineage: true,
    supportsActions: true,
    internal: false,
  },
  {
    resourceKind: "workflowRun",
    label: "工作流运行",
    idFields: ["workflowRunId"],
    sourceOfTruth: "Runtime/WorkflowRuns/runs/*.json",
    indexSource: "Runtime/WorkflowRuns/workflow-runs.json",
    supportsList: true,
    supportsRead: true,
    supportsLineage: true,
    supportsActions: true,
    internal: false,
  },
  {
    resourceKind: "job",
    label: "后台任务",
    idFields: ["jobId"],
    sourceOfTruth: "Runtime/Jobs/active-jobs.json / Runtime/Jobs/archive/*.jsonl",
    indexSource: "Apps/Api/lib/stores/job-store.js",
    supportsList: true,
    supportsRead: true,
    supportsLineage: true,
    supportsActions: true,
    internal: false,
  },
  {
    resourceKind: "module",
    label: "后端能力模块",
    idFields: ["moduleId"],
    sourceOfTruth: "Apps/Api/lib/modules/catalog.js",
    indexSource: "Apps/Api/lib/modules/registry.js",
    supportsList: true,
    supportsRead: true,
    supportsLineage: false,
    supportsActions: true,
    internal: false,
  },
  {
    resourceKind: "trace",
    label: "追踪链路",
    idFields: ["traceId"],
    sourceOfTruth: "Runtime/DebugSnapshots/<traceId>.log.jsonl",
    indexSource: "Apps/Api/lib/observability/debug-traces.js",
    supportsList: true,
    supportsRead: true,
    supportsLineage: true,
    supportsActions: false,
    internal: false,
  },
  {
    resourceKind: "debugSnapshot",
    label: "调试快照",
    idFields: ["snapshotId"],
    sourceOfTruth: "Runtime/DebugSnapshots/<snapshotId>.json",
    indexSource: "Runtime/DebugSnapshots/<traceId>.log.jsonl",
    supportsList: false,
    supportsRead: false,
    supportsLineage: false,
    supportsActions: false,
    internal: false,
  },
  {
    resourceKind: "activeTurn",
    label: "运行中 Agent Turn",
    idFields: ["bindingId", "turnId"],
    sourceOfTruth: "Runtime/ActiveTurns/active-turns.json",
    indexSource: "Apps/Api/lib/active-turns/store.js",
    supportsList: true,
    supportsRead: true,
    supportsLineage: true,
    supportsActions: true,
    internal: false,
  },
  {
    resourceKind: "conversation",
    label: "Agent 会话",
    idFields: ["conversationId"],
    sourceOfTruth: "Runtime/AgentConversations/*.json",
    indexSource: "Apps/Api/lib/agent-chat/conversation-store.js",
    supportsList: true,
    supportsRead: true,
    supportsLineage: true,
    supportsActions: true,
    internal: false,
  },
  {
    resourceKind: "libraryItem",
    label: "功能槽位库条目",
    idFields: ["artifactId"],
    sourceOfTruth: "Artifacts/FunctionSlotLibrary/<artifactId>/*",
    indexSource: "Apps/Api/lib/function-slot-library/service.js",
    supportsList: true,
    supportsRead: true,
    supportsLineage: true,
    supportsActions: true,
    internal: false,
  },
  {
    resourceKind: "projection",
    label: "派生投影",
    idFields: ["projectionId", "artifactId"],
    sourceOfTruth: "Runtime/Projection/*",
    indexSource: "Infrastructure/FunctionSlotProjection",
    supportsList: false,
    supportsRead: true,
    supportsLineage: true,
    supportsActions: false,
    internal: true,
  },
];

function createResourceCatalog({ entries = RESOURCE_KIND_ENTRIES } = {}) {
  const normalizedEntries = entries.map(normalizeEntry);

  function list({ includeInternal = false } = {}) {
    return normalizedEntries
      .filter((entry) => includeInternal || !entry.internal)
      .map(toPublicEntry);
  }

  function get(resourceKind, { includeInternal = true } = {}) {
    const entry = normalizedEntries.find((item) => item.resourceKind === resourceKind) ?? null;
    if (!entry || (!includeInternal && entry.internal)) return null;
    return toPublicEntry(entry);
  }

  return {
    schemaVersion: RESOURCE_CATALOG_SCHEMA_VERSION,
    list,
    get,
  };
}

function normalizeEntry(entry) {
  return {
    resourceKind: String(entry.resourceKind ?? "").trim(),
    label: String(entry.label ?? "").trim(),
    idFields: Array.isArray(entry.idFields) ? entry.idFields.map((field) => String(field).trim()).filter(Boolean) : [],
    sourceOfTruth: entry.sourceOfTruth ?? null,
    indexSource: entry.indexSource ?? null,
    supportsList: Boolean(entry.supportsList),
    supportsRead: Boolean(entry.supportsRead),
    supportsLineage: Boolean(entry.supportsLineage),
    supportsActions: Boolean(entry.supportsActions),
    internal: Boolean(entry.internal),
  };
}

function toPublicEntry(entry) {
  return {
    schemaVersion: RESOURCE_CATALOG_SCHEMA_VERSION,
    resourceKind: entry.resourceKind,
    label: entry.label,
    idFields: entry.idFields,
    sourceOfTruth: entry.sourceOfTruth,
    indexSource: entry.indexSource,
    supportsList: entry.supportsList,
    supportsRead: entry.supportsRead,
    supportsLineage: entry.supportsLineage,
    supportsActions: entry.supportsActions,
  };
}

module.exports = {
  RESOURCE_CATALOG_SCHEMA_VERSION,
  RESOURCE_KIND_ENTRIES,
  createResourceCatalog,
};
