const SHOT_SUBTITLE_BOUNDARY_EPSILON_SECONDS = 0.05;

function buildShotSubtitleMap(shots, subtitles) {
  const map = new Map((Array.isArray(shots) ? shots : []).map((shot) => [shot.shotId, { subtitleText: "", subtitleContextText: "" }]));
  if (!Array.isArray(shots) || !shots.length || !subtitles || subtitles.status !== "processed") return map;

  const words = Array.isArray(subtitles.words) ? subtitles.words.filter((word) => String(word?.text ?? "").trim()) : [];
  const segments = Array.isArray(subtitles.segments) ? subtitles.segments.filter((segment) => String(segment?.text ?? "").trim()) : [];
  const utterances = Array.isArray(subtitles.utterances) ? subtitles.utterances.filter((utterance) => String(utterance?.text ?? "").trim()) : [];

  appendShotSubtitleText({ map, shots, words, segments });

  for (const shot of shots) {
    const entry = map.get(shot.shotId);
    if (!entry) continue;
    entry.subtitleContextText = utterances
      .filter((utterance) => utteranceOverlapsShot(utterance, shot))
      .map((utterance) => String(utterance.text ?? "").trim())
      .filter(Boolean)
      .join("");
  }

  return map;
}

function appendShotSubtitleText({ map, shots, words, segments }) {
  const indexedWords = words.map((word, index) => ({ word, index }));
  const emittedWordIndexes = new Set();

  for (const segment of segments) {
    const segmentWordItems = indexedWords.filter(({ word }) => wordOverlapsSubtitleSegment(word, segment));
    if (!segmentWordItems.length) continue;
    const decoratedTexts = decorateWordsWithSegmentText(segment.text, segmentWordItems.map(({ word }) => word));
    segmentWordItems.forEach(({ word, index }, itemIndex) => {
      if (emittedWordIndexes.has(index)) return;
      appendWordTextToShot(map, shots, word, decoratedTexts[itemIndex] ?? String(word.text ?? "").trim());
      emittedWordIndexes.add(index);
    });
  }

  for (const { word, index } of indexedWords) {
    if (emittedWordIndexes.has(index)) continue;
    appendWordTextToShot(map, shots, word, String(word.text ?? "").trim());
  }
}

function appendWordTextToShot(map, shots, word, text) {
  const value = String(text ?? "").trim();
  if (!value) return;
  const shot = resolveWordShot(shots, word);
  if (!shot) return;
  const entry = map.get(shot.shotId);
  if (!entry) return;
  entry.subtitleText += value;
}

function decorateWordsWithSegmentText(segmentText, segmentWords) {
  const sourceText = String(segmentText ?? "").trim();
  const fallback = segmentWords.map((word) => String(word?.text ?? "").trim());
  if (!sourceText || !fallback.length) return fallback;

  const result = [];
  let cursor = 0;
  for (const wordText of fallback) {
    if (!wordText) {
      result.push("");
      continue;
    }
    const wordIndex = sourceText.indexOf(wordText, cursor);
    if (wordIndex < 0) return fallback;
    const separator = sourceText.slice(cursor, wordIndex);
    if (separator && result.length) {
      result[result.length - 1] += separator;
      result.push(wordText);
    } else {
      result.push(`${separator}${wordText}`);
    }
    cursor = wordIndex + wordText.length;
  }
  if (cursor < sourceText.length && result.length) result[result.length - 1] += sourceText.slice(cursor);
  return result;
}

function wordOverlapsSubtitleSegment(word, segment) {
  const wordStart = normalizeNumber(word?.start, Number.NaN);
  const wordEnd = normalizeNumber(word?.end, wordStart);
  const segmentStart = normalizeNumber(segment?.start, Number.NaN);
  const segmentEnd = normalizeNumber(segment?.end, segmentStart);
  if (intervalOverlapSeconds(wordStart, wordEnd, segmentStart, segmentEnd) > 0) return true;

  const midpoint = Number.isFinite(wordStart) && Number.isFinite(wordEnd) && wordEnd >= wordStart ? (wordStart + wordEnd) / 2 : wordStart;
  return Number.isFinite(midpoint)
    && Number.isFinite(segmentStart)
    && Number.isFinite(segmentEnd)
    && midpoint >= segmentStart
    && midpoint < segmentEnd;
}

function resolveWordShot(shots, word) {
  const text = String(word?.text ?? "").trim();
  if (!text) return null;
  const start = normalizeNumber(word?.start, Number.NaN);
  const end = normalizeNumber(word?.end, start);
  let bestShot = null;
  let bestOverlap = -1;
  for (const shot of shots) {
    const overlap = intervalOverlapSeconds(start, end, shot.start, shot.end);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestShot = shot;
    }
  }
  if (bestOverlap > 0) return bestShot;

  const midpoint = Number.isFinite(start) && Number.isFinite(end) && end >= start ? (start + end) / 2 : start;
  const strict = shots.find((shot) => shotContainsTime(shot, midpoint, { epsilon: 0 }));
  if (strict) return strict;

  const fuzzy = shots.find((shot) => shotContainsTime(shot, midpoint, { epsilon: SHOT_SUBTITLE_BOUNDARY_EPSILON_SECONDS }));
  if (fuzzy) return fuzzy;

  return bestShot;
}

function utteranceOverlapsShot(utterance, shot) {
  const start = normalizeNumber(utterance?.start, Number.NaN);
  const end = normalizeNumber(utterance?.end, start);
  return intervalOverlapSeconds(start, end, shot.start - SHOT_SUBTITLE_BOUNDARY_EPSILON_SECONDS, shot.end + SHOT_SUBTITLE_BOUNDARY_EPSILON_SECONDS) > 0;
}

function shotContainsTime(shot, time, { epsilon = 0 } = {}) {
  if (!Number.isFinite(time)) return false;
  const start = Number(shot?.start ?? Number.NaN) - epsilon;
  const end = Number(shot?.end ?? Number.NaN) + epsilon;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (shot?.isLastShot) return time >= start && time <= end;
  return time >= start && time < end;
}

function intervalOverlapSeconds(startA, endA, startB, endB) {
  if (!Number.isFinite(startA) || !Number.isFinite(endA) || !Number.isFinite(startB) || !Number.isFinite(endB)) return 0;
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function normalizeNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.round(next * 1000) / 1000 : fallback;
}

module.exports = {
  buildShotSubtitleMap,
  decorateWordsWithSegmentText,
  wordOverlapsSubtitleSegment,
  utteranceOverlapsShot,
  intervalOverlapSeconds,
  shotContainsTime,
};
