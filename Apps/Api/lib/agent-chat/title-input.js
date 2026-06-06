const MAX_FIRST_SENTENCE_LENGTH = 160;
const SENTENCE_END_PATTERN = /[。！？!?]+/u;

function extractFirstSentence(message, limit = MAX_FIRST_SENTENCE_LENGTH) {
  const raw = String(message ?? "").trim();
  if (!raw) return "";
  const text = raw.replace(/[ \t]+/g, " ");
  const newlineIndex = text.search(/\r?\n/u);
  const punctuationMatch = SENTENCE_END_PATTERN.exec(text);
  const candidates = [newlineIndex, punctuationMatch ? punctuationMatch.index + punctuationMatch[0].length : -1]
    .filter((index) => index >= 0);
  const endIndex = candidates.length ? Math.min(...candidates) : text.length;
  return limitText(normalizeWhitespace(text.slice(0, endIndex)), limit);
}

function buildTitleInputSummary({ conversation, turnId, firstSentence }) {
  return {
    conversationId: conversation?.conversationId ?? null,
    sourceTurnId: turnId ?? null,
    agentRole: conversation?.role ?? null,
    source: conversation?.source ?? null,
    sampleVideoId: conversation?.sampleVideoId ?? null,
    firstSentenceChars: String(firstSentence ?? "").length,
    firstSentencePreview: limitText(firstSentence, 60),
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
  MAX_FIRST_SENTENCE_LENGTH,
  buildTitleInputSummary,
  extractFirstSentence,
  limitText,
  normalizeWhitespace,
};
