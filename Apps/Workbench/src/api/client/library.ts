import type { DebugTraceDetail, DebugTraceSummary, FunctionSlotLibraryGraph, LibraryItemDetail, LibraryItemSummary, ReplacementCandidate, SampleArtifact, UiDebugEventRequest } from "../../types";
import type { FunctionSlotGovernanceRunResponse, FunctionSlotGovernanceSchedulerState, FunctionSlotLibraryBuilderRefreshResponse, FunctionSlotWorkflowPlaceholderResponse } from "./types";
import { API_BASE_URL, buildQuery, readJsonResponse } from "./shared";

export async function getDebugTraces() {
  return readJsonResponse<{ traces: DebugTraceSummary[] }>(await fetch(`${API_BASE_URL}/api/debug/traces`));
}

export async function getDebugTraceDetail(traceId: string) {
  return readJsonResponse<DebugTraceDetail>(await fetch(`${API_BASE_URL}/api/debug/traces/${encodeURIComponent(traceId)}`));
}

export async function getLibraryItems() {
  return readJsonResponse<{ items: LibraryItemSummary[] }>(await fetch(`${API_BASE_URL}/api/library/items`));
}

export async function getFunctionSlotLibraryItems() {
  return readJsonResponse<{ items: Array<{ artifactId: string; sampleVideoId?: string | null; sourceVideoName?: string | null; traceId?: string | null; counts?: Record<string, number> }> }>(
    await fetch(`${API_BASE_URL}/api/function-slot-library`, { cache: "no-store" }),
  );
}

export async function getFunctionSlotReplacementCandidates(payload: { kind: "slot" | "atom"; atomKind?: "script" | "rhythm" | "packaging" | null; slotSubtypeId?: string | null; q?: string | null; limit?: number | null }) {
  const query = buildQuery({
    kind: payload.kind,
    atomKind: payload.atomKind,
    slotSubtypeId: payload.slotSubtypeId,
    q: payload.q,
    limit: payload.limit,
  });
  return readJsonResponse<{ ok: boolean; schemaVersion: string; kind: string; atomKind?: string | null; candidates: ReplacementCandidate[]; source?: Record<string, unknown> }>(
    await fetch(`${API_BASE_URL}/api/function-slot-library/replacement-candidates${query}`, { cache: "no-store" }),
  );
}

export async function getFunctionSlotLibraryGraph(artifactId: string) {
  return readJsonResponse<FunctionSlotLibraryGraph>(await fetch(`${API_BASE_URL}/api/function-slot-library/${encodeURIComponent(artifactId)}/graph`, { cache: "no-store" }));
}

export async function getFunctionSlotGovernanceGraph() {
  return readJsonResponse<FunctionSlotLibraryGraph>(await fetch(`${API_BASE_URL}/api/function-slot-library/governance/graph`, { cache: "no-store" }));
}

