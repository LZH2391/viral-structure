import { useCallback, useEffect, useRef } from "react";
import { beginUiStage, emitUiStage } from "../observability/uiStage";
import { buildVisualEnvelope } from "../utils/audioEnvelope";
import { clamp, createStaticWaveform, drawCanvas } from "../utils/waveformDraw";

type WaveformError = {
  code: "audio_context_unavailable" | "audio_decode_failed" | "audio_worker_failed" | "audio_empty_peaks";
  message: string;
  retryable: boolean;
};

type WaveformWorkerResponse = {
  id: number;
  ok: boolean;
  peaks: number[];
  error?: WaveformError;
};

type WaveformOptions = {
  audio: HTMLAudioElement | null;
  mainCanvas: HTMLCanvasElement | null;
  miniCanvas: HTMLCanvasElement | null;
  url: string | null;
  active: boolean;
  animate?: boolean;
  durationSeconds?: number | null;
  trace?: {
    uiTraceId: string;
    backendTraceId?: string | null;
    artifactId?: string | null;
    parentArtifactId?: string | null;
  };
};

const peaksCache = new Map<string, number[]>();
const WAVEFORM_CACHE_VERSION = "visual-envelope-v6";
const WAVEFORM_PEAK_COUNT = 900;
const MAX_MAIN_THREAD_DECODE_SECONDS = 90;
const PLACEHOLDER_PEAKS = Array.from({ length: 180 }, (_, index) => 0.16 + Math.abs(Math.sin(index / 5) * Math.cos(index / 13)) * 0.5);

