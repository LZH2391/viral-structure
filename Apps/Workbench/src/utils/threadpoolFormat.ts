export type ThreadContextUsage = {
  text: string;
  level: "normal" | "warn" | "danger";
};

export function formatThreadContextUsage(latest?: number | null, threshold?: number | null): ThreadContextUsage {
  if (!Number.isFinite(latest) || !Number.isFinite(threshold) || !threshold || Number(threshold) <= 0) {
    if (Number.isFinite(threshold) && Number(threshold) > 0) {
      return { text: `ctx - / ${Number(threshold)} (unknown)`, level: "normal" };
    }
    return { text: "ctx unknown", level: "normal" };
  }
  const percent = Math.max(0, Math.round((Number(latest) / Number(threshold)) * 100));
  return {
    text: `ctx ${Number(latest)} / ${Number(threshold)} (${percent}%)`,
    level: percent >= 90 ? "danger" : percent >= 70 ? "warn" : "normal",
  };
}
