export const WORKSPACE_ID = "default-workspace";

export const API_BASE_URL = location.protocol.startsWith("http") ? location.origin : "http://127.0.0.1:5177";

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

export function buildQuery(params: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}
