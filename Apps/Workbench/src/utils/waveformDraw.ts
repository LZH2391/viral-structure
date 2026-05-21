export type WaveformInput = {
  peaks: number[];
  progress: number;
  hoverRatio?: number | null;
};

export function drawCanvas(canvas: HTMLCanvasElement | null, input: WaveformInput, staticCache?: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || canvas.width));
  const height = Math.max(1, Math.round(rect.height || canvas.height));
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (staticCache) context.drawImage(staticCache, 0, 0, width, height);
  else drawStaticWaveform(context, width, height, input.peaks);
  drawCursor(context, width, height, input);
}

export function createStaticWaveform(width: number, height: number, peaks: number[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  drawStaticWaveform(context, canvas.width, canvas.height, peaks);
  return canvas;
}

function drawStaticWaveform(context: CanvasRenderingContext2D, width: number, height: number, peaks: number[]): void {
  const center = height / 2;
  const displayPeaks = buildDisplayPeaks(peaks);
  context.fillStyle = "#0b1118";
  context.fillRect(0, 0, width, height);
  drawEnvelope(context, width, height, displayPeaks);
  context.fillStyle = "#385166";
  for (let x = 0; x < width; x += 3) {
    const peak = samplePeak(displayPeaks, x, width);
    const barHeight = Math.max(2, peak * height * 0.9);
    context.fillRect(x, center - barHeight / 2, 2, barHeight);
  }
}

function drawEnvelope(context: CanvasRenderingContext2D, width: number, height: number, peaks: number[]): void {
  if (!peaks.length) return;
  const center = height / 2;
  context.beginPath();
  for (let x = 0; x < width; x += 1) {
    const peak = samplePeak(peaks, x, width);
    const y = center - Math.max(1, peak * height * 0.44);
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  for (let x = width - 1; x >= 0; x -= 1) {
    const peak = samplePeak(peaks, x, width);
    const y = center + Math.max(1, peak * height * 0.44);
    context.lineTo(x, y);
  }
  context.closePath();
  context.fillStyle = "rgba(66, 216, 255, 0.13)";
  context.fill();
}

function buildDisplayPeaks(peaks: number[]): number[] {
  const finite = peaks.map((peak) => clamp(peak)).filter((peak) => Number.isFinite(peak));
  if (!finite.length) return [];
  if (isLowVisualSignal(finite)) return finite.map((peak) => Math.min(0.08, peak));
  const sorted = [...finite].sort((first, second) => first - second);
  const floor = percentile(sorted, 0.03);
  const ceiling = percentile(sorted, 0.97);
  const range = Math.max(0.004, ceiling - floor);
  return finite.map((peak, index) => {
    const localAverage = localMean(finite, index, 10);
    const global = clamp((peak - floor) / range);
    const local = clamp((peak - localAverage + range * 0.32) / (range * 0.64));
    const shaped = Math.pow(global, 0.62) * 0.78 + local * 0.22;
    return 0.12 + clamp(shaped) * 0.84;
  });
}

function isLowVisualSignal(values: number[]): boolean {
  const sorted = [...values].sort((first, second) => first - second);
  return percentile(sorted, 0.95) < 0.08;
}

function samplePeak(peaks: number[], x: number, width: number): number {
  if (!peaks.length) return 0.16;
  return peaks[Math.min(peaks.length - 1, Math.floor((x / Math.max(width, 1)) * peaks.length))] ?? 0.16;
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

function drawCursor(context: CanvasRenderingContext2D, width: number, height: number, input: WaveformInput): void {
  const progressX = width * clamp(input.progress);
  context.fillStyle = "rgba(66, 216, 255, 0.24)";
  context.fillRect(0, 0, progressX, height);
  context.fillStyle = "#f8fbff";
  context.fillRect(progressX, 0, 2, height);
  if (input.hoverRatio !== null && input.hoverRatio !== undefined) {
    context.fillStyle = "rgba(255, 255, 255, 0.32)";
    context.fillRect(width * input.hoverRatio, 0, 1, height);
  }
}

export function clamp(value: unknown): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
