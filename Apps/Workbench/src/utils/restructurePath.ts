export function extractRestructureFinalPath(text?: string | null) {
  const value = String(text ?? "");
  const match = value.match(/(?:[A-Za-z]:[\\/][^\s)\]]+)?Artifacts[\\/]+FunctionSlotRestructure[\\/]+[^\s)\]]+[\\/]restructure\.final\.md/i);
  return match?.[0] ?? null;
}

export function normalizeRestructureFinalPath(pathText?: string | null) {
  const text = String(pathText ?? "").trim();
  if (!text) return null;
  const normalized = text.replace(/\\/g, "/").replace(/^\/*[A-Za-z]:\//, "");
  const marker = "Artifacts/FunctionSlotRestructure/";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index) : normalized;
}
