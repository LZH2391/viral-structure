import type { AnalysisRoleSummary, BackendCapabilities, DebugTraceDetail, DebugTraceSummary, LibraryItemDetail, LibraryItemSummary, ProcessingJob, SampleArtifact, ThreadConversation, ThreadPoolHealth, ThreadPoolRoleDetail, ThreadPoolRoleSummary, UiDebugEventRequest, WorkflowRun } from "../types";

const WORKSPACE_ID = "default-workspace";

export const API_BASE_URL = location.protocol.startsWith("http") ? location.origin : "http://127.0.0.1:5177";

export type UploadSampleResponse =
  | { cacheHit: true; cachedItem: LibraryItemSummary; fileHash?: string }
  | { processingJobId: string; sampleVideoId: string; traceId: string; cacheHit?: false };

export type ShotBoundaryStartResponse =
  | { cacheHit: true; cachedItem: LibraryItemSummary }
  | { processingJobId: string; sampleVideoId: string; traceId: string; cacheHit?: false };

export type AnalysisStartResponse =
  | { cacheHit: true; cachedItem: LibraryItemSummary }
  | { processingJobId: string; sampleVideoId: string; traceId: string; cacheHit?: false };

export type ScriptSegmentStartResponse = AnalysisStartResponse;
export type RhythmStructureStartResponse = AnalysisStartResponse;
export type PackagingStructureStartResponse = AnalysisStartResponse;

export async function uploadSampleVideo(file: File, options: { frameSampleRateFps?: number; enableAudioSeparation?: boolean; enableSubtitleRecognition?: boolean; enableAudioFeatureAnalysis?: boolean; cacheDecision?: "ask" | "refresh" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 10));
  formData.append("enableAudioSeparation", String(Boolean(options.enableAudioSeparation)));
  formData.append("enableSubtitleRecognition", String(Boolean(options.enableSubtitleRecognition)));
  formData.append("enableAudioFeatureAnalysis", String(Boolean(options.enableAudioFeatureAnalysis)));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${WORKSPACE_ID}/sample-videos`, {
    method: "POST",
    body: formData,
  });
  return readJsonResponse<UploadSampleResponse>(response);
}

export async function startFullAnalysisRun(file: File, options: { frameSampleRateFps?: number; enableAudioSeparation?: boolean; enableSubtitleRecognition?: boolean; enableAudioFeatureAnalysis?: boolean; cacheDecision?: "ask" | "reuse" | "refresh" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("workspaceId", WORKSPACE_ID);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 10));
  formData.append("enableAudioSeparation", String(options.enableAudioSeparation ?? true));
  formData.append("enableSubtitleRecognition", String(options.enableSubtitleRecognition ?? true));
  formData.append("enableAudioFeatureAnalysis", String(options.enableAudioFeatureAnalysis ?? true));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  const response = await fetch(`${API_BASE_URL}/api/workflows/full-analysis/runs`, {
    method: "POST",
    body: formData,
  });
  return readJsonResponse<WorkflowRun>(response);
}

export async function checkFullAnalysisUploadCache(file: File, options: { frameSampleRateFps?: number; cacheDecision?: "ask" | "refresh" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("workspaceId", WORKSPACE_ID);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 10));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  const response = await fetch(`${API_BASE_URL}/api/workflows/full-analysis/cache-check`, {
    method: "POST",
    body: formData,
  });
  return readJsonResponse<{ cacheHit: true; cachedItem: LibraryItemSummary } | { cacheHit: false }>(response);
}

export async function getWorkflowRun(workflowRunId: string) {
  return readJsonResponse<WorkflowRun>(await fetch(`${API_BASE_URL}/api/workflows/runs/${encodeURIComponent(workflowRunId)}`, { cache: "no-store" }));
}

export async function rerunWorkflowStage(workflowRunId: string, stageKey: string) {
  return readJsonResponse<WorkflowRun>(
    await fetch(`${API_BASE_URL}/api/workflows/runs/${encodeURIComponent(workflowRunId)}/stages/${encodeURIComponent(stageKey)}/rerun`, {
      method: "POST",
    }),
  );
}

export async function getCapabilities() {
  return readJsonResponse<BackendCapabilities>(await fetch(`${API_BASE_URL}/api/capabilities`));
}

export async function getAnalysisRoles() {
  return readJsonResponse<{ roles: AnalysisRoleSummary[] }>(await fetch(`${API_BASE_URL}/api/analysis-roles`));
}

export async function getProcessingJob(jobId: string) {
  return readJsonResponse<ProcessingJob>(await fetch(`${API_BASE_URL}/api/processing-jobs/${jobId}`, { cache: "no-store" }));
}

export async function getSampleArtifact(sampleVideoId: string) {
  return readJsonResponse<SampleArtifact>(await fetch(`${API_BASE_URL}/api/sample-videos/${sampleVideoId}/artifact`, { cache: "no-store" }));
}

export async function startShotBoundaryAnalysis(sampleVideoId: string, options: { analysisFps?: number; cacheDecision?: "ask" | "reuse" | "refresh"; enableReview?: boolean } = {}) {
  return readJsonResponse<ShotBoundaryStartResponse>(
    await fetch(`${API_BASE_URL}/api/sample-videos/${encodeURIComponent(sampleVideoId)}/shot-boundary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ analysisFps: options.analysisFps ?? 10, cacheDecision: options.cacheDecision ?? "ask", enableReview: options.enableReview ?? true }),
    }),
  );
}

