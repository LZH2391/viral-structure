export type AudioEnvelopeSource = {
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
};

type EnvelopeBucket = {
  peak: number;
  rms: number;
};
const LOW_SIGNAL_RMS_P95_DBFS = -20;
const ENVELOPE_FLOOR_DBFS = -54;
const ENVELOPE_CEILING_DBFS = -6;
const LOW_SIGNAL_VISUAL_CEILING = 0.08;

export function buildVisualEnvelope(audioBuffer: AudioEnvelopeSource, count: number): number[] {
  const buckets: EnvelopeBucket[] = [];
  const channelCount = audioBuffer.numberOfChannels || 1;
  const step = Math.max(1, Math.floor(audioBuffer.length / count));
  for (let index = 0; index < count; index += 1) {
    let peak = 0;
    let energy = 0;
    let sampleCount = 0;
    const start = index * step;
    const end = Math.min(start + step, audioBuffer.length);
    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += 1) {
        const value = Math.abs(data[sample] || 0);
        peak = Math.max(peak, value);
        energy += value * value;
        sampleCount += 1;
      }
    }
    buckets.push({
      peak,
      rms: sampleCount ? Math.sqrt(energy / sampleCount) : 0,
    });
  }
  if (isLowSignal(buckets)) return buckets.map((bucket) => normalizeLowSignalBucket(bucket));
  return normalizeEnvelope(buckets);
}

export function isLowSignalBuckets(audioBuffer: AudioEnvelopeSource, count: number): boolean {
  const buckets: EnvelopeBucket[] = [];
  const channelCount = audioBuffer.numberOfChannels || 1;
  const step = Math.max(1, Math.floor(audioBuffer.length / count));
  for (let index = 0; index < count; index += 1) {
    let peak = 0;
    let energy = 0;
    let sampleCount = 0;
    const start = index * step;
    const end = Math.min(start + step, audioBuffer.length);
    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += 1) {
        const value = Math.abs(data[sample] || 0);
        peak = Math.max(peak, value);
        energy += value * value;
        sampleCount += 1;
      }
    }
    buckets.push({ peak, rms: sampleCount ? Math.sqrt(energy / sampleCount) : 0 });
  }
  return isLowSignal(buckets);
}

function normalizeEnvelope(buckets: EnvelopeBucket[]): number[] {
  const dbValues = buckets.map(loudnessDb);
  const smoothed = dbValues.map((value, index) => {
    const previous = dbValues[Math.max(0, index - 1)];
    const next = dbValues[Math.min(dbValues.length - 1, index + 1)];
    return value * 0.64 + previous * 0.18 + next * 0.18;
  });
  const shaped = smoothed.map((value, index) => {
    const localAverage = localMean(smoothed, index, 10);
    const absolute = normalizeDbfs(value, ENVELOPE_FLOOR_DBFS, ENVELOPE_CEILING_DBFS);
    const localLift = clamp01((value - localAverage) / 10);
    const transientLift = transientScore(buckets[index]);
    return clamp01(Math.pow(absolute, 0.92) * 0.84 + localLift * 0.1 + transientLift * 0.06);
  });
  return stretchVisualRange(shaped);
}

function loudnessDb(bucket: EnvelopeBucket): number {
  const mixed = bucket.rms * 0.76 + bucket.peak * 0.24;
  return amplitudeToDb(mixed);
}

function transientScore(bucket: EnvelopeBucket | undefined): number {
  if (!bucket) return 0;
  const crestDb = amplitudeToDb(bucket.peak) - amplitudeToDb(bucket.rms);
  return clamp01((crestDb - 3) / 12);
}

function stretchVisualRange(values: number[]): number[] {
  return values.map((value) => Math.pow(clamp01(value), 0.96));
}

function isLowSignal(buckets: EnvelopeBucket[]): boolean {
  const dbValues = buckets.map((bucket) => amplitudeToDb(bucket.rms)).filter((value) => Number.isFinite(value)).sort((first, second) => first - second);
  if (!dbValues.length) return true;
  const noiseFloor = percentile(dbValues, 0.1);
  const signalP95 = percentile(dbValues, 0.95);
  const activeThreshold = Math.min(signalP95 - 3, Math.max(-48, noiseFloor + 10));
  const activeRatio = dbValues.filter((value) => value >= activeThreshold).length / dbValues.length;
  return signalP95 < LOW_SIGNAL_RMS_P95_DBFS || activeRatio < 0.03;
}

function amplitudeToDb(value: number): number {
  return 20 * Math.log10(Math.max(0.000001, value));
}

function normalizeLowSignalBucket(bucket: EnvelopeBucket): number {
  return normalizeDbfs(loudnessDb(bucket), -60, -24) * LOW_SIGNAL_VISUAL_CEILING;
}

function normalizeDbfs(value: number, floor: number, ceiling: number): number {
  const range = Math.max(1, ceiling - floor);
  return clamp01((value - floor) / range);
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.max(0, Math.floor(values.length * ratio)))];
}

function localMean(values: number[], index: number, radius: number): number {
  let total = 0;
  let count = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const value = values[index + offset];
    if (value === undefined) continue;
    total += value;
    count += 1;
  }
  return count ? total / count : 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value || 0));
}
