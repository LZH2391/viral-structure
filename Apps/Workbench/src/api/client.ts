import type { BackendCapabilities, DebugTraceDetail, DebugTraceSummary, LibraryItemDetail, LibraryItemSummary, ProcessingJob, SampleArtifact, ThreadPoolHealth, ThreadPoolRoleDetail, ThreadPoolRoleSummary, UiDebugEventRequest } from "../types";

const WORKSPACE_ID = "default-workspace";

export const API_BASE_URL = location.protocol.startsWith("http") ? location.origin : "http://127.0.0.1:5177";

export type UploadSampleResponse =
  | { cacheHit: true; cachedItem: LibraryItemSummary; fileHash?: string }
  | { processingJobId: string; sampleVideoId: string; traceId: string; cacheHit?: false };

export type ShotBoundaryStartResponse =
  | { cacheHit: true; cachedItem: LibraryItemSummary }
  | { processingJobId: string; sampleVideoId: string; traceId: string; cacheHit?: false };

export async function uploadSampleVideo(file: File, options: { frameSampleRateFps?: number; enableAudioSeparation?: boolean; enableSubtitleRecognition?: boolean; enableAudioFeatureAnalysis?: boolean; cacheDecision?: "ask" | "refresh" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 1));
  formData.append("enableAudioSeparation", String(Boolean(options.enableAudioSeparation)));
  formData.append("enableSubtitleRecognition", String(Boolean(options.enableSubtitleRecognition)));
  formData.append("enableAudioFeatureAnalysis", String(Boolean(options.enableAudioFeatureAnalysis)));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${WORKSPACE_ID}/sample-videos`, {
    method: "POST",
    body: formData,
  });
  return readJson<UploadSampleResponse>(response);
}

export async function getCapabilities() {
  return readJson<BackendCapabilities>(await fetch(`${API_BASE_URL}/api/capabilities`));
}

export async function getProcessingJob(jobId: string) {
  return readJson<ProcessingJob>(await fetch(`${API_BASE_URL}/api/processing-jobs/${jobId}`));
}

export async function getSampleArtifact(sampleVideoId: string) {
  return readJson<SampleArtifact>(await fetch(`${API_BASE_URL}/api/sample-videos/${sampleVideoId}/artifact`));
}

export async function startShotBoundaryAnalysis(sampleVideoId: string, options: { analysisFps?: number; cacheDecision?: "ask" | "reuse" | "refresh" } = {}) {
  return readJson<ShotBoundaryStartResponse>(
    await fetch(`${API_BASE_URL}/api/sample-videos/${encodeURIComponent(sampleVideoId)}/shot-boundary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ analysisFps: options.analysisFps ?? 1, cacheDecision: options.cacheDecision ?? "ask" }),
    }),
  );
}

export async function getThreadPoolHealth() {
  return readJson<ThreadPoolHealth>(await fetch(`${API_BASE_URL}/api/threadpool/health`));
}

export async function getThreadPoolRoles() {
  return readJson<{ ok: boolean; roles: ThreadPoolRoleSummary[]; health?: ThreadPoolHealth }>(await fetch(`${API_BASE_URL}/api/threadpool/roles`));
}

export async function getThreadPoolRoleStatus(role: string) {
  return readJson<ThreadPoolRoleDetail>(await fetch(`${API_BASE_URL}/api/threadpool/roles/${encodeURIComponent(role)}/status`));
}

export async function discardThreadPoolThread(threadId: string) {
  return readJson<{ ok: boolean; thread_id: string; status: string }>(
    await fetch(`${API_BASE_URL}/api/threadpool/threads/${encodeURIComponent(threadId)}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "manual-discard-from-workbench" }),
    }),
  );
}

export async function releaseThreadPoolOwnerLeases(ownerId: string) {
  return readJson<{ ok: boolean }>(
    await fetch(`${API_BASE_URL}/api/threadpool/leases/release-owner`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId }),
    }),
  );
}

export async function getDebugTraces() {
  return readJson<{ traces: DebugTraceSummary[] }>(await fetch(`${API_BASE_URL}/api/debug/traces`));
}

export async function getDebugTraceDetail(traceId: string) {
  return readJson<DebugTraceDetail>(await fetch(`${API_BASE_URL}/api/debug/traces/${encodeURIComponent(traceId)}`));
}

export async function getLibraryItems() {
  return readJson<{ items: LibraryItemSummary[] }>(await fetch(`${API_BASE_URL}/api/library/items`));
}

export async function getLibraryItemDetail(sampleVideoId: string) {
  return readJson<LibraryItemDetail>(await fetch(`${API_BASE_URL}/api/library/items/${encodeURIComponent(sampleVideoId)}`));
}

export async function loadLibraryItem(sampleVideoId: string) {
  return readJson<{ sampleArtifact: SampleArtifact }>(
    await fetch(`${API_BASE_URL}/api/library/items/${encodeURIComponent(sampleVideoId)}/load`, {
      method: "POST",
    }),
  );
}

export async function deleteLibraryItemCache(sampleVideoId: string) {
  return readJson<{ ok: true; removedSampleVideoIds: string[] }>(
    await fetch(`${API_BASE_URL}/api/library/items/${encodeURIComponent(sampleVideoId)}/cache`, {
      method: "DELETE",
    }),
  );
}

export async function postUiDebugEvent(event: UiDebugEventRequest) {
  return readJson<{ ok: true; debugSnapshotUri?: string | null }>(
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

async function readJson<T>(response: Response): Promise<T> {
  const json = await response.json();
  if (!response.ok) throw new Error(json.message || json.error || "API 请求失败");
  return json as T;
}
