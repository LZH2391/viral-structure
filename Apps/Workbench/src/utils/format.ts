export function createId(prefix: string): string {
  const randomPart =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomPart}`;
}

export function formatTime(value: number | undefined | null): string {
  if (!Number.isFinite(value)) return "00:00";
  const safeValue = Number(value);
  const minutes = Math.floor(safeValue / 60).toString().padStart(2, "0");
  const seconds = Math.floor(safeValue % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function sanitizeText(value: unknown, maxLength = 72): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function shortId(value: unknown, length = 8): string {
  return String(value ?? "").slice(-length);
}

export function formatClock(value?: string): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}
