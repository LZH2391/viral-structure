function summarizeThreadConversation(thread) {
  const safeThread = thread && typeof thread === "object" ? thread : {};
  const turns = Array.isArray(safeThread.turns) ? safeThread.turns : [];
  return {
    threadId: String(safeThread.id ?? safeThread.threadId ?? ""),
    title: safePreview(safeThread.title ?? safeThread.name ?? null, 120),
    status: String(safeThread.status ?? safeThread.threadStatus ?? "unknown"),
    turns: turns.map((turn) => summarizeTurn(turn)).filter(Boolean),
  };
}

function summarizeTurn(turn) {
  if (!turn || typeof turn !== "object") return null;
  return {
    turnId: String(turn.id ?? turn.turnId ?? ""),
    status: String(turn.status ?? "unknown"),
    createdAt: turn.createdAt ?? turn.created_at ?? null,
    inputSummary: summarizeTurnInput(turn),
    finalMessage: summarizeTurnFinalMessage(turn),
    tokenUsage: summarizeTurnTokenUsage(turn),
  };
}

function summarizeTurnInput(turn) {
  const items = Array.isArray(turn.items) ? turn.items : [];
  const texts = [];
  for (const item of items) {
    const type = String(item?.type ?? "");
    if (!["userMessage", "user_message", "inputText", "text"].includes(type)) continue;
    const text = extractText(item);
    if (text) texts.push(text);
  }
  if (texts.length) return safePreview(texts.join("\n"), 320);
  return safePreview(turn.inputSummary ?? turn.input_summary ?? turn.summary ?? null, 320);
}

function summarizeTurnFinalMessage(turn) {
  if (typeof turn.finalMessage === "string" && turn.finalMessage.trim()) return safePreview(turn.finalMessage, 1200);
  if (typeof turn.final_message === "string" && turn.final_message.trim()) return safePreview(turn.final_message, 1200);
  const items = Array.isArray(turn.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const type = String(item?.type ?? "");
    if (!["agentMessage", "assistantMessage"].includes(type)) continue;
    const text = extractText(item);
    if (text) return safePreview(text, 1200);
  }
  return null;
}

function summarizeTurnTokenUsage(turn) {
  const usage = normalizeTokenUsage(turn.last_token_usage ?? turn.lastTokenUsage ?? turn.token_usage ?? turn.tokenUsage);
  if (usage) return usage;
  return null;
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return {
    inputTokens: toNumberOrNull(usage.input_tokens ?? usage.inputTokens),
    outputTokens: toNumberOrNull(usage.output_tokens ?? usage.outputTokens),
    totalTokens: toNumberOrNull(usage.total_tokens ?? usage.totalTokens),
  };
}

function extractText(item) {
  if (!item || typeof item !== "object") return null;
  if (typeof item.text === "string" && item.text.trim()) return item.text.trim();
  if (Array.isArray(item.content)) {
    const parts = item.content
      .map((entry) => {
        if (!entry || typeof entry !== "object") return "";
        if (entry.type === "text" && typeof entry.text === "string") return entry.text;
        return "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join("").trim();
  }
  return null;
}

function safePreview(value, maxLength = 320) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function toNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = { summarizeThreadConversation };
