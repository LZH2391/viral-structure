import { API_BASE_URL, readJsonResponse } from "./client";

export type PlatformResourceKind =
  | "sample"
  | "artifact"
  | "workflowRun"
  | "job"
  | "module"
  | "trace"
  | "debugSnapshot"
  | "activeTurn"
  | "conversation"
  | "libraryItem"
  | "projection"
  | string;

export type PlatformResourceRef = {
  resourceKind: PlatformResourceKind;
  resourceId: string | null;
};

export type PlatformResourceCatalogEntry = {
  schemaVersion: "platform_resource_catalog.v1" | string;
  resourceKind: PlatformResourceKind;
  label: string;
  idFields: string[];
  sourceOfTruth: string | null;
  indexSource: string | null;
  supportsList: boolean;
  supportsRead: boolean;
  supportsLineage: boolean;
  supportsActions: boolean;
};

export type PlatformCatalogResponse = {
  schemaVersion: "platform_catalog_response.v1" | string;
  catalogVersion: string;
  resources: PlatformResourceCatalogEntry[];
};

export type PlatformResourceSummary = {
  schemaVersion: "platform_resource_summary.v1" | string;
  resourceKind: PlatformResourceKind;
  resourceId: string;
  label: string | null;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  runId: string | null;
  traceId: string | null;
  stageId: string | null;
  artifactId: string | null;
  parentArtifactId: string | null;
  summary: Record<string, unknown> | null;
  source: {
    sourceOfTruth: string | null;
    indexSource: string | null;
  };
};

export type AnalysisHistoryProjectionItem = {
  sampleVideoId: string;
  title: string | null;
  status: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  artifactId: string | null;
  traceId: string | null;
  runId: string | null;
  stageId: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  coverUri: string | null;
  videoUri: string | null;
  hasFunctionSlotAtomization: boolean;
  hasUserMaterialPack: boolean;
  isIncomplete: boolean;
  isRunning: boolean;
};

export type AnalysisHistoryProjectionSummary = {
  schemaVersion: "analysis_history_projection.v1" | string;
  generatedAt: string | null;
  items: AnalysisHistoryProjectionItem[];
};

export type PlatformResourceListResponse = {
  schemaVersion: "platform_resource_list.v1" | string;
  resourceKind: PlatformResourceKind;
  resources: PlatformResourceSummary[];
};

export type PlatformMediaKind = "video" | "audio" | "image" | "json" | "text" | "unknown" | string;

export type PlatformArtifactResolution = {
  schemaVersion: "artifact_resolution.v1" | string;
  artifactId: string | null;
  artifactType: string | null;
  stageName: string | null;
  parentArtifactId: string | null;
  sampleVideoId: string | null;
  runId: string | null;
  traceId: string | null;
  stageId: string | null;
  uri: string | null;
  mediaKind: PlatformMediaKind;
  exists: boolean;
  readable: boolean;
  summary: Record<string, unknown> | null;
  source: {
    sourceOfTruth: string | null;
    indexSource: string | null;
  };
};

export type PlatformRuntimeStatus =
  | "idle"
  | "queued"
  | "running"
  | "waiting"
  | "blocked"
  | "processed"
  | "partial_failed"
  | "failed"
  | "canceled"
  | string;

export type PlatformRuntimeStage = {
  key: string;
  stageName: string | null;
  status: string;
  runId: string | null;
  traceId: string | null;
  stageId: string | null;
  artifactId: string | null;
  parentArtifactId: string | null;
  errorSummary: Record<string, unknown> | null;
};

export type PlatformRuntimeState = {
  schemaVersion: "runtime_state.v1" | string;
  resource: PlatformResourceRef;
  status: PlatformRuntimeStatus;
  rawStatus: string | null;
  progress: number | null;
  currentStages: PlatformRuntimeStage[];
  retryable: boolean | null;
  errorSummary: Record<string, unknown> | null;
  source?: {
    sourceOfTruth: string | null;
    indexSource: string | null;
  };
};

export type PlatformAction = {
  actionKey: string;
  label: string;
  enabled: boolean;
  disabledReason: string | null;
  requiresConfirm: boolean;
  dangerLevel: "none" | "low" | "medium" | "high" | string;
  inputSchema: Record<string, unknown> | null;
  effects: {
    createsRun: boolean;
    createsArtifact: boolean;
    mayInvalidateDownstream: boolean;
    affectedResourceRefs: PlatformResourceRef[];
  };
};

export type PlatformActionsResponse = {
  schemaVersion: "platform_actions_response.v1" | string;
  resource: PlatformResourceRef;
  actions: PlatformAction[];
};

export type PlatformLineageEdge = {
  from: PlatformResourceRef;
  to: PlatformResourceRef;
  relation: string;
};

export type PlatformLineageResponse = {
  schemaVersion: "resource_lineage.v1" | string;
  root: PlatformResourceRef;
  nodes: PlatformResourceSummary[];
  edges: PlatformLineageEdge[];
};

export type PlatformTraceErrorSummary = {
  code: string | null;
  message: string | null;
  stageName: string | null;
  retryable: boolean | null;
  debugSnapshotUri: string | null;
};

