function enrichRhythmAtomsWithTimingEvidence(rhythmAtoms, artifact) {
  const shots = new Map((artifact?.shotBoundaryAnalysis?.shots ?? []).flatMap((shot) => {
    const refs = [];
    if (shot?.id) refs.push([String(shot.id), shot]);
    if (shot?.shotNo) refs.push([String(shot.shotNo), shot]);
    return refs;
  }));
  const subtitles = Array.isArray(artifact?.subtitles?.segments) ? artifact.subtitles.segments : [];
  if (!shots.size) return rhythmAtoms;
  return rhythmAtoms.map((atom) => {
    if (atom?.timingEvidence) return atom;
    const shotRefs = Array.isArray(atom?.sourceRefs?.shotRefs) ? atom.sourceRefs.shotRefs : [];
    const timingEvidence = buildRhythmTimingEvidence(shotRefs, shots, subtitles);
    return timingEvidence ? { ...atom, timingEvidence } : atom;
  });
}

function buildRhythmTimingEvidence(shotRefs, shots, subtitles) {
  const shotTimings = shotRefs
    .map((shotRef) => {
      const shot = shots.get(String(shotRef));
      if (!shot) return null;
      const start = normalizeTimingNumber(shot.start);
      const end = normalizeTimingNumber(shot.end);
      const subtitleText = subtitleTextForWindow(subtitles, start, end);
      return {
        shotRef: String(shotRef),
        start,
        end,
        durationSec: start !== null && end !== null ? roundTiming(Math.max(0, end - start)) : null,
        subtitleText,
        subtitleCharCount: countDialogueChars(subtitleText),
      };
    })
    .filter(Boolean);
  if (!shotTimings.length) return null;
  const durations = shotTimings.map((item) => item.durationSec).filter((value) => value !== null);
  const totalDurationSec = roundTiming(durations.reduce((sum, value) => sum + value, 0));
  const subtitleCharCount = shotTimings.reduce((sum, item) => sum + item.subtitleCharCount, 0);
  return {
    schemaVersion: "rhythm_timing_evidence.v1",
    source: "runtime_artifact_shot_boundary_subtitles",
    sourceShotRefs: shotTimings.map((item) => item.shotRef),
    shotCount: shotTimings.length,
    totalDurationSec,
    minShotDurationSec: durations.length ? roundTiming(Math.min(...durations)) : null,
    maxShotDurationSec: durations.length ? roundTiming(Math.max(...durations)) : null,
    avgShotDurationSec: durations.length ? roundTiming(totalDurationSec / durations.length) : null,
    medianShotDurationSec: durations.length ? medianTiming(durations) : null,
    subtitleCharCount,
    dialogueCharsPerSec: totalDurationSec > 0 ? roundTiming(subtitleCharCount / totalDurationSec) : null,
    derivedPace: deriveTimingPace(durations),
    shotTimings,
  };
}

function subtitleTextForWindow(subtitles, start, end) {
  if (start === null || end === null) return "";
  return subtitles
    .filter((segment) => {
      const segmentStart = normalizeTimingNumber(segment?.start);
      const segmentEnd = normalizeTimingNumber(segment?.end);
      return segmentStart !== null && segmentEnd !== null && segmentEnd > start && segmentStart < end;
    })
    .map((segment) => String(segment?.text ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function normalizeTimingNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return roundTiming(number);
}

function normalizeOptionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function stripMediaExtension(value) {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  return text.replace(/\.(mp4|mov|m4v|webm|mkv|avi|wmv|flv|mpeg|mpg)$/i, "");
}

function roundTiming(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function medianTiming(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return roundTiming(sorted[middle]);
  return roundTiming((sorted[middle - 1] + sorted[middle]) / 2);
}

function deriveTimingPace(durations) {
  if (!durations.length) return "unknown";
  const average = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  if (average <= 1.2) return "fast";
  if (average <= 2.4) return "medium";
  return "slow";
}

function countDialogueChars(text) {
  return String(text ?? "").replace(/[\s，。！？、,.!?;；:："'"“”‘’（）()[\]【】《》<>…—-]/g, "").length;
}

module.exports = {
  enrichRhythmAtomsWithTimingEvidence,
};