export function useAudioWaveform({ audio, mainCanvas, miniCanvas, url, active, animate = true, durationSeconds, trace }: WaveformOptions) {
  const peaksRef = useRef<number[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const rafIdRef = useRef(0);
  const hoverRatioRef = useRef<number | null>(null);
  const mainStaticRef = useRef<HTMLCanvasElement | null>(null);
  const miniStaticRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameAtRef = useRef(0);

  const render = useCallback(
    (externalProgress?: number | null) => {
      const duration = audio ? resolveDuration(audio, durationSeconds) : 0;
      const progress = externalProgress ?? (duration ? clamp(audio!.currentTime / duration) : 0);
      drawCanvas(mainCanvas, { peaks: peaksRef.current, progress, hoverRatio: hoverRatioRef.current }, mainStaticRef.current);
      drawCanvas(miniCanvas, { peaks: peaksRef.current, progress, hoverRatio: hoverRatioRef.current }, miniStaticRef.current);
    },
    [audio, durationSeconds, mainCanvas, miniCanvas],
  );

  const rebuildStaticCaches = useCallback(() => {
    const ratio = window.devicePixelRatio || 1;
    mainStaticRef.current = buildStaticCanvas(mainCanvas, peaksRef.current, ratio);
    miniStaticRef.current = buildStaticCanvas(miniCanvas, peaksRef.current, ratio);
  }, [mainCanvas, miniCanvas]);

  useEffect(() => {
    const cacheKey = url ? `${WAVEFORM_CACHE_VERSION}:${url}` : null;
    let cancelled = false;
    if (!url) {
      peaksRef.current = [];
      rebuildStaticCaches();
      render(0);
      return;
    }
    const cached = cacheKey ? peaksCache.get(cacheKey) : null;
    if (cached) {
      peaksRef.current = cached;
      rebuildStaticCaches();
      render();
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const fallbackAbortController = new AbortController();
    const decodeStage = trace?.uiTraceId
      ? beginUiStage({
          uiTraceId: trace.uiTraceId,
          backendTraceId: trace.backendTraceId ?? null,
          stageName: "audio.waveform.decode",
          parentArtifactId: trace.parentArtifactId ?? null,
          inputSummary: {
            artifactId: trace.artifactId ?? null,
            requestedPeaks: WAVEFORM_PEAK_COUNT,
            source: "audio-track",
          },
        })
      : null;
    if (decodeStage) emitUiStage(decodeStage, "stage.start", { artifactId: trace?.artifactId ?? decodeStage.artifactId });
    const commitPeaks = (peaks: number[], outputSummary: unknown = null) => {
      if (cancelled || requestIdRef.current !== requestId) return;
      peaksRef.current = peaks.length ? peaks : PLACEHOLDER_PEAKS;
      if (cacheKey && peaks.length) peaksCache.set(cacheKey, peaks);
      rebuildStaticCaches();
      render(0);
      if (!decodeStage) return;
      if (peaks.length) {
        emitUiStage(decodeStage, "stage.end", {
          artifactId: trace?.artifactId ?? decodeStage.artifactId,
          outputSummary: outputSummary ?? { peakCount: peaks.length },
        });
      } else {
        emitUiStage(decodeStage, "stage.fail", {
          artifactId: trace?.artifactId ?? decodeStage.artifactId,
          errorSummary: {
            code: "audio_empty_peaks",
            message: "音频波形解码没有生成可用峰值",
            stageName: "audio.waveform.decode",
            retryable: true,
          },
          debugPayload: {
            fallbackReason: (outputSummary as { fallbackReason?: string } | null)?.fallbackReason ?? null,
            peakCount: 0,
          },
        });
      }
    };
    const commitPlaceholder = () => {
      if (cancelled || requestIdRef.current !== requestId) return;
      peaksRef.current = PLACEHOLDER_PEAKS;
      rebuildStaticCaches();
      render(0);
    };
    const failDecode = (error: WaveformError, debugPayload: unknown) => {
      if (cancelled || requestIdRef.current !== requestId || !decodeStage) return;
      emitUiStage(decodeStage, "stage.fail", {
        artifactId: trace?.artifactId ?? decodeStage.artifactId,
        errorSummary: {
          code: error.code,
          message: error.message,
          stageName: "audio.waveform.decode",
          retryable: error.retryable,
        },
        debugPayload,
      });
    };
    const decodeInMainThread = (fallbackReason: string, workerError: WaveformError | null = null) => {
      if (!canDecodeWaveformOnMainThread(durationSeconds)) {
        failDecode(
          { code: "audio_worker_failed", message: "音频波形 Worker 失败，已跳过主线程全量解码", retryable: true },
          { fallbackReason, workerError, durationSeconds, mainThreadDecodeSkipped: true },
        );
        commitPlaceholder();
        return;
      }
      void decodePeaksInMainThread(url, WAVEFORM_PEAK_COUNT, fallbackAbortController.signal).then((result) => {
        if (!result.ok && result.cancelled) return;
        if (result.ok) {
          commitPeaks(result.peaks, { decoder: "main-thread", peakCount: result.peaks.length, fallbackReason });
          return;
        }
        failDecode(result.error, { fallbackReason, workerError, mainThreadError: result.error });
        commitPlaceholder();
      });
    };
    peaksRef.current = PLACEHOLDER_PEAKS;
    rebuildStaticCaches();
    render();
    const worker = new Worker(new URL("../workers/audioPeaks.worker.ts", import.meta.url), { type: "module" });
    workerRef.current?.terminate();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WaveformWorkerResponse>) => {
      if (event.data.id !== requestId) return;
      if (event.data.ok && event.data.peaks.length) commitPeaks(event.data.peaks, { decoder: "worker", peakCount: event.data.peaks.length });
      else decodeInMainThread(event.data.error?.code ?? "audio_worker_failed", event.data.error ?? null);
    };
    worker.onerror = () => decodeInMainThread("audio_worker_failed", { code: "audio_worker_failed", message: "音频波形 Worker 执行失败", retryable: true });
    worker.postMessage({ id: requestId, url, count: WAVEFORM_PEAK_COUNT });
    return () => {
      cancelled = true;
      fallbackAbortController.abort();
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [url, rebuildStaticCaches, render, trace?.artifactId, trace?.backendTraceId, trace?.parentArtifactId, trace?.uiTraceId]);

  useEffect(() => {
    if (!audio) return undefined;
    const tick = (time: number) => {
      if (!animate) return;
      if (time - lastFrameAtRef.current >= 66) {
        lastFrameAtRef.current = time;
        render();
      }
      rafIdRef.current = !audio.paused && active ? requestAnimationFrame(tick) : 0;
    };
    const start = () => {
      if (!active || !animate || rafIdRef.current) return;
      rafIdRef.current = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
      render();
    };
    audio.addEventListener("play", start);
    audio.addEventListener("pause", stop);
    const onLoadedMetadata = () => render();
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => {
      audio.removeEventListener("play", start);
      audio.removeEventListener("pause", stop);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      stop();
    };
  }, [active, animate, audio, render]);

  const bindCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || !audio) return () => undefined;
      const seek = (event: PointerEvent) => {
        const duration = resolveDuration(audio, durationSeconds);
        if (!duration) return;
        const rect = canvas.getBoundingClientRect();
        const targetTime = duration * clamp((event.clientX - rect.left) / Math.max(rect.width, 1));
        seekAudio(audio, targetTime, duration);
        render(targetTime / duration);
      };
      const onPointerDown = (event: PointerEvent) => {
        if (!url) return;
        canvas.setPointerCapture?.(event.pointerId);
        seek(event);
      };
      const onPointerMove = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        hoverRatioRef.current = clamp((event.clientX - rect.left) / Math.max(rect.width, 1));
        if (event.buttons === 1) seek(event);
        render();
      };
      const onPointerLeave = () => {
        hoverRatioRef.current = null;
        render();
      };
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
      return () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerleave", onPointerLeave);
      };
    },
    [audio, durationSeconds, render, url],
  );

  useEffect(() => bindCanvas(mainCanvas), [bindCanvas, mainCanvas]);
  useEffect(() => bindCanvas(miniCanvas), [bindCanvas, miniCanvas]);

  return { renderWithProgress: render };
}