export async function saveSubtitleRevision(
  sampleVideoId: string,
  segments: Array<{ id: string; start: number; end: number; text: string; confidence?: number | null }>,
  options: { expectedSubtitleArtifactId?: string | null; expectedRevisionIndex?: number | null } = {},
) {
  return readJsonResponse<{ sampleArtifact: SampleArtifact; traceId: string; changed: boolean }>(
    await fetch(`${API_BASE_URL}/api/sample-videos/${encodeURIComponent(sampleVideoId)}/subtitles/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        segments,
        expectedSubtitleArtifactId: options.expectedSubtitleArtifactId ?? null,
        expectedRevisionIndex: options.expectedRevisionIndex ?? null,
      }),
    }),
  );
}

export async function startAnalysisRole(analysisId: string, sampleVideoId: string, options: { cacheDecision?: "ask" | "reuse" | "refresh"; expectedShotBoundaryArtifactId?: string | null } = {}) {
  const dependencies = { shotBoundaryArtifactId: options.expectedShotBoundaryArtifactId ?? null };
  return readJsonResponse<AnalysisStartResponse>(
    await fetch(`${API_BASE_URL}/api/sample-videos/${encodeURIComponent(sampleVideoId)}/analyses/${encodeURIComponent(analysisId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cacheDecision: options.cacheDecision ?? "ask",
        dependencies,
        expectedShotBoundaryArtifactId: options.expectedShotBoundaryArtifactId ?? null,
      }),
    }),
  );
}

export async function startScriptSegmentAnalysis(sampleVideoId: string, options: { cacheDecision?: "ask" | "reuse" | "refresh"; expectedShotBoundaryArtifactId?: string | null } = {}) {
  return startAnalysisRole("script-segments", sampleVideoId, options);
}

export async function startRhythmStructureAnalysis(sampleVideoId: string, options: { cacheDecision?: "ask" | "reuse" | "refresh"; expectedShotBoundaryArtifactId?: string | null } = {}) {
  return startAnalysisRole("rhythm-structure", sampleVideoId, options);
}

export async function startPackagingStructureAnalysis(sampleVideoId: string, options: { cacheDecision?: "ask" | "reuse" | "refresh"; expectedShotBoundaryArtifactId?: string | null } = {}) {
  return startAnalysisRole("packaging-structure", sampleVideoId, options);
}

