const MAX_FIRST_MESSAGE_PREVIEW_LENGTH = 160;

function normalizeFirstMessage(message) {
  return String(message ?? "").trim();
}

function buildTitleInputSummary({ conversation, turnId, firstMessage }) {
  return {
    conversationId: conversation?.conversationId ?? null,
    sourceTurnId: turnId ?? null,
    agentRole: conversation?.role ?? null,
    source: conversation?.source ?? null,
    sampleVideoId: conversation?.sampleVideoId ?? null,
    firstMessageChars: String(firstMessage ?? "").length,
    firstMessagePreview: limitText(normalizeWhitespace(firstMessage), MAX_FIRST_MESSAGE_PREVIEW_LENGTH),
  };
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function limitText(value, limit) {
  const text = String(value ?? "").trim();
  return text.length > limit ? text.slice(0, limit).trim() : text;
}

module.exports = {
  MAX_FIRST_MESSAGE_PREVIEW_LENGTH,
  buildTitleInputSummary,
  limitText,
  normalizeFirstMessage,
  normalizeWhitespace,
};
