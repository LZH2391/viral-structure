import { useCallback, useEffect, useRef } from "react";
import { buildVisualEnvelope } from "../utils/audioEnvelope";
import { clamp, createStaticWaveform, drawCanvas } from "../utils/waveformDraw";

type WaveformWorkerResponse = {
  id: number;
  peaks: number[];
  error?: string;
};

type WaveformOptions = {
  audio: HTMLAudioElement | null;
  mainCanvas: HTMLCanvasElement | null;
  miniCanvas: HTMLCanvasElement | null;
  url: string | null;
  active: boolean;
  animate?: boolean;
};

const peaksCache = new Map<string, number[]>();
const WAVEFORM_CACHE_VERSION = "visual-envelope-v6";
const WAVEFORM_PEAK_COUNT = 900;
const PLACEHOLDER_PEAKS = Array.from({ length: 180 }, (_, index) => 0.16 + Math.abs(Math.sin(index / 5) * Math.cos(index / 13)) * 0.5);

export function useAudioWaveform({ audio, mainCanvas, miniCanvas, url, active, animate = true }: WaveformOptions) {
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
      const duration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
      const progress = externalProgress ?? (duration ? clamp(audio!.currentTime / duration) : 0);
      drawCanvas(mainCanvas, { peaks: peaksRef.current, progress, hoverRatio: hoverRatioRef.current }, mainStaticRef.current);
      drawCanvas(miniCanvas, { peaks: peaksRef.current, progress, hoverRatio: hoverRatioRef.current }, miniStaticRef.current);
    },
    [audio, mainCanvas, miniCanvas],
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
    const commitPeaks = (peaks: number[]) => {
      if (cancelled || requestIdRef.current !== requestId) return;
      peaksRef.current = peaks.length ? peaks : PLACEHOLDER_PEAKS;
      if (cacheKey && peaks.length) peaksCache.set(cacheKey, peaks);
      rebuildStaticCaches();
      render(0);
    };
    const decodeInMainThread = () => {
      void decodePeaksInMainThread(url, WAVEFORM_PEAK_COUNT).then(commitPeaks, () => commitPeaks([]));
    };
    peaksRef.current = PLACEHOLDER_PEAKS;
    rebuildStaticCaches();
    render();
    const worker = new Worker(new URL("../workers/audioPeaks.worker.ts", import.meta.url), { type: "module" });
    workerRef.current?.terminate();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WaveformWorkerResponse>) => {
      if (event.data.id !== requestId) return;
      if (event.data.peaks.length) commitPeaks(event.data.peaks);
      else decodeInMainThread();
    };
    worker.onerror = decodeInMainThread;
    worker.postMessage({ id: requestId, url, count: WAVEFORM_PEAK_COUNT });
    return () => {
      cancelled = true;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [url, rebuildStaticCaches, render]);

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
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (!duration) return;
        const rect = canvas.getBoundingClientRect();
        audio.currentTime = duration * clamp((event.clientX - rect.left) / Math.max(rect.width, 1));
        render();
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
    [audio, render, url],
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

async function decodePeaksInMainThread(url: string, count: number): Promise<number[]> {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return [];
  let context: AudioContext | null = null;
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    context = new AudioContextClass();
    const audioBuffer = await context.decodeAudioData(buffer);
    return buildVisualEnvelope(audioBuffer, count);
  } finally {
    await context?.close?.();
  }
}