function buildStaticCanvas(canvas: HTMLCanvasElement | null, peaks: number[], ratio: number) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round((rect.width || canvas.width) * ratio));
  const height = Math.max(1, Math.round((rect.height || canvas.height) * ratio));
  return createStaticWaveform(width, height, peaks);
}

function resolveDuration(audio: HTMLAudioElement, fallbackDuration?: number | null) {
  if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  return Number.isFinite(fallbackDuration) && fallbackDuration && fallbackDuration > 0 ? Number(fallbackDuration) : 0;
}

function canDecodeWaveformOnMainThread(durationSeconds?: number | null) {
  return Number.isFinite(durationSeconds) && Number(durationSeconds) > 0 && Number(durationSeconds) <= MAX_MAIN_THREAD_DECODE_SECONDS;
}

function seekAudio(audio: HTMLAudioElement, time: number, duration: number) {
  const targetTime = Math.max(0, Math.min(time, duration));
  const apply = () => {
    try {
      audio.currentTime = targetTime;
    } catch {
      audio.addEventListener("loadedmetadata", apply, { once: true });
      audio.load();
    }
  };
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
    audio.addEventListener("loadedmetadata", apply, { once: true });
    audio.addEventListener("canplay", apply, { once: true });
  }
  apply();
}

type DecodeResult = { ok: true; peaks: number[] } | { ok: false; error: WaveformError; cancelled?: false } | { ok: false; cancelled: true };

async function decodePeaksInMainThread(url: string, count: number, signal?: AbortSignal): Promise<DecodeResult> {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return { ok: false, error: { code: "audio_context_unavailable", message: "当前环境不支持音频解码", retryable: false } };
  let context: AudioContext | null = null;
  try {
    if (signal?.aborted) return { ok: false, cancelled: true };
    const response = await fetch(url, { signal });
    if (signal?.aborted) return { ok: false, cancelled: true };
    const buffer = await response.arrayBuffer();
    if (signal?.aborted) return { ok: false, cancelled: true };
    context = new AudioContextClass();
    const audioBuffer = await context.decodeAudioData(buffer);
    if (signal?.aborted) return { ok: false, cancelled: true };
    return { ok: true, peaks: buildVisualEnvelope(audioBuffer, count) };
  } catch (error) {
    if (signal?.aborted || (error as Error)?.name === "AbortError") return { ok: false, cancelled: true };
    return { ok: false, error: { code: "audio_decode_failed", message: "音频解码失败", retryable: true } };
  } finally {
    await context?.close?.();
  }
}
