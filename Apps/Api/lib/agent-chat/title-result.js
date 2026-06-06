const MAX_TITLE_LENGTH = 36;

function parseTitleResult(finalMessage, fallbackTitle = "") {
  const raw = String(finalMessage ?? "").trim();
  const parsed = parseJsonObject(raw);
  const title = normalizeTitle(parsed?.title ?? raw);
  return {
    schemaVersion: String(parsed?.schemaVersion ?? "agent_chat_title.v1"),
    title: title || normalizeTitle(fallbackTitle),
    confidence: normalizeConfidence(parsed?.confidence),
    rawPreview: safePreview(raw, 160),
  };
}

function normalizeTitle(value) {
  let title = String(value ?? "").trim();
  title = title.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  title = title.replace(/^["'“”‘’]+|["'“”‘’。.!！?？\s]+$/gu, "").trim();
  title = title.replace(/\s+/g, " ");
  if (!title) return "";
  if (title.length > MAX_TITLE_LENGTH) title = title.slice(0, MAX_TITLE_LENGTH).trim();
  return title;
}

function fallbackTitleFromFirstMessage(firstMessage) {
  const normalized = normalizeTitle(firstMessage);
  if (!normalized) return "新会话";
  return normalized.length > 18 ? normalized.slice(0, 18).trim() : normalized;
}

function parseJsonObject(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {}
  const match = raw.match(/\{[\s\S]*\}/u);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return null;
  return Math.max(0, Math.min(1, confidence));
}

function safePreview(value, limit = 160) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

module.exports = {
  MAX_TITLE_LENGTH,
  fallbackTitleFromFirstMessage,
  normalizeTitle,
  parseTitleResult,
  safePreview,
};
