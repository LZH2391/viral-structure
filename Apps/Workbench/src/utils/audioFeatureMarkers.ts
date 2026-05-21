import type { AudioFeatureAnalysisArtifact, AudioFeatureMarker } from "../types";

export function buildAudioFeatureMarkers(audioFeatures?: AudioFeatureAnalysisArtifact | null): AudioFeatureMarker[] {
  if (!audioFeatures || audioFeatures.status === "degraded") return [];
  if ((audioFeatures.beatFrames?.length ?? 0) || (audioFeatures.onsetFrames?.length ?? 0)) {
    return [
      ...(audioFeatures.beatFrames ?? []).map((marker, index) => toUiMarker(marker, "beat", index)),
      ...(audioFeatures.onsetFrames ?? []).map((marker, index) => toUiMarker(marker, "onset", index)),
    ]
      .filter((marker) => marker.valid)
      .sort((a, b) => a.time - b.time);
  }
  return [
    ...(audioFeatures.beats ?? []).map((time, index) => ({ id: `beat_${index}_${time}`, type: "beat" as const, time, ...nearestEnergy(audioFeatures, time), valid: true, reason: null })),
    ...(audioFeatures.onsets ?? []).map((time, index) => ({ id: `onset_${index}_${time}`, type: "onset" as const, time, ...nearestEnergy(audioFeatures, time), valid: true, reason: null })),
  ].sort((a, b) => a.time - b.time);
}

export function findAudioFeatureMarker(audioFeatures: AudioFeatureAnalysisArtifact | null | undefined, markerId: string | null): AudioFeatureMarker | null {
  if (!markerId) return null;
  return buildAudioFeatureMarkers(audioFeatures).find((marker) => marker.id === markerId) ?? null;
}

function toUiMarker(marker: NonNullable<AudioFeatureAnalysisArtifact["beatFrames"]>[number], type: AudioFeatureMarker["type"], index: number): AudioFeatureMarker {
  return {
    id: `${type}_${index}_${marker.time}`,
    type,
    time: marker.time,
    rms: marker.rms ?? null,
    dbfs: marker.dbfs ?? null,
    energyRank: marker.energyRank ?? null,
    valid: marker.valid,
    reason: marker.reason ?? null,
  };
}

function nearestEnergy(audioFeatures: AudioFeatureAnalysisArtifact, time: number): Pick<AudioFeatureMarker, "rms" | "dbfs" | "energyRank"> {
  const frames = audioFeatures.energyFrames ?? [];
  if (!frames.length) return { rms: null, dbfs: null, energyRank: null };
  let best = frames[0];
  for (const frame of frames) {
    if (Math.abs(frame.time - time) < Math.abs(best.time - time)) best = frame;
  }
  return { rms: best.rms, dbfs: best.dbfs ?? null, energyRank: null };
}
