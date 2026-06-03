const {
  DEFAULT_CHUNK_MS,
  DEFAULT_PROTOCOL_VERSION,
  DEFAULT_RESOURCE_ID,
  PCM_BYTES_PER_SECOND,
  PCM_SAMPLE_RATE,
  RESPONSE_TIMEOUT_MS,
  SUCCESS_CODES,
} = require("./doubao-sauc-constants");

function parseRecognitionPayload(payload) {
  const result = payload?.result ?? payload ?? {};
  const additions = payload?.addition ?? result?.addition ?? {};
  const rawUtterances = Array.isArray(result.utterances) ? result.utterances : Array.isArray(additions.utterances) ? additions.utterances : [];
  const utterances = rawUtterances.map(normalizeUtterance).filter((item) => item.text);
  const text = String(result.text ?? additions.text ?? utterances.map((item) => item.text).join("")).trim();
  return { text, utterances };
}

function normalizeUtterance(value) {
  const words = normalizeWords(value?.words ?? value?.word_infos ?? []);
  return {
    start: normalizeTimestamp(value?.start_time ?? value?.start ?? value?.begin_time),
    end: normalizeTimestamp(value?.end_time ?? value?.end),
    text: String(value?.text ?? value?.utterance ?? words.map((item) => item.text).join("")).trim(),
    definite: typeof value?.definite === "boolean" ? value.definite : null,
    words,
  };
}

function normalizeWords(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    start: normalizeTimestamp(item?.start_time ?? item?.start ?? item?.begin_time),
    end: normalizeTimestamp(item?.end_time ?? item?.end),
    text: String(item?.text ?? item?.word ?? item?.content ?? "").trim(),
  })).filter((item) => item.text);
}

function normalizeTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return number >= 100 ? number / 1000 : number;
}

function finalizeRecognition({ utterances, finalText, providerMeta }) {
  const normalizedUtterances = utterances.map((item) => ({
    start: roundTime(item.start),
    end: roundTime(item.end),
    text: item.text,
    definite: item.definite ?? null,
    words: (item.words ?? []).map((word) => ({
      start: roundTime(word.start),
      end: roundTime(word.end),
      text: word.text,
    })),
  })).filter((item) => item.text);
  return {
    text: String(finalText ?? normalizedUtterances.map((item) => item.text).join("")).trim(),
    segments: normalizedUtterances.flatMap((item) => splitUtteranceIntoSegments(item)),
    timing: {
      utterances: normalizedUtterances,
      words: normalizedUtterances.flatMap((item) => item.words),
    },
    providerMeta: {
      provider: "doubao-sauc",
      resourceId: providerMeta?.resourceId ?? DEFAULT_RESOURCE_ID,
      connectId: providerMeta?.connectId ?? null,
      requestId: providerMeta?.requestId ?? null,
      logId: providerMeta?.logId ?? null,
    },
  };
}

function roundTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 1000) / 1000;
}

function decodeResultText(value) {
  return parseRecognitionPayload(typeof value === "string" ? JSON.parse(value) : value).text;
}

function decodeResultSegments(value) {
  const parsed = parseRecognitionPayload(typeof value === "string" ? JSON.parse(value) : value);
  return parsed.utterances.map((item) => ({
    start: item.start,
    end: item.end,
    text: item.text,
    confidence: null,
  }));
}

function recognitionTimeoutMs(byteLength) {
  const streamMs = Math.ceil(Math.max(0, byteLength) / PCM_BYTES_PER_SECOND * 1000);
  return Math.max(RESPONSE_TIMEOUT_MS, streamMs + RESPONSE_TIMEOUT_MS);
}

function isSuccessCode(code) {
  const normalized = Number(code);
  return Number.isFinite(normalized) && SUCCESS_CODES.has(normalized);
}

