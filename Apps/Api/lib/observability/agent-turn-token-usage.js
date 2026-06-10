const TEXT_PREVIEW_LIMIT = 240;
const CONTEXT_THRESHOLD_RATIO = 0.8;
const CONTEXT_WARNING_RATIO = 0.65;

function normalizeTurnActivity(value) {
  if (!value || typeof value !== "object") return null;
  return {
    threadId: value.threadId ?? null,
    turnId: value.turnId ?? null,
    status: value.status ?? null,
    itemCount: nullableNumber(value.itemCount) ?? 0,
    effectiveItemCount: nullableNumber(value.effectiveItemCount) ?? 0,
    latestItemType: value.latestItemType ?? null,
    latestMessagePreview: safePreview(value.latestMessagePreview, TEXT_PREVIEW_LIMIT),
    latestToolName: value.latestToolName ?? null,
    tokenUsage: normalizeTokenUsage(value.tokenUsage),
  };
}

function normalizeTurnTokenUsage(turn) {
  if (!turn || typeof turn !== "object") return null;
  const usage = turn.last_token_usage
      ?? turn.lastTokenUsage
      ?? turn.token_usage
      ?? turn.tokenUsage
      ?? turn.usage
      ?? turn.metrics?.token_usage
      ?? turn.metrics?.tokenUsage;
  return normalizeTokenUsage(usage, turn.model_context_window ?? turn.modelContextWindow);
}

function normalizeTokenUsage(usage, fallbackModelContextWindow = null) {
  if (!usage || typeof usage !== "object") return null;
  const nested = usage.last_token_usage ?? usage.lastTokenUsage ?? usage.last ?? null;
  if (nested && nested !== usage) return normalizeTokenUsage(nested, usage.model_context_window ?? usage.modelContextWindow ?? fallbackModelContextWindow);
  const modelContextWindow = nullablePositiveNumber(usage.modelContextWindow ?? usage.model_context_window ?? fallbackModelContextWindow);
  const result = {
    inputTokens: nullableNumber(usage.inputTokens ?? usage.input_tokens),
    outputTokens: nullableNumber(usage.outputTokens ?? usage.output_tokens),
    totalTokens: nullableNumber(usage.totalTokens ?? usage.total_tokens),
    reasoningOutputTokens: nullableNumber(usage.reasoningOutputTokens ?? usage.reasoning_output_tokens),
  };
  const hasTokenUsage = Object.values(result).some((value) => value != null);
  if (!hasTokenUsage && modelContextWindow == null) return null;
  return enrichContextUsage(result, modelContextWindow);
}

function summarizeThreadContextUsage(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const usage = normalizeTurnTokenUsage(turns[index]);
    if (usage) return usage;
  }
  return normalizeTokenUsage(thread?.latest ?? thread?.tokenUsage ?? thread?.usage ?? null);
}

function enrichContextUsage(usage, modelContextWindow) {
  const contextWindow = nullablePositiveNumber(modelContextWindow);
  const inputTokens = nullableNumber(usage.inputTokens);
  const threshold = contextWindow != null && contextWindow > 0 ? Math.round(contextWindow * CONTEXT_THRESHOLD_RATIO) : null;
  const ratio = inputTokens != null && contextWindow != null && contextWindow > 0 ? inputTokens / contextWindow : null;
  return {
    ...usage,
    modelContextWindow: contextWindow,
    contextThresholdTokens: threshold,
    contextUsageRatio: ratio,
    contextUsageState: resolveContextUsageState({ inputTokens, threshold, ratio }),
  };
}

function resolveContextUsageState({ inputTokens, threshold, ratio }) {
  if (inputTokens == null || threshold == null || ratio == null) return "unknown";
  if (inputTokens >= threshold) return "danger";
  if (ratio >= CONTEXT_WARNING_RATIO) return "warning";
  return "normal";
}

function formatTokenUsage(usage) {
  return [
    usage.inputTokens != null ? `input ${usage.inputTokens}` : null,
    usage.outputTokens != null ? `output ${usage.outputTokens}` : null,
    usage.reasoningOutputTokens != null ? `reasoning ${usage.reasoningOutputTokens}` : null,
    usage.totalTokens != null ? `total ${usage.totalTokens}` : null,
  ].filter(Boolean).join(" / ");
}

function safePreview(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullablePositiveNumber(value) {
  const number = nullableNumber(value);
  return number != null && number > 0 ? number : null;
}

module.exports = {
  formatTokenUsage,
  normalizeTokenUsage,
  normalizeTurnActivity,
  normalizeTurnTokenUsage,
  summarizeThreadContextUsage,
};