export async function refreshFunctionSlotLibraryBuilder(payload: { mode?: "skip-existing" | "replace"; updateGovernance?: boolean } = {}) {
  return readJsonResponse<FunctionSlotLibraryBuilderRefreshResponse>(
    await fetch(`${API_BASE_URL}/api/function-slot-library/builder/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function startFunctionSlotGovernanceRun(payload: { refreshEvidence?: boolean } = {}) {
  return readJsonResponse<FunctionSlotGovernanceRunResponse>(
    await fetch(`${API_BASE_URL}/api/function-slot-library/governance/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function getFunctionSlotGovernanceSchedulerState() {
  return readJsonResponse<FunctionSlotGovernanceSchedulerState>(
    await fetch(`${API_BASE_URL}/api/function-slot-library/governance/scheduler-state`, { cache: "no-store" }),
  );
}

export async function autoRunShotStoryboardPrep(payload: { sampleVideoId?: string | null; restructureFinalPath?: string | null; shotDesignFinalPath?: string | null; restructureArtifactId?: string | null; parentArtifactId?: string | null; confirmationId?: string | null; conversationId?: string | null; runImageGeneration?: boolean; runPdfAgent?: boolean } = {}) {
  return readJsonResponse<FunctionSlotWorkflowPlaceholderResponse>(
    await fetch(`${API_BASE_URL}/api/function-slot-workflow/storyboard-prep/auto-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function getFunctionSlotConfirmedPlanTraceGraph() {
  return readJsonResponse<FunctionSlotLibraryGraph>(
    await fetch(`${API_BASE_URL}/api/function-slot-restructure/confirmed-plan-trace/graph`, { cache: "no-store" }),
  );
}

export type FunctionSlotPlanTraceBucket = "recent" | "history";

export type FunctionSlotPlanTraceVariant = {
  versionId: string | null;
  versionName: string | null;
  sourceRestructurePath: string;
  displayJsonPath: string | null;
  artifactId?: string | null;
  traceId?: string | null;
  runId?: string | null;
  stageId?: string | null;
};

export type FunctionSlotPlanTraceRecord = {
  schemaVersion: string;
  recordId: string;
  planSetId: string;
  title: string;
  mode: "single" | "multiVersion" | string;
  status: "draft" | "confirmed" | "archived" | string;
  sourceTurnId?: string | null;
  parentArtifactId?: string | null;
  confirmationId?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  variants: FunctionSlotPlanTraceVariant[];
};

export type FunctionSlotPlanTraceRecordsResponse = {
  schemaVersion: string;
  bucket: FunctionSlotPlanTraceBucket;
  generatedAt: string | null;
  recentWindowHours: number;
  records: FunctionSlotPlanTraceRecord[];
};

export async function listFunctionSlotPlanTraceRecords(bucket: FunctionSlotPlanTraceBucket = "recent") {
  return readJsonResponse<FunctionSlotPlanTraceRecordsResponse>(
    await fetch(`${API_BASE_URL}/api/function-slot-restructure/plan-trace/records?bucket=${encodeURIComponent(bucket)}`, { cache: "no-store" }),
  );
}

export async function getFunctionSlotPlanTraceRecordGraph(recordId: string) {
  return readJsonResponse<FunctionSlotLibraryGraph>(
    await fetch(`${API_BASE_URL}/api/function-slot-restructure/plan-trace/records/${encodeURIComponent(recordId)}/graph`, { cache: "no-store" }),
  );
}

export async function previewFunctionSlotPlanTraceGraph(payload: { restructureFinalPath?: string | null; displayJsonPath?: string | null; sourceTurnId?: string | null; parentArtifactId?: string | null; confirmationId?: string | null }) {
  return readJsonResponse<{ schemaVersion: string; ok: boolean; record: FunctionSlotPlanTraceRecord | null; graph: FunctionSlotLibraryGraph; message?: string | null }>(
    await fetch(`${API_BASE_URL}/api/function-slot-restructure/plan-trace/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function registerFunctionSlotConfirmedPlanTrace(payload: { restructureFinalPath?: string | null; displayJsonPath?: string | null; sourceTurnId?: string | null; parentArtifactId?: string | null; confirmationId?: string | null }) {
  return readJsonResponse<{ ok: boolean; artifactId?: string | null; planId?: string | null; traceId?: string | null; runId?: string | null; stageId?: string | null; traceGraphPath?: string | null; error?: string | null; message?: string | null }>(
    await fetch(`${API_BASE_URL}/api/function-slot-restructure/confirmed-plan-trace/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function startFunctionSlotWorkflowPlaceholder(
  workflowKey: "semantic-governance" | "restructure" | "shot-storyboard-prep",
  payload: { sampleVideoId?: string | null; parentArtifactId?: string | null } = {},
) {
  return readJsonResponse<FunctionSlotWorkflowPlaceholderResponse>(
    await fetch(`${API_BASE_URL}/api/function-slot-workflow/${encodeURIComponent(workflowKey)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function getLibraryItemDetail(sampleVideoId: string) {
  return readJsonResponse<LibraryItemDetail>(await fetch(`${API_BASE_URL}/api/library/items/${encodeURIComponent(sampleVideoId)}`));
}

export async function loadLibraryItem(sampleVideoId: string) {
  return readJsonResponse<{ sampleArtifact: SampleArtifact }>(
    await fetch(`${API_BASE_URL}/api/library/items/${encodeURIComponent(sampleVideoId)}/load`, {
      method: "POST",
    }),
  );
}

export async function deleteLibraryItemCache(sampleVideoId: string) {
  return readJsonResponse<{ ok: true; removedSampleVideoIds: string[] }>(
    await fetch(`${API_BASE_URL}/api/library/items/${encodeURIComponent(sampleVideoId)}/cache`, {
      method: "DELETE",
    }),
  );
}

export async function postUiDebugEvent(event: UiDebugEventRequest) {
  return readJsonResponse<{ ok: true; debugSnapshotUri?: string | null }>(
    await fetch(`${API_BASE_URL}/api/debug/ui-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    }),
  );
}