function splitUtteranceIntoSegments(utterance) {
  const text = String(utterance?.text ?? "").trim();
  if (!text) return [];
  const chunks = splitSubtitleText(text);
  if (chunks.length <= 1) return [{ start: utterance.start, end: utterance.end, text, confidence: null }];
  const words = Array.isArray(utterance?.words) ? utterance.words.filter((item) => item?.text) : [];
  if (words.length >= chunks.length) return splitSegmentsByWords(chunks, words);
  return splitSegmentsByTiming(chunks, utterance.start, utterance.end);
}

function splitSubtitleText(text) {
  const chunks = [];
  let current = "";
  for (const char of String(text ?? "")) {
    current += char;
    if (isSubtitleBreakPunctuation(char)) {
      const value = current.trim();
      if (value) chunks.push(value);
      current = "";
    }
  }
  const tail = current.trim();
  if (tail) chunks.push(tail);
  return chunks.length ? chunks : [String(text ?? "").trim()];
}

function splitSegmentsByWords(chunks, words) {
  const weights = chunks.map(subtitleTextWeight);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || chunks.length;
  let assigned = 0;
  let cumulativeWeight = 0;
  return chunks.map((chunk, index) => {
    const remainingChunks = chunks.length - index - 1;
    const remainingWords = words.length - assigned;
    let wordCount = remainingWords;
    if (index < chunks.length - 1) {
      cumulativeWeight += weights[index];
      const desired = Math.round(words.length * (cumulativeWeight / totalWeight));
      const minAllowed = 1;
      const maxAllowed = Math.max(minAllowed, remainingWords - remainingChunks);
      wordCount = Math.max(minAllowed, Math.min(maxAllowed, desired - assigned));
    }
    const slice = words.slice(assigned, assigned + wordCount);
    assigned += wordCount;
    return {
      start: roundTime(slice[0]?.start ?? words[assigned - wordCount]?.start ?? 0),
      end: roundTime(slice[slice.length - 1]?.end ?? words[assigned - 1]?.end ?? 0),
      text: chunk,
      confidence: null,
    };
  }).filter((item) => item.text);
}

function splitSegmentsByTiming(chunks, start, end) {
  const safeStart = Number.isFinite(start) ? Number(start) : 0;
  const safeEnd = Number.isFinite(end) && end > safeStart ? Number(end) : safeStart;
  const duration = Math.max(0, safeEnd - safeStart);
  const weights = chunks.map(subtitleTextWeight);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || chunks.length;
  let cursor = safeStart;
  return chunks.map((chunk, index) => {
    const isLast = index === chunks.length - 1;
    const span = isLast ? safeEnd - cursor : duration * (weights[index] / totalWeight);
    const chunkStart = cursor;
    const chunkEnd = isLast ? safeEnd : Math.min(safeEnd, cursor + span);
    cursor = chunkEnd;
    return {
      start: roundTime(chunkStart),
      end: roundTime(chunkEnd),
      text: chunk,
      confidence: null,
    };
  }).filter((item) => item.text);
}

function subtitleTextWeight(text) {
  const compact = String(text ?? "").replace(/[，。！？!?；;,\s]/g, "");
  return Math.max(1, compact.length);
}

function isSubtitleBreakPunctuation(char) {
  return /[，。！？!?；;]/.test(String(char ?? ""));
}

function buildRecognitionDebugInputSummary(options = {}) {
  return {
    audioEncoding: "pcm_s16le",
    sampleRate: PCM_SAMPLE_RATE,
    chunkMs: options.chunkMs ?? DEFAULT_CHUNK_MS,
    protocolVersion: options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
    resourceId: options.resourceId ?? DEFAULT_RESOURCE_ID,
  };
}

module.exports = {
  buildRecognitionDebugInputSummary,
  decodeResultSegments,
  decodeResultText,
  finalizeRecognition,
  isSuccessCode,
  normalizeTimestamp,
  parseRecognitionPayload,
  recognitionTimeoutMs,
  splitUtteranceIntoSegments,
};