export async function resolveCacheDecision(jobId: string, decision: "reuse" | "refresh") {
  return readJsonResponse<ProcessingJob>(
    await fetch(`${API_BASE_URL}/api/processing-jobs/${encodeURIComponent(jobId)}/cache-decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    }),
  );
}

export async function resolveShotBoundaryCacheDecision(jobId: string, decision: "reuse" | "refresh") {
  return resolveCacheDecision(jobId, decision);
}

export async function getThreadPoolHealth() {
  return readJsonResponse<ThreadPoolHealth>(await fetch(`${API_BASE_URL}/api/threadpool/health`));
}

export async function getThreadPoolRoles() {
  return readJsonResponse<{ ok: boolean; roles: ThreadPoolRoleSummary[]; health?: ThreadPoolHealth }>(await fetch(`${API_BASE_URL}/api/threadpool/roles`));
}

export async function getThreadPoolRoleStatus(role: string) {
  return readJsonResponse<ThreadPoolRoleDetail>(await fetch(`${API_BASE_URL}/api/threadpool/roles/${encodeURIComponent(role)}/status`));
}

export async function discardThreadPoolThread(threadId: string) {
  return readJsonResponse<{ ok: boolean; thread_id: string; status: string }>(
    await fetch(`${API_BASE_URL}/api/threadpool/threads/${encodeURIComponent(threadId)}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "manual-discard-from-workbench" }),
    }),
  );
}

export async function getThreadConversation(threadId: string) {
  return readJsonResponse<ThreadConversation>(await fetch(`${API_BASE_URL}/api/threadpool/threads/${encodeURIComponent(threadId)}/conversation`));
}

export async function releaseThreadPoolOwnerLeases(ownerId: string) {
  return readJsonResponse<{ ok: boolean }>(
    await fetch(`${API_BASE_URL}/api/threadpool/leases/release-owner`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId }),
    }),
  );
}

export async function getDebugTraces() {
  return readJsonResponse<{ traces: DebugTraceSummary[] }>(await fetch(`${API_BASE_URL}/api/debug/traces`));
}

export async function getDebugTraceDetail(traceId: string) {
  return readJsonResponse<DebugTraceDetail>(await fetch(`${API_BASE_URL}/api/debug/traces/${encodeURIComponent(traceId)}`));
}

export async function getLibraryItems() {
  return readJsonResponse<{ items: LibraryItemSummary[] }>(await fetch(`${API_BASE_URL}/api/library/items`));
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

export function runtimeUrl(uri?: string | null): string | null {
  if (!uri) return null;
  return `${API_BASE_URL}${uri}`;
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = parseJsonResponse(text);
  if (!response.ok) {
    const error = new Error(resolveApiErrorMessage(body.value, text, response.status)) as Error & {
      code?: string;
      traceId?: string | null;
      debugSnapshotUri?: string | null;
      stageName?: string | null;
      retryable?: boolean | null;
      statusCode?: number;
      responseBodySnippet?: string | null;
      responseContentType?: string | null;
    };
    const payload = isRecord(body.value) ? body.value : null;
    error.code = payload ? String(payload.code || payload.error || "api_request_failed") : "api_request_failed";
    error.traceId = payload ? toNullableString(payload.traceId) : null;
    error.debugSnapshotUri = payload ? toNullableString(payload.debugSnapshotUri) : null;
    error.stageName = payload ? toNullableString(payload.stageName) : null;
    error.retryable = payload && typeof payload.retryable === "boolean" ? payload.retryable : null;
    error.statusCode = response.status;
    error.responseBodySnippet = summarizeResponseText(text);
    error.responseContentType = response.headers.get("content-type");
    throw error;
  }
  if (!body.ok && text.trim()) {
    throw new Error(`API 返回了非 JSON 响应: ${summarizeResponseText(text) ?? response.status}`);
  }
  return (body.value ?? {}) as T;
}

function parseJsonResponse(text: string): { ok: boolean; value: unknown | null } {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, value: { raw: trimmed } };
  }
}

function resolveApiErrorMessage(body: unknown, text: string, status: number): string {
  const payload = isRecord(body) ? body : null;
  const candidate = payload ? String(payload.message || payload.error || "") : "";
  if (candidate.trim()) return candidate.slice(0, 240);
  const rawSnippet = summarizeResponseText(text);
  if (rawSnippet) return rawSnippet;
  return `API 请求失败: ${status}`;
}

function summarizeResponseText(text: string): string | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, " ").slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNullableString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}
