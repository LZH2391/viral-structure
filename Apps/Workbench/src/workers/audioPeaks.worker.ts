type PeaksRequest = {
  id: number;
  url: string;
  count: number;
};

const AudioContextClass = self.AudioContext || (self as typeof self & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

self.onmessage = async (event: MessageEvent<PeaksRequest>) => {
  const { id, url, count } = event.data;
  if (!AudioContextClass) {
    self.postMessage({ id, peaks: [] });
    return;
  }
  let context: AudioContext | null = null;
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    context = new AudioContextClass();
    const audioBuffer = await context.decodeAudioData(buffer);
    self.postMessage({ id, peaks: buildPeaks(audioBuffer, count) });
  } catch (error) {
    self.postMessage({ id, peaks: [], error: error instanceof Error ? error.message : "decode_failed" });
  } finally {
    await context?.close?.();
  }
};

function buildPeaks(audioBuffer: AudioBuffer, count: number): number[] {
  const peaks: number[] = [];
  const channelCount = audioBuffer.numberOfChannels || 1;
  const step = Math.max(1, Math.floor(audioBuffer.length / count));
  for (let index = 0; index < count; index += 1) {
    let peak = 0;
    const start = index * step;
    const end = Math.min(start + step, audioBuffer.length);
    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += 1) {
        peak = Math.max(peak, Math.abs(data[sample] || 0));
      }
    }
    peaks.push(Math.max(0.04, Math.min(1, peak)));
  }
  return peaks;
}
