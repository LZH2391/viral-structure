import { buildVisualEnvelope } from "../utils/audioEnvelope";

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
    self.postMessage({ id, peaks: buildVisualEnvelope(audioBuffer, count) });
  } catch (error) {
    self.postMessage({ id, peaks: [], error: error instanceof Error ? error.message : "decode_failed" });
  } finally {
    await context?.close?.();
  }
};
