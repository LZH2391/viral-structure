import type { DebugTraceDetail, DebugTraceSummary, ProcessingJob, SampleArtifact, UiDebugEventRequest } from "../types";

const WORKSPACE_ID = "default-workspace";

export const API_BASE_URL = location.protocol.startsWith("http") ? location.origin : "http://127.0.0.1:5177";

export async function uploadSampleVideo(file: File, options: { frameSampleRateFps?: number } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 1));
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${WORKSPACE_ID}/sample-videos`, {
    method: "POST",
    body: formData,
  });
  return readJson<{ processingJobId: string; sampleVideoId: string; traceId: string }>(response);
}

export async function getProcessingJob(jobId: string) {
  return readJson<ProcessingJob>(await fetch(`${API_BASE_URL}/api/processing-jobs/${jobId}`));
}

export async function getSampleArtifact(sampleVideoId: string) {
  return readJson<SampleArtifact>(await fetch(`${API_BASE_URL}/api/sample-videos/${sampleVideoId}/artifact`));
}

export async function getDebugTraces() {
  return readJson<{ traces: DebugTraceSummary[] }>(await fetch(`${API_BASE_URL}/api/debug/traces`));
}

export async function getDebugTraceDetail(traceId: string) {
  return readJson<DebugTraceDetail>(await fetch(`${API_BASE_URL}/api/debug/traces/${encodeURIComponent(traceId)}`));
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