export type PlatformTraceStageSummary = {
  event: string | null;
  runId: string | null;
  traceId: string | null;
  stageId: string | null;
  stageName: string | null;
  artifactId: string | null;
  parentArtifactId: string | null;
  relatedTraceId: string | null;
  createdAt: string | null;
  durationMs: number | null;
  inputSummary: Record<string, unknown> | null;
  outputSummary: Record<string, unknown> | null;
  errorSummary: PlatformTraceErrorSummary | null;
};

export type PlatformTraceDetail = {
  schemaVersion: "platform_trace_detail.v1" | string;
  traceId: string;
  status: string | null;
  updatedAt: string | null;
  latestEvent: string | null;
  latestStageName: string | null;
  runId: string | null;
  stageId: string | null;
  artifactId: string | null;
  parentArtifactId: string | null;
  logUri: string | null;
  errorSummary: PlatformTraceErrorSummary | null;
  eventCount: number;
  stages: PlatformTraceStageSummary[];
  source: {
    sourceOfTruth: string;
    indexSource: string;
  };
};

export type PlatformCommandRequest = {
  command: string;
  target: PlatformResourceRef;
  options?: Record<string, unknown>;
  expectedRevision?: number | null;
};

export type PlatformCommandResult = {
  schemaVersion: "platform_command_result.v1" | string;
  ok: boolean;
  command: string;
  target: PlatformResourceRef;
  status: string | null;
  runId: string | null;
  traceId: string | null;
  stageId: string | null;
  artifactId: string | null;
  parentArtifactId: string | null;
  resourceRefs: PlatformResourceRef[];
  errorSummary: Record<string, unknown> | null;
};

export async function getPlatformCatalog(options: { includeInternal?: boolean } = {}) {
  return readJsonResponse<PlatformCatalogResponse>(
    await fetch(`${API_BASE_URL}/api/platform/v1/catalog${buildQuery({ includeInternal: options.includeInternal || undefined })}`, { cache: "no-store" }),
  );
}

export async function listPlatformResources(resourceKind: PlatformResourceKind) {
  return readJsonResponse<PlatformResourceListResponse>(
    await fetch(`${API_BASE_URL}/api/platform/v1/resources${buildQuery({ kind: resourceKind })}`, { cache: "no-store" }),
  );
}

export async function getPlatformResource(resourceKind: PlatformResourceKind, resourceId: string) {
  return readJsonResponse<PlatformResourceSummary>(
    await fetch(`${API_BASE_URL}/api/platform/v1/resources/${encodeURIComponent(resourceKind)}/${encodeURIComponent(resourceId)}`, { cache: "no-store" }),
  );
}

export async function getAnalysisHistoryProjection() {
  return readJsonResponse<PlatformResourceSummary & { summary: AnalysisHistoryProjectionSummary }>(
    await fetch(`${API_BASE_URL}/api/platform/v1/resources/projection/analysis-history`, { cache: "no-store" }),
  );
}

export async function getPlatformResourceActions(resourceKind: PlatformResourceKind, resourceId: string) {
  return readJsonResponse<PlatformActionsResponse>(
    await fetch(`${API_BASE_URL}/api/platform/v1/resources/${encodeURIComponent(resourceKind)}/${encodeURIComponent(resourceId)}/actions`, { cache: "no-store" }),
  );
}

export async function getPlatformResourceLineage(resourceKind: PlatformResourceKind, resourceId: string) {
  return readJsonResponse<PlatformLineageResponse>(
    await fetch(`${API_BASE_URL}/api/platform/v1/resources/${encodeURIComponent(resourceKind)}/${encodeURIComponent(resourceId)}/lineage`, { cache: "no-store" }),
  );
}

export async function getPlatformArtifact(artifactId: string, options: { sampleVideoId?: string | null } = {}) {
  return readJsonResponse<PlatformArtifactResolution>(
    await fetch(`${API_BASE_URL}/api/platform/v1/artifacts/${encodeURIComponent(artifactId)}${buildQuery({ sampleVideoId: options.sampleVideoId })}`, { cache: "no-store" }),
  );
}

export async function getPlatformRuntimeState(resourceKind: PlatformResourceKind, resourceId: string) {
  return readJsonResponse<PlatformRuntimeState>(
    await fetch(`${API_BASE_URL}/api/platform/v1/runtime-state/${encodeURIComponent(resourceKind)}/${encodeURIComponent(resourceId)}`, { cache: "no-store" }),
  );
}

export async function getPlatformTrace(traceId: string) {
  return readJsonResponse<PlatformTraceDetail>(
    await fetch(`${API_BASE_URL}/api/platform/v1/traces/${encodeURIComponent(traceId)}`, { cache: "no-store" }),
  );
}

export async function executePlatformCommand(request: PlatformCommandRequest) {
  return readJsonResponse<PlatformCommandResult>(
    await fetch(`${API_BASE_URL}/api/platform/v1/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
}

export function buildPlatformResourceRef(resourceKind: PlatformResourceKind, resourceId: string | null): PlatformResourceRef {
  return { resourceKind, resourceId };
}

function buildQuery(params: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}
