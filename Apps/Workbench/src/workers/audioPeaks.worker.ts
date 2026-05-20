import { buildVisualEnvelope } from "../utils/audioEnvelope";

type PeaksRequest = {
  id: number;
  url: string;
  count: number;
};

type PeaksError = {
  code: "audio_context_unavailable" | "audio_decode_failed";
  message: string;
  retryable: boolean;
};

const AudioContextClass = self.AudioContext || (self as typeof self & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

self.onmessage = async (event: MessageEvent<PeaksRequest>) => {
  const { id, url, count } = event.data;
  if (!AudioContextClass) {
    self.postMessage({ id, ok: false, peaks: [], error: buildError("audio_context_unavailable", "当前环境不支持音频解码", false) });
    return;
  }
  let context: AudioContext | null = null;
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    context = new AudioContextClass();
    const audioBuffer = await context.decodeAudioData(buffer);
    self.postMessage({ id, ok: true, peaks: buildVisualEnvelope(audioBuffer, count) });
  } catch {
    self.postMessage({ id, ok: false, peaks: [], error: buildError("audio_decode_failed", "音频解码失败", true) });
  } finally {
    await context?.close?.();
  }
};

function buildError(code: PeaksError["code"], message: string, retryable: boolean): PeaksError {
  return { code, message, retryable };
}
